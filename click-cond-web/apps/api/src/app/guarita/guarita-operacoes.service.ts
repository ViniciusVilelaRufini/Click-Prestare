import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizarPlaca } from '../facial/placa.util';
import {
  ESTADO_OP,
  ESTADO_TAG,
  MSG_RF_SO_POR_CAPTURA,
  OPERACOES_DE_GRAVACAO,
  OPERACOES_DE_LEITURA,
  TIPO_DEVICE_GUARITA,
} from './guarita.constantes';
import {
  codificarApagar,
  codificarDispositivo,
  corParaByte,
  decodificarDispositivo,
  marcaParaByte,
} from './guarita-frame.util';
import { buscarGuaritaDoCondominio, numeroDaUnidade } from './guarita-comum.util';
import { MSG_CODIGO_IMPRESSO_INVALIDO } from './guarita.constantes';
import { wiegandParaSerial } from './guarita-frame.util';

/** Mensagens das respostas do comando 67 (o agente pode mandar o próprio texto em `erro`). */
export const MENSAGENS_67: Record<number, string> = {
  0x00: 'ok',
  0x01: 'Memória do Guarita cheia.',
  0x02: 'Este dispositivo já está cadastrado no Guarita.',
  0x03: 'Dispositivo não encontrado no Guarita.',
  0xfe: 'O Guarita recusou os dados do dispositivo.',
};

/** Resultado de uma operação, como o agente manda. */
export interface ResultadoGravacao {
  ok: boolean;
  codigo?: number;
  erro?: string;
}

const TIPOS_GRAVACAO: string[] = [...OPERACOES_DE_GRAVACAO];
const TIPOS_LEITURA: string[] = [...OPERACOES_DE_LEITURA];
const ABERTAS = [ESTADO_OP.pendente, ESTADO_OP.enviada];

/** "Maria Conceição dos Santos" → "Maria Santos" (o rótulo do Guarita tem 18 caracteres). */
export function nomeCurto(nome: string | null | undefined): string {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(' ');
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

/**
 * Fila de gravação no Guarita (comando 67) a partir de Veículos/Tags, e o
 * efeito do resultado nas tags.
 *
 * Invariantes:
 *  - NUNCA gera `apagar` para dispositivo que o Prestare não conhece
 *    (`a_vincular`) nem para tag que não é do Guarita — em nenhum caminho;
 *  - a primeira gravação de um Guarita sem cópia de segurança cria antes uma
 *    `importar` (e a fila só entrega gravações depois de haver cópia);
 *  - "gravado" só com a resposta 0x00 do Guarita; "ativo" só depois do 29;
 *  - a ordem é a do id da operação (autoincremento do banco): duas instâncias
 *    enfileirando para a mesma tag geram duas operações em ordem.
 *
 * Só depende do Prisma (GuaritaNucleoModule): Veículos, Moradores e o app o
 * usam sem puxar o módulo do facial.
 *
 * NÃO validado em aparelho.
 */
@Injectable()
export class GuaritaOperacoesService {
  private readonly logger = new Logger(GuaritaOperacoesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ consultas

  /** Guaritas ativos do condomínio (sem a palavra de autorização). */
  async guaritasDoCondominio(idCondominio: number): Promise<Array<{ id: number; nome: string }>> {
    return this.prisma.facial_Devices.findMany({
      where: { id_condominio: Number(idCondominio), tipo: TIPO_DEVICE_GUARITA, ativo: 1 },
      orderBy: { id: 'asc' },
      select: { id: true, nome: true },
    });
  }

  /**
   * Ids das tags de Guarita ligadas aos veículos do morador. Ler ANTES da
   * transação que apaga o morador: a cascata leva os veículos (e o vínculo).
   */
  async tagsDoMorador(idMorador: number): Promise<number[]> {
    return this.tagsDosVeiculos({ id_morador: Number(idMorador) });
  }

  /** Ids das tags de Guarita ligadas aos veículos que casam com o filtro. */
  async tagsDosVeiculos(where: Record<string, unknown>): Promise<number[]> {
    const veiculos = await this.prisma.veiculos.findMany({
      where: { ...where, id_tag: { not: null } },
      select: { id_tag: true },
    });
    const ids = [...new Set(veiculos.map((v: any) => v.id_tag).filter((x: any) => x != null))] as number[];
    if (!ids.length) return [];
    const tags = await this.prisma.tags.findMany({
      where: { id: { in: ids }, id_device: { not: null } },
      select: { id: true },
    });
    return tags.map((t: any) => t.id);
  }

  /** É tag de Guarita (o Prestare a associou a um Guarita)? */
  async ehTagDeGuarita(idTag: number | null | undefined): Promise<boolean> {
    if (idTag == null) return false;
    const t = await this.prisma.tags.findUnique({ where: { id: Number(idTag) }, select: { id_device: true } });
    return !!t?.id_device;
  }

  // ------------------------------------------------------------ enfileirar

  /** Cadastro (67, opção 0) da tag no Guarita dela, com os dados do veículo vinculado. */
  async enfileirarCadastro(idTag: number, autor: string): Promise<{ id_operacao: number }> {
    const tag = await this.tagDoGuarita(idTag);
    const frame = await this.montarFrame(tag, null);
    return this.criarGravacao(tag, 'cadastrar', frame, autor, ESTADO_TAG.pendente);
  }

  /** Edição (67, opção 1) usando o frame lido/confirmado do Guarita como base (grupo, receptores e flags ficam). */
  async enfileirarEdicao(idTag: number, autor: string): Promise<{ id_operacao: number }> {
    const tag = await this.tagDoGuarita(idTag);
    let base: string | null = tag.guarita_frame ?? null;
    if (!base) {
      const cad = await this.prisma.guarita_Operacoes.findFirst({
        where: { id_tag: tag.id, tipo: 'cadastrar', frame_hex: { not: null } },
        orderBy: { id: 'desc' },
        select: { frame_hex: true },
      });
      base = cad?.frame_hex ?? null;
    }
    const frame = await this.montarFrame(tag, base);
    return this.criarGravacao(tag, 'editar', frame, autor, ESTADO_TAG.pendente);
  }

  /**
   * Remoção (67, opção 4: só tipo + serial). Devolve false — e NÃO enfileira —
   * para tag que não é de Guarita, `a_vincular` (o Prestare não a gravou: nunca
   * apaga) ou `aguardando_aprovacao` (ainda não foi ao Guarita; só perde o
   * vínculo com ele). Já em remoção: true, sem duplicar.
   */
  async enfileirarRemocao(idTag: number, autor: string): Promise<boolean> {
    const tag = await this.prisma.tags.findUnique({ where: { id: Number(idTag) } });
    if (!tag || tag.id_device == null) return false;
    const estado = tag.guarita_estado;
    if (estado === ESTADO_TAG.aguardandoAprovacao) {
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: { id_device: null, guarita_estado: null, guarita_erro: null },
      });
      return false;
    }
    // a_vincular: o Prestare não gravou este dispositivo — NUNCA apaga do Guarita.
    if (estado === ESTADO_TAG.aVincular || estado == null) return false;
    if (tag.guarita_tipo == null || !tag.guarita_serial) return false;
    if (estado === ESTADO_TAG.removendo) {
      const aberta = await this.prisma.guarita_Operacoes.count({
        where: { id_tag: tag.id, tipo: 'apagar', estado: { in: ABERTAS } },
      });
      if (aberta > 0) return true;
    }
    const frame = codificarApagar(tag.guarita_tipo, tag.guarita_serial);
    await this.criarGravacao(tag, 'apagar', frame, autor, ESTADO_TAG.removendo);
    // Os dados para recadastrar ficam guardados (a linha da tag some quando o Guarita confirmar).
    if (tag.guarita_frame) {
      await this.prisma.guarita_Backups.create({
        data: {
          id_condominio: tag.id_condominio,
          id_device: tag.id_device,
          motivo: 'remocao',
          total: 1,
          dados: JSON.stringify([tag.guarita_frame]),
        },
      });
    }
    return true;
  }

  /** Remove várias (exclusão de morador). Devolve quantas remoções entraram na fila. */
  async enfileirarRemocoes(ids: number[], autor: string): Promise<number> {
    let n = 0;
    for (const id of ids) {
      try {
        if (await this.enfileirarRemocao(id, autor)) n++;
      } catch (err: any) {
        this.logger.warn(`Remoção da tag ${id} no Guarita não entrou na fila: ${err?.message ?? err}`);
      }
    }
    return n;
  }

  private async tagDoGuarita(idTag: number) {
    const tag = await this.prisma.tags.findUnique({ where: { id: Number(idTag) } });
    if (!tag || tag.id_device == null || tag.guarita_tipo == null || !tag.guarita_serial) {
      throw new NotFoundException('Dispositivo do Guarita não encontrado.');
    }
    return tag;
  }

  private async criarGravacao(tag: any, tipo: 'cadastrar' | 'editar' | 'apagar', frame: string, autor: string, estado: string) {
    await this.garantirCopiaAntesDaGravacao(tag.id_condominio, tag.id_device, autor);
    const op = await this.prisma.guarita_Operacoes.create({
      data: {
        id_condominio: tag.id_condominio,
        id_device: tag.id_device,
        id_tag: tag.id,
        tipo,
        frame_hex: frame,
        estado: ESTADO_OP.pendente,
        criado_por: String(autor ?? 'Portaria').slice(0, 120),
      },
    });
    await this.prisma.tags.update({ where: { id: tag.id }, data: { guarita_estado: estado, guarita_erro: null } });
    await this.garantirAtualizarReceptores(tag.id_condominio, tag.id_device);
    return { id_operacao: op.id };
  }

  /**
   * Primeira gravação de um Guarita sem cópia de segurança: cria antes uma
   * `importar` (a fila não entrega gravação enquanto não houver cópia).
   */
  private async garantirCopiaAntesDaGravacao(idCondominio: number, idDevice: number, autor: string) {
    const copias = await this.prisma.guarita_Backups.count({
      where: { id_device: idDevice, motivo: { in: ['importacao', 'conferencia'] } },
    });
    if (copias > 0) return;
    const leitura = await this.prisma.guarita_Operacoes.count({
      where: { id_device: idDevice, tipo: { in: TIPOS_LEITURA }, estado: { in: [...ABERTAS, ESTADO_OP.processando] } },
    });
    if (leitura > 0) return;
    await this.prisma.guarita_Operacoes.create({
      data: {
        id_condominio: idCondominio,
        id_device: idDevice,
        tipo: 'importar',
        estado: ESTADO_OP.pendente,
        criado_por: `Cópia de segurança antes da primeira gravação (${String(autor ?? '').slice(0, 60)})`.slice(0, 120),
      },
    });
  }

  // ------------------------------------------------------------ o frame

  /**
   * Os 39 bytes do cadastro/edição: unidade e bloco da unidade (casada ou a do
   * morador), rótulo = nome curto do morador, marca, cor e placa do veículo.
   * Grupo/receptores: na edição, os do Guarita (base); no cadastro, os mais
   * frequentes entre os dispositivos do mesmo tipo já lidos deste Guarita
   * (0x00 / 0xFF se não houver nenhum).
   */
  async montarFrame(tag: any, base: string | null): Promise<string> {
    if (tag.guarita_tipo === 1 && (tag.guarita_contador == null || !Number.isInteger(tag.guarita_contador))) {
      throw new BadRequestException(MSG_RF_SO_POR_CAPTURA);
    }
    const veiculo = await this.prisma.veiculos.findFirst({
      where: { id_tag: tag.id, ativo: 1 },
      select: { id: true, placa: true, cor: true, marca_modelo: true, id_morador: true },
    });
    if (!veiculo) throw new BadRequestException('Vincule o dispositivo a um veículo antes de gravar no Guarita.');
    const morador = await this.prisma.moradores.findUnique({
      where: { id: veiculo.id_morador },
      select: { nome: true, bloco: true, apartamento: true },
    });
    // A unidade do morador (cadastro do Prestare) vale; sem ela, a unidade casada na importação.
    let bloco: string | null = morador?.bloco ?? null;
    let apto: string | null = morador?.apartamento ?? null;
    if (!String(apto ?? '').trim() && tag.id_apto != null) {
      const a = await this.prisma.apartamentos.findUnique({ where: { id: tag.id_apto }, select: { bloco: true, apto: true } });
      if (a) {
        bloco = a.bloco;
        apto = a.apto;
      }
    }
    const unidade = numeroDaUnidade(apto);
    if (unidade === null || unidade > 9999) {
      throw new BadRequestException('A unidade do morador não cabe no Guarita (número de 0 a 9999).');
    }
    const blocoGuarita = String(bloco ?? '').trim() ? String(bloco) : 'A';
    let grupo = 0x00;
    let receptores = 0xff;
    if (!base) {
      const padrao = await this.padraoDoGuarita(tag.id_device, tag.guarita_tipo);
      grupo = padrao.grupo;
      receptores = padrao.receptores;
    }
    try {
      return codificarDispositivo(
        {
          tipo: tag.guarita_tipo,
          serialHex: tag.guarita_serial,
          contador: tag.guarita_contador ?? null,
          unidade,
          bloco: blocoGuarita,
          rotulo: nomeCurto(morador?.nome),
          marca: marcaParaByte(veiculo.marca_modelo),
          cor: corParaByte(veiculo.cor),
          placa: normalizarPlaca(veiculo.placa),
          grupo,
          receptores,
        },
        base,
      );
    } catch (err: any) {
      if (/Bloco/.test(err?.message ?? '')) {
        throw new BadRequestException('O bloco do morador não cabe no Guarita (A a Z ou 1 a 230).');
      }
      throw new BadRequestException(`Dados do dispositivo inválidos para o Guarita: ${err?.message ?? err}`);
    }
  }

  /** Grupo e receptores mais frequentes entre os dispositivos do mesmo tipo já lidos deste Guarita. */
  private async padraoDoGuarita(idDevice: number, tipo: number): Promise<{ grupo: number; receptores: number }> {
    const tags = await this.prisma.tags.findMany({
      where: { id_device: idDevice, guarita_tipo: tipo, guarita_frame: { not: null } },
      select: { guarita_frame: true },
    });
    const grupos = new Map<number, number>();
    const recs = new Map<number, number>();
    for (const t of tags) {
      try {
        const d = decodificarDispositivo(t.guarita_frame as string);
        grupos.set(d.grupo, (grupos.get(d.grupo) ?? 0) + 1);
        recs.set(d.receptores, (recs.get(d.receptores) ?? 0) + 1);
      } catch {
        /* frame ilegível: não vota */
      }
    }
    const maisFrequente = (m: Map<number, number>, padrao: number) => {
      let melhor = padrao;
      let n = 0;
      for (const [v, c] of m) {
        if (c > n) {
          melhor = v;
          n = c;
        }
      }
      return melhor;
    };
    return { grupo: maisFrequente(grupos, 0x00), receptores: maisFrequente(recs, 0xff) };
  }

  // ------------------------------------------------- aprovação (app → console)

  /**
   * `POST …/dispositivos/:idTag/aprovar { tipo?, codigo_impresso? }`: a tag que o
   * morador vinculou no app vai para este Guarita. Tipo padrão: TAG passivo (6)
   * — o app fala em "tag/adesivo"; o console pode mandar 2 (TAG ativo) ou 3
   * (cartão). RF nunca (o contador só vem na captura). O serial sai do código
   * impresso (W: 015 02158), informado agora ou digitado pelo morador.
   */
  async aprovar(
    idCondominio: number,
    deviceId: number,
    idTag: number,
    corpo: { tipo?: unknown; codigo_impresso?: unknown } | undefined,
    autor: string,
  ) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(idTag), id_condominio: device.id_condominio, guarita_estado: ESTADO_TAG.aguardandoAprovacao },
    });
    if (!tag) throw new NotFoundException('Não há tag aguardando aprovação com este id.');
    const tipo = corpo?.tipo === undefined || corpo?.tipo === null ? tag.guarita_tipo ?? 6 : Number(corpo.tipo);
    if (tipo === 1) throw new BadRequestException(MSG_RF_SO_POR_CAPTURA);
    if (![2, 3, 6].includes(tipo)) throw new BadRequestException('Tipo inválido: use 2 (TAG ativo), 3 (cartão) ou 6 (TAG passivo).');
    let serial = tag.guarita_serial ?? null;
    if (corpo?.codigo_impresso !== undefined && corpo?.codigo_impresso !== null && corpo?.codigo_impresso !== '') {
      serial = wiegandParaSerial(String(corpo.codigo_impresso));
      if (!serial) throw new BadRequestException(MSG_CODIGO_IMPRESSO_INVALIDO);
    }
    if (!serial) {
      throw new BadRequestException('Informe o código impresso na tag (ex.: 015 02158) para gravar no Guarita.');
    }
    const repetida = await this.prisma.tags.findFirst({
      where: { id_device: device.id, guarita_tipo: tipo, guarita_serial: serial, id: { not: tag.id } },
      select: { id: true },
    });
    if (repetida) throw new BadRequestException('Este dispositivo já está cadastrado neste Guarita.');
    await this.prisma.tags.update({
      where: { id: tag.id },
      data: { id_device: device.id, guarita_tipo: tipo, guarita_serial: serial, guarita_contador: null },
    });
    const { id_operacao } = await this.enfileirarCadastro(tag.id, autor);
    return { id_tag: tag.id, estado: ESTADO_TAG.pendente, id_operacao };
  }

  /**
   * `POST …/dispositivos/:idTag/recusar`: a tag não vai para o Guarita. Ela
   * continua ligada ao veículo como tag comum (a antena/leitor de sempre segue
   * como no condomínio sem Guarita); só perde o vínculo com o Guarita.
   */
  async recusar(idCondominio: number, deviceId: number, idTag: number) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(idTag), id_condominio: device.id_condominio, guarita_estado: ESTADO_TAG.aguardandoAprovacao },
      select: { id: true },
    });
    if (!tag) throw new NotFoundException('Não há tag aguardando aprovação com este id.');
    await this.prisma.tags.update({
      where: { id: tag.id },
      data: { id_device: null, guarita_estado: null, guarita_erro: null, guarita_tipo: null, guarita_serial: null },
    });
    return { id_tag: tag.id, estado: null };
  }

  /**
   * Morador vinculou uma tag no app, num condomínio com Guarita: a tag fica
   * `aguardando_aprovacao` no (primeiro) Guarita, sem operação. O serial sai do
   * código digitado quando ele está no formato impresso (015 02158).
   */
  async marcarAguardandoAprovacao(idTag: number, idDevice: number, digitado: string) {
    await this.prisma.tags.update({
      where: { id: Number(idTag) },
      data: {
        id_device: idDevice,
        guarita_estado: ESTADO_TAG.aguardandoAprovacao,
        guarita_erro: null,
        guarita_serial: wiegandParaSerial(digitado),
      },
    });
  }

  // ------------------------------------------------------------ resultado

  /**
   * Efeito do resultado de uma gravação ou do 29. Reivindica a operação por
   * UPDATE condicional (resultado repetido ou de outra instância: sem efeito).
   *
   *  - cadastrar/editar ok → tag `gravado` com o frame confirmado; falha → `falhou` + mensagem;
   *  - apagar ok (ou 0x03 "não encontrado": já não está lá) → a tag some do Prestare;
   *  - atualizar_receptores ok → as `gravado` deste Guarita até o envio do 29 viram `ativo`.
   * Se a tag já tem outra gravação aberta depois desta, o estado dela não é
   * sobrescrito (vale o da operação mais nova quando o resultado dela chegar).
   */
  async aplicarResultado(idOperacao: number, r: ResultadoGravacao): Promise<void> {
    const op = await this.prisma.guarita_Operacoes.findUnique({ where: { id: Number(idOperacao) } });
    if (!op) return;
    const apagouJa = op.tipo === 'apagar' && !r.ok && r.codigo === 0x03;
    const ok = r.ok || apagouJa;
    const mensagem = ok ? null : (r.erro ?? (r.codigo !== undefined ? MENSAGENS_67[r.codigo] : undefined) ?? 'O Guarita não respondeu.');
    const agora = new Date();
    const reivindicou = await this.prisma.guarita_Operacoes.updateMany({
      where: { id: op.id, estado: { in: ABERTAS } },
      data: {
        estado: ok ? ESTADO_OP.ok : ESTADO_OP.falhou,
        codigo: r.codigo ?? null,
        erro: mensagem ? mensagem.slice(0, 255) : null,
        concluida_em: agora,
      },
    });
    if (reivindicou.count !== 1) return;

    if (op.tipo === 'atualizar_receptores') {
      if (!ok) return;
      // O 29 sai depois da última gravação do lote (e a fila só entrega o lote
      // seguinte depois deste resultado): tudo que está "gravado" agora passou por ele.
      await this.prisma.tags.updateMany({
        where: {
          id_device: op.id_device,
          guarita_estado: ESTADO_TAG.gravado,
          guarita_em: { lte: agora },
        },
        data: { guarita_estado: ESTADO_TAG.ativo },
      });
      return;
    }
    if (!TIPOS_GRAVACAO.includes(op.tipo) || op.id_tag == null) return;

    const tag = await this.prisma.tags.findUnique({ where: { id: op.id_tag } });
    if (!tag) return;
    const maisNova = await this.prisma.guarita_Operacoes.count({
      where: { id_tag: tag.id, tipo: { in: TIPOS_GRAVACAO }, estado: { in: ABERTAS }, id: { gt: op.id } },
    });

    if (op.tipo === 'apagar') {
      if (ok) {
        if (maisNova > 0) return; // recadastrada depois: a tag continua
        await this.prisma.$transaction([
          this.prisma.veiculos.updateMany({ where: { id_tag: tag.id }, data: { id_tag: null } }),
          this.prisma.tags.delete({ where: { id: tag.id } }),
        ]);
        return;
      }
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: {
          guarita_erro: `Remoção: ${mensagem}`.slice(0, 255),
          ...(maisNova === 0 && { guarita_estado: ESTADO_TAG.falhou }),
        },
      });
      return;
    }

    if (ok) {
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: {
          guarita_frame: op.frame_hex,
          guarita_em: agora,
          guarita_erro: null,
          ...(maisNova === 0 && { guarita_estado: ESTADO_TAG.gravado }),
        },
      });
      return;
    }
    await this.prisma.tags.update({
      where: { id: tag.id },
      data: {
        guarita_erro: String(mensagem).slice(0, 255),
        ...(maisNova === 0 && { guarita_estado: ESTADO_TAG.falhou }),
      },
    });
  }

  /**
   * Toda gravação leva junto um `atualizar_receptores` (no máximo um ainda não
   * entregue por Guarita): o agente só informa o resultado do 29 automático
   * quando há essa operação na fila.
   */
  private async garantirAtualizarReceptores(idCondominio: number, idDevice: number) {
    const pendente = await this.prisma.guarita_Operacoes.count({
      where: { id_device: idDevice, tipo: 'atualizar_receptores', estado: ESTADO_OP.pendente },
    });
    if (pendente > 0) return;
    await this.prisma.guarita_Operacoes.create({
      data: {
        id_condominio: idCondominio,
        id_device: idDevice,
        tipo: 'atualizar_receptores',
        estado: ESTADO_OP.pendente,
        criado_por: 'Depois das gravações',
      },
    });
  }
}
