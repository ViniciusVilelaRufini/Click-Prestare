import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import { normalizarPlaca } from '../facial/placa.util';
import { formatarApto } from '../common/formatar-apto.util';
import {
  ESTADO_OP,
  ESTADO_TAG,
  MAX_DISPOSITIVOS_GUARITA,
  MAX_FRAMES_POR_PARTE,
  OPERACOES_DE_LEITURA,
  REENTREGA_MS,
  SIGLA_TIPO,
  TIPOS_DISPOSITIVO_GUARITA,
  TIPO_TAG_POR_GUARITA,
} from './guarita.constantes';
import { DispositivoGuarita, decodificarDispositivo } from './guarita-frame.util';
import type { GuaritaDoAgente, ResultadoOperacaoDto } from './guarita-agente.service';
import {
  blocoComparavel,
  buscarGuaritaDoCondominio,
  numeroDaUnidade,
} from './guarita-comum.util';
import { hexDeTamanho } from './guarita-validacao.util';

/** Operação como o console a enxerga (`GET …/operacoes/:id`, e a resposta de importar/conferir). */
export interface OperacaoNoConsole {
  id: number;
  tipo: string;
  /** pendente | enviada | ok | falhou | cancelada ("processando" aparece como enviada). */
  estado: string;
  erro: string | null;
  codigo: number | null;
  created_at: Date;
  concluida_em: Date | null;
  /** Importação: { total, novos, atualizados, vinculados }. Conferência: { so_no_guarita, so_no_prestare, divergente } (contagens). */
  resumo?: Record<string, number>;
  /** Só na conferência concluída: a lista de cada diferença. */
  diferencas?: DiferencasConferencia;
}

export interface ItemDiferenca {
  id_tag: number | null;
  tipo: number;
  serial: string;
  /** só_no_prestare: true quando a tag não tinha frame guardado (não há como recadastrar sozinho). */
  sem_frame?: boolean;
}

export interface DiferencasConferencia {
  so_no_guarita: ItemDiferenca[];
  so_no_prestare: ItemDiferenca[];
  divergente: ItemDiferenca[];
}

interface ResumoGuardado {
  resumo: Record<string, number>;
  diferencas?: DiferencasConferencia;
}

const TIPOS_LEITURA: string[] = [...OPERACOES_DE_LEITURA];
const ESTADOS_ABERTOS = [ESTADO_OP.pendente, ESTADO_OP.enviada, ESTADO_OP.processando];
const RESUMO_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const chaveResumo = (idOperacao: number) => `guarita:resumo:${idOperacao}`;
const chaveTrava = (idDevice: number) => `guarita:trava-leitura:${idDevice}`;

/** Frame "vazio" que alguns firmwares mandam como fim: todo 0xFF (ou todo 0x00). */
function frameVazio(h: string): boolean {
  return /^F+$/i.test(h) || /^0+$/.test(h);
}

/**
 * Compara o frame guardado com o lido, ignorando o que o Guarita muda sozinho:
 * byte 30 (bateria e último acionamento, só leitura) e, no RF, os bytes 5–6
 * (contador do rolling code, que [inferência] o Guarita acompanha a cada uso).
 */
function mesmoCadastro(guardado: string | null, lido: string): boolean {
  if (!guardado) return false;
  const limpar = (h: string) => {
    const u = h.toUpperCase();
    const semFlags = u.slice(0, 58) + '00' + u.slice(60);
    return u.startsWith('1') ? semFlags.slice(0, 8) + '0000' + semFlags.slice(12) : semFlags;
  };
  return limpar(guardado) === limpar(lido);
}

/**
 * Importação e conferência do cadastro do Guarita (comandos 7 + 70 + 43 no
 * agente; aqui chegam os frames de 39 bytes em partes de até 500).
 *
 * Regras:
 *  - nada é processado antes da parte com `fim` e de todas as anteriores;
 *  - a cópia de segurança (Guarita_Backups) é gravada ANTES de qualquer mudança;
 *  - a importação nunca escreve no Guarita; a conferência só reenvia (cadastrar)
 *    o que o próprio Prestare gravou e sumiu — NUNCA gera `apagar`;
 *  - o processamento é reivindicado por UPDATE condicional (duas instâncias
 *    recebendo o fim: só uma processa).
 *
 * NÃO validado em aparelho.
 */
@Injectable()
export class GuaritaImportacaoService {
  private readonly logger = new Logger(GuaritaImportacaoService.name);
  private readonly estado: EstadoCompartilhado;

  constructor(private readonly prisma: PrismaService) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  // ----------------------------------------------------------- pedir leitura

  /** `POST …/importar` e `…/conferir`: cria a operação (409 se já há uma leitura em andamento). */
  async solicitar(
    idCondominio: number,
    deviceId: number,
    tipo: 'importar' | 'conferir',
    autor: string,
  ): Promise<OperacaoNoConsole> {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    if (device.ativo !== 1) throw new BadRequestException('Este Guarita está desativado.');
    // Dois cliques ao mesmo tempo (até em instâncias diferentes): só um cria.
    const travou = await this.estado.criarSeAusente(chaveTrava(device.id), true, 10_000);
    if (!travou) throw new ConflictException('Já há uma leitura do Guarita em andamento.');
    try {
      const aberta = await this.leituraAberta(device.id);
      if (aberta) throw new ConflictException('Já há uma leitura do Guarita em andamento.');
      const op = await this.prisma.guarita_Operacoes.create({
        data: { id_condominio: device.id_condominio, id_device: device.id, tipo, estado: ESTADO_OP.pendente, criado_por: autor },
      });
      return this.paraConsole(op, null);
    } finally {
      await this.estado.remover(chaveTrava(device.id));
    }
  }

  /**
   * Leitura em andamento deste Guarita (pendente, enviada ou montando). Uma
   * "processando" parada há mais de 5 min não conta (a fila a marca como falha).
   */
  async leituraAberta(idDevice: number) {
    const limite = new Date(Date.now() - REENTREGA_MS);
    const abertas = await this.prisma.guarita_Operacoes.findMany({
      where: { id_device: idDevice, tipo: { in: TIPOS_LEITURA }, estado: { in: ESTADOS_ABERTOS } },
      orderBy: { id: 'asc' },
    });
    return (
      abertas.find((o: any) => o.estado !== ESTADO_OP.processando || (o.enviada_em && o.enviada_em >= limite)) ?? null
    );
  }

  /** `GET …/operacoes/:id`: andamento de qualquer operação deste Guarita (menos a captura). */
  async operacao(idCondominio: number, deviceId: number, idOperacao: number): Promise<OperacaoNoConsole> {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const op = await this.prisma.guarita_Operacoes.findFirst({
      where: { id: Number(idOperacao), id_device: device.id, tipo: { not: 'captura' } },
    });
    if (!op) throw new NotFoundException('Operação não encontrada.');
    const guardado = (await this.estado.obter<ResumoGuardado>(chaveResumo(op.id)))?.valor ?? null;
    return this.paraConsole(op, guardado);
  }

  paraConsole(op: any, guardado: ResumoGuardado | null): OperacaoNoConsole {
    return {
      id: op.id,
      tipo: op.tipo,
      estado: op.estado === ESTADO_OP.processando ? ESTADO_OP.enviada : op.estado,
      erro: op.erro ?? null,
      codigo: op.codigo ?? null,
      created_at: op.created_at,
      concluida_em: op.concluida_em ?? null,
      ...(guardado?.resumo && { resumo: guardado.resumo }),
      ...(guardado?.diferencas && { diferencas: guardado.diferencas }),
    };
  }

  // --------------------------------------------------- resultado do agente

  /**
   * Parte (ou fim) de uma importação/conferência vinda do agente. Grava a parte
   * (idempotente por operação+parte) e, se a última já chegou e não falta
   * nenhuma, monta e processa — uma vez só.
   */
  async receberResultado(device: GuaritaDoAgente, op: { id: number; tipo: string }, r: ResultadoOperacaoDto): Promise<void> {
    if (!r.ok) {
      await this.prisma.guarita_Operacoes.updateMany({
        where: { id: op.id, estado: { in: [ESTADO_OP.pendente, ESTADO_OP.enviada] } },
        data: {
          estado: ESTADO_OP.falhou,
          codigo: r.codigo ?? null,
          erro: r.erro ?? 'O Guarita não completou a leitura do cadastro.',
          concluida_em: new Date(),
        },
      });
      await this.prisma.guarita_Importacoes.deleteMany({ where: { id_operacao: op.id } });
      return;
    }
    const frames = r.frames_hex ?? [];
    if (frames.length > MAX_FRAMES_POR_PARTE) throw new BadRequestException('Parte com frames demais.');
    const validados = frames.map((f, i) => hexDeTamanho(f, 39, `frames_hex[${i}]`));
    const fim = r.fim === true;

    if (r.parte !== undefined || validados.length > 0 || !fim) {
      const parte = r.parte ?? 0;
      await this.prisma.guarita_Importacoes.upsert({
        where: { id_operacao_parte: { id_operacao: op.id, parte } },
        create: { id_operacao: op.id, parte, frames: JSON.stringify(validados), fim: fim ? 1 : 0 },
        update: { frames: JSON.stringify(validados), ...(fim && { fim: 1 }) },
      });
    } else {
      // `fim` sozinho (sem parte nem frames): fecha na maior parte recebida.
      const ultima = await this.prisma.guarita_Importacoes.findFirst({
        where: { id_operacao: op.id },
        orderBy: { parte: 'desc' },
        select: { id: true },
      });
      if (ultima) {
        await this.prisma.guarita_Importacoes.update({ where: { id: ultima.id }, data: { fim: 1 } });
      } else {
        await this.prisma.guarita_Importacoes.upsert({
          where: { id_operacao_parte: { id_operacao: op.id, parte: 0 } },
          create: { id_operacao: op.id, parte: 0, frames: '[]', fim: 1 },
          update: { fim: 1 },
        });
      }
    }
    // Parte chegou: a leitura está viva (não reentrega no meio de um cadastro grande).
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id: op.id, estado: { in: [ESTADO_OP.pendente, ESTADO_OP.enviada] } },
      data: { estado: ESTADO_OP.enviada, enviada_em: new Date() },
    });
    await this.tentarConcluir(device, op);
  }

  private async tentarConcluir(device: GuaritaDoAgente, op: { id: number; tipo: string }) {
    const partes = await this.prisma.guarita_Importacoes.findMany({
      where: { id_operacao: op.id },
      orderBy: { parte: 'asc' },
      select: { parte: true, fim: true, frames: true },
    });
    const ultima = partes.find((p: any) => p.fim === 1);
    if (!ultima || partes.length === 0) return;
    const primeira = partes[0].parte;
    if (primeira > 1) return;
    const usadas = partes.filter((p: any) => p.parte <= ultima.parte);
    if (usadas.length !== ultima.parte - primeira + 1) return; // falta parte no meio

    const reivindicou = await this.prisma.guarita_Operacoes.updateMany({
      where: { id: op.id, estado: { in: [ESTADO_OP.pendente, ESTADO_OP.enviada] } },
      data: { estado: ESTADO_OP.processando, enviada_em: new Date() },
    });
    if (reivindicou.count !== 1) return;

    try {
      const frames: string[] = usadas.flatMap((p: any) => JSON.parse(p.frames) as string[]);
      if (frames.length > MAX_DISPOSITIVOS_GUARITA + 1) throw new Error('mais frames que a capacidade do Guarita');
      const guardado = await this.processar(device, op, frames);
      await this.estado.definir(chaveResumo(op.id), guardado, RESUMO_TTL_MS);
      await this.prisma.guarita_Operacoes.updateMany({
        where: { id: op.id, estado: ESTADO_OP.processando },
        data: { estado: ESTADO_OP.ok, erro: null, concluida_em: new Date() },
      });
      await this.prisma.guarita_Importacoes.deleteMany({ where: { id_operacao: op.id } });
    } catch (err: any) {
      this.logger.error(`Guarita ${device.id}: falha ao processar a leitura ${op.id}: ${err?.message ?? err}`);
      await this.prisma.guarita_Operacoes.updateMany({
        where: { id: op.id, estado: ESTADO_OP.processando },
        data: { estado: ESTADO_OP.falhou, erro: 'Falha ao processar a leitura do Guarita. Tente de novo.', concluida_em: new Date() },
      });
    }
  }

  /** Cópia de segurança primeiro; depois o casamento (importação) ou as diferenças (conferência). */
  private async processar(device: GuaritaDoAgente, op: { id: number; tipo: string }, framesBrutos: string[]): Promise<ResumoGuardado> {
    const conferencia = op.tipo === 'conferir';
    const frames = framesBrutos.filter((f) => !frameVazio(f));
    await this.prisma.guarita_Backups.create({
      data: {
        id_condominio: device.id_condominio,
        id_device: device.id,
        motivo: conferencia ? 'conferencia' : 'importacao',
        total: frames.length,
        dados: JSON.stringify(frames),
      },
    });

    const lidos = new Map<string, DispositivoGuarita>();
    for (const f of frames) {
      let d: DispositivoGuarita;
      try {
        d = decodificarDispositivo(f);
      } catch {
        continue;
      }
      // BM e SN ficam só na cópia (fora da integração).
      if (!(TIPOS_DISPOSITIVO_GUARITA as readonly number[]).includes(d.tipo)) continue;
      const chave = `${d.tipo}:${d.serialHex}`;
      if (!lidos.has(chave)) lidos.set(chave, d);
    }

    const conhecidas = await this.prisma.tags.findMany({
      where: { id_device: device.id },
      select: { id: true, guarita_tipo: true, guarita_serial: true, guarita_estado: true, guarita_frame: true },
    });
    const porChave = new Map<string, any>();
    for (const t of conhecidas) {
      if (t.guarita_tipo != null && t.guarita_serial) porChave.set(`${t.guarita_tipo}:${t.guarita_serial}`, t);
    }
    const aptos = await this.prisma.apartamentos.findMany({
      where: { id_condominio: device.id_condominio },
      select: { id: true, bloco: true, apto: true },
    });
    const veiculos = await this.prisma.veiculos.findMany({
      where: { id_condominio: device.id_condominio, ativo: 1 },
      select: { id: true, placa: true, id_tag: true },
    });

    const agora = new Date();
    const resumo = { total: lidos.size, novos: 0, atualizados: 0, vinculados: 0 };
    const dif: DiferencasConferencia = { so_no_guarita: [], so_no_prestare: [], divergente: [] };

    for (const [chave, d] of lidos) {
      const conhecida = porChave.get(chave);
      if (conhecida) {
        if (!conferencia) {
          await this.atualizarFrame(conhecida.id, d, agora);
          resumo.atualizados++;
        } else if (mesmoCadastro(conhecida.guarita_frame, d.bruto)) {
          await this.prisma.tags.update({ where: { id: conhecida.id }, data: { guarita_em: agora } });
        } else {
          dif.divergente.push({ id_tag: conhecida.id, tipo: d.tipo, serial: d.serialHex });
        }
        continue;
      }
      const criada = await this.criarTag(device, d, aptos, veiculos, !conferencia, agora);
      if (criada.vinculada) resumo.vinculados++;
      resumo.novos++;
      if (conferencia) dif.so_no_guarita.push({ id_tag: criada.id, tipo: d.tipo, serial: d.serialHex });
    }

    if (!conferencia) return { resumo };

    // Só no Prestare: reenvia SÓ o que o Prestare confirmou ter gravado
    // (gravado/ativo). Nada de apagar: o que sobrar no Guarita fica lá.
    for (const t of conhecidas) {
      const chave = `${t.guarita_tipo}:${t.guarita_serial}`;
      if (lidos.has(chave)) continue;
      if (t.guarita_estado !== ESTADO_TAG.ativo && t.guarita_estado !== ESTADO_TAG.gravado) continue;
      if (!t.guarita_frame) {
        dif.so_no_prestare.push({ id_tag: t.id, tipo: t.guarita_tipo as number, serial: t.guarita_serial as string, sem_frame: true });
        continue;
      }
      await this.prisma.guarita_Operacoes.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          id_tag: t.id,
          tipo: 'cadastrar',
          frame_hex: t.guarita_frame,
          estado: ESTADO_OP.pendente,
          criado_por: 'Conferência do Guarita',
        },
      });
      await this.prisma.tags.update({
        where: { id: t.id },
        data: { guarita_estado: ESTADO_TAG.pendente, guarita_erro: null },
      });
      dif.so_no_prestare.push({ id_tag: t.id, tipo: t.guarita_tipo as number, serial: t.guarita_serial as string });
    }
    // Recadastro também precisa do 29 (o agente só informa o 29 com esta operação na fila).
    if (dif.so_no_prestare.some((d) => !d.sem_frame)) {
      const pendente = await this.prisma.guarita_Operacoes.count({
        where: { id_device: device.id, tipo: 'atualizar_receptores', estado: ESTADO_OP.pendente },
      });
      if (pendente === 0) {
        await this.prisma.guarita_Operacoes.create({
          data: {
            id_condominio: device.id_condominio,
            id_device: device.id,
            tipo: 'atualizar_receptores',
            estado: ESTADO_OP.pendente,
            criado_por: 'Conferência do Guarita',
          },
        });
      }
    }
    return {
      resumo: {
        so_no_guarita: dif.so_no_guarita.length,
        so_no_prestare: dif.so_no_prestare.length,
        divergente: dif.divergente.length,
      },
      diferencas: dif,
    };
  }

  private async atualizarFrame(idTag: number, d: DispositivoGuarita, agora: Date) {
    await this.prisma.tags.update({
      where: { id: idTag },
      data: {
        guarita_frame: d.bruto,
        guarita_em: agora,
        ...(d.tipo === 1 && { guarita_contador: d.contador }),
      },
    });
  }

  /** Unidade do Prestare para (unidade, bloco) do Guarita — só quando não há dúvida. */
  casarUnidade(unidade: number, bloco: string, aptos: Array<{ id: number; bloco: string | null; apto: string | null }>): number | null {
    const mesmoNumero = aptos.filter((a) => numeroDaUnidade(a.apto) === unidade);
    const mesmoBloco = mesmoNumero.filter((a) => blocoComparavel(a.bloco) === blocoComparavel(bloco));
    if (mesmoBloco.length === 1) return mesmoBloco[0].id;
    // Condomínio sem blocos no Prestare: o número basta, se for único.
    if (mesmoBloco.length === 0 && mesmoNumero.length === 1 && !blocoComparavel(mesmoNumero[0].bloco)) {
      return mesmoNumero[0].id;
    }
    return null;
  }

  /**
   * Tag nova para um dispositivo lido do Guarita: `a_vincular`, ou `ativo` se a
   * placa casou com exatamente UM veículo ativo sem tag (só na importação).
   */
  private async criarTag(
    device: GuaritaDoAgente,
    d: DispositivoGuarita,
    aptos: Array<{ id: number; bloco: string | null; apto: string | null }>,
    veiculos: Array<{ id: number; placa: string; id_tag: number | null }>,
    autoVincular: boolean,
    agora: Date,
  ): Promise<{ id: number; vinculada: boolean }> {
    const placa = normalizarPlaca(d.placa);
    const candidatos = autoVincular && placa ? veiculos.filter((v) => normalizarPlaca(v.placa) === placa) : [];
    const veiculo = candidatos.length === 1 && candidatos[0].id_tag == null ? candidatos[0] : null;
    const base = `G${d.tipo}-${d.serialHex}`;
    const dados = {
      id_condominio: device.id_condominio,
      tipo: TIPO_TAG_POR_GUARITA[d.tipo],
      descricao: d.rotulo || null,
      ativo: 1,
      id_device: device.id,
      id_apto: this.casarUnidade(d.unidade, d.bloco, aptos),
      guarita_tipo: d.tipo,
      guarita_serial: d.serialHex,
      guarita_contador: d.tipo === 1 ? d.contador : null,
      guarita_estado: veiculo ? ESTADO_TAG.ativo : ESTADO_TAG.aVincular,
      guarita_erro: null,
      guarita_frame: d.bruto,
      guarita_em: agora,
    };
    let tag: any;
    for (const codigo of [base, `${base}-D${device.id}`]) {
      try {
        tag = await this.prisma.tags.create({ data: { ...dados, codigo } });
        break;
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
        const existente = await this.prisma.tags.findFirst({
          where: { id_condominio: device.id_condominio, codigo },
          select: { id: true, id_device: true },
        });
        if (existente && existente.id_device === device.id) {
          await this.atualizarFrame(existente.id, d, agora);
          return { id: existente.id, vinculada: false };
        }
      }
    }
    if (!tag) throw new Error(`código de tag ocupado para ${base}`);
    if (veiculo) {
      await this.prisma.veiculos.update({ where: { id: veiculo.id }, data: { id_tag: tag.id } });
      veiculo.id_tag = tag.id;
    }
    return { id: tag.id, vinculada: !!veiculo };
  }

  // ------------------------------------------------------ rotas do console

  /** `GET …/dispositivos?estado=`: os dispositivos deste Guarita, com unidade, veículo, estado e erro. */
  async listarDispositivos(idCondominio: number, deviceId: number, estado?: string) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    if (estado !== undefined && estado !== '' && !(Object.values(ESTADO_TAG) as string[]).includes(estado)) {
      throw new BadRequestException('Estado inválido.');
    }
    const tags = await this.prisma.tags.findMany({
      where: { id_device: device.id, id_condominio: device.id_condominio, ...(estado ? { guarita_estado: estado } : {}) },
      orderBy: { id: 'asc' },
    });
    const ids = tags.map((t: any) => t.id);
    const veiculos = ids.length
      ? await this.prisma.veiculos.findMany({
          where: { id_tag: { in: ids }, id_condominio: device.id_condominio, ativo: 1 },
          select: { id: true, placa: true, marca_modelo: true, cor: true, id_tag: true, id_morador: true },
        })
      : [];
    const idsMoradores = [...new Set(veiculos.map((v: any) => v.id_morador))];
    const moradores = idsMoradores.length
      ? await this.prisma.moradores.findMany({ where: { id: { in: idsMoradores } }, select: { id: true, nome: true } })
      : [];
    const idsAptos = [...new Set(tags.map((t: any) => t.id_apto).filter((x: any) => x != null))];
    const aptos = idsAptos.length
      ? await this.prisma.apartamentos.findMany({ where: { id: { in: idsAptos } }, select: { id: true, bloco: true, apto: true } })
      : [];
    const veiculoPorTag = new Map(veiculos.map((v: any) => [v.id_tag, v]));
    const moradorPorId = new Map(moradores.map((m: any) => [m.id, m]));
    const aptoPorId = new Map(aptos.map((a: any) => [a.id, a]));

    return tags.map((t: any) => {
      let lido: DispositivoGuarita | null = null;
      try {
        lido = t.guarita_frame ? decodificarDispositivo(t.guarita_frame) : null;
      } catch {
        lido = null;
      }
      const v: any = veiculoPorTag.get(t.id) ?? null;
      const m: any = v ? moradorPorId.get(v.id_morador) ?? null : null;
      const a: any = t.id_apto != null ? aptoPorId.get(t.id_apto) ?? null : null;
      return {
        id: t.id,
        id_tag: t.id,
        codigo: t.codigo,
        guarita_tipo: t.guarita_tipo,
        tipo_sigla: SIGLA_TIPO[t.guarita_tipo] ?? null,
        guarita_serial: t.guarita_serial,
        guarita_contador: t.guarita_contador ?? null,
        guarita_estado: t.guarita_estado,
        guarita_erro: t.guarita_erro ?? null,
        guarita_em: t.guarita_em ?? null,
        // O que está gravado no Guarita (do último frame lido/confirmado).
        unidade: lido?.unidade ?? null,
        bloco: lido?.bloco ?? null,
        rotulo: lido?.rotulo ?? null,
        placa: lido?.placa || null,
        // Casamento no Prestare.
        id_apto: t.id_apto ?? null,
        apartamento: a ? formatarApto(a.apto, a.bloco) : null,
        id_veiculo: v?.id ?? null,
        veiculo_placa: v?.placa ?? null,
        veiculo_marca_modelo: v?.marca_modelo ?? null,
        id_morador: m?.id ?? null,
        morador_nome: m?.nome ?? null,
      };
    });
  }

  /** `GET …/backups`: lista sem os dados. */
  async listarBackups(idCondominio: number, deviceId: number) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    return this.prisma.guarita_Backups.findMany({
      where: { id_device: device.id },
      orderBy: { id: 'desc' },
      select: { id: true, motivo: true, total: true, created_at: true },
    });
  }

  /** `GET …/backups/:idBackup`: a cópia inteira (frames em hex), para baixar. */
  async baixarBackup(idCondominio: number, deviceId: number, idBackup: number) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const b = await this.prisma.guarita_Backups.findFirst({ where: { id: Number(idBackup), id_device: device.id } });
    if (!b) throw new NotFoundException('Cópia de segurança não encontrada.');
    let frames: string[] = [];
    try {
      frames = JSON.parse(b.dados);
    } catch {
      frames = [];
    }
    return {
      id: b.id,
      id_device: device.id,
      guarita: device.nome,
      motivo: b.motivo,
      total: b.total,
      created_at: b.created_at,
      formato: 'frames de dispositivo do Módulo Guarita (39 bytes, hex), como lidos pelo comando 70',
      frames,
    };
  }

  /**
   * `POST …/dispositivos/:idTag/vincular { id_veiculo }`: liga um dispositivo
   * `a_vincular` a um veículo ativo, sem tag, do condomínio. Não grava no
   * Guarita (o dispositivo já está lá); vira `ativo`.
   */
  async vincular(idCondominio: number, deviceId: number, idTag: number, idVeiculoBruto: unknown) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const idVeiculo = Number(idVeiculoBruto);
    if (!Number.isInteger(idVeiculo) || idVeiculo <= 0) throw new BadRequestException('Informe o veículo.');
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(idTag), id_device: device.id, id_condominio: device.id_condominio },
      select: { id: true, guarita_estado: true },
    });
    if (!tag) throw new NotFoundException('Dispositivo não encontrado neste Guarita.');
    if (tag.guarita_estado !== ESTADO_TAG.aVincular) {
      throw new BadRequestException('Só dispositivos "a vincular" podem ser vinculados por aqui.');
    }
    const veiculo = await this.prisma.veiculos.findFirst({
      where: { id: idVeiculo, id_condominio: device.id_condominio, ativo: 1 },
      select: { id: true, id_tag: true },
    });
    if (!veiculo) throw new NotFoundException('Veículo não encontrado.');
    if (veiculo.id_tag != null && veiculo.id_tag !== tag.id) {
      throw new BadRequestException('Este veículo já tem uma tag. Desvincule a atual antes.');
    }
    const emOutro = await this.prisma.veiculos.findFirst({
      where: { id_tag: tag.id, ativo: 1, id: { not: veiculo.id } },
      select: { id: true },
    });
    if (emOutro) throw new BadRequestException('Esta tag já está vinculada a outro veículo.');
    await this.prisma.veiculos.update({ where: { id: veiculo.id }, data: { id_tag: tag.id } });
    await this.prisma.tags.update({
      where: { id: tag.id },
      data: { guarita_estado: ESTADO_TAG.ativo, guarita_erro: null },
    });
    return { id_tag: tag.id, estado: ESTADO_TAG.ativo, id_veiculo: veiculo.id };
  }
}
