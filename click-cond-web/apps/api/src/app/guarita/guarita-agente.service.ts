import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FacialService } from '../facial/facial.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import { GuaritaImportacaoService } from './guarita-importacao.service';
import { CRIADO_POR_RECADASTRO_INCERTO, GuaritaOperacoesService, apagarComUnidade } from './guarita-operacoes.service';
import { GuaritaEventosService } from './guarita-eventos.service';
import { blocoParaByte, codificarApagarDoFrame, decodificarDispositivo } from './guarita-frame.util';
import {
  ESTADO_OP,
  ESTADO_TTL_MS,
  MAX_OPERACOES_POR_PEDIDO,
  NAO_CADASTRADO_TTL_MS,
  OPERACOES_DE_GRAVACAO,
  OPERACOES_DE_LEITURA,
  OPERACOES_DO_AGENTE,
  REENTREGA_MS,
  TIPO_DEVICE_GUARITA,
  TIPOS_DISPOSITIVO_GUARITA,
  chaveEstadoGuarita,
  prefixoNaoCadastrado,
} from './guarita.constantes';
import {
  booleano,
  booleanoOpcional,
  dataOuNula,
  inteiro,
  inteiroOuNulo,
  textoCurto,
} from './guarita-validacao.util';

/** O Guarita resolvido pelo token do agente (nunca carrega a palavra de autorização). */
export interface GuaritaDoAgente {
  id: number;
  id_condominio: number;
  nome: string;
}

/** Item de `GET operacoes` (contrato fixo com o driver do agente). */
export interface OperacaoEntregue {
  id: number;
  tipo: string;
  frame_hex?: string;
  /**
   * `editar` e `apagar`: unidade e byte do bloco que o Prestare acredita estarem
   * no Guarita para este dispositivo. O agente lê antes de escrever e, se forem
   * outros, NÃO escreve e devolve `{ ok:false, conflito:true, lido }`.
   */
  esperado?: { unidade: number; bloco: number };
}

/** Corpo de `POST operacoes/:id/resultado` (contrato fixo com o driver do agente). */
export interface ResultadoOperacaoDto {
  ok: boolean;
  codigo?: number;
  erro?: string;
  frames_hex?: string[];
  parte?: number;
  fim?: boolean;
  /** editar/apagar/cadastrar: o dispositivo está no Guarita em outra unidade; nada foi escrito. */
  conflito?: boolean;
  /** Com `conflito`: unidade e byte do bloco lidos no Guarita. */
  lido?: { unidade?: number; bloco?: number; frame_hex?: string } | null;
  /** cadastrar 0x02 na mesma unidade / apagar 0x03: já estava como pedido (ok normal). */
  ja_estava?: boolean;
  /** A pergunta foi escrita e a resposta não chegou (o agente não conseguiu conferir). */
  incerto?: boolean;
}

/** Corpo de `POST estado`. */
export interface EstadoGuaritaDto {
  conectado: boolean;
  autorizado: boolean;
  firmware?: string;
  total_dispositivos?: number;
  total_eventos?: number;
  relogio_delta_s?: number;
  erro?: string;
}

/** Estado de conexão guardado (Estado_Compartilhado, vale para as duas instâncias). */
export interface EstadoGuaritaGuardado {
  conectado: boolean;
  autorizado: boolean;
  firmware: string | null;
  total_dispositivos: number | null;
  total_eventos: number | null;
  relogio_delta_s: number | null;
  erro: string | null;
  recebido_em: string;
}

/** Corpo de `POST nao-cadastrado`. */
export interface NaoCadastradoDto {
  comando: number;
  tipo: number;
  serial_hex: string;
  contador: number | null;
  receptor: number | null;
  bateria_fraca: boolean;
  recebido_em: string;
}

/** "Não cadastrado" guardado para a captura (Estado_Compartilhado). */
export interface NaoCadastradoGuardado {
  comando: number;
  tipo: number;
  serial_hex: string;
  contador: number | null;
  receptor: number | null;
  bateria_fraca: boolean;
  /** Hora do agente (informativa). */
  recebido_em: string | null;
  /** Hora da nuvem: é por ela que a janela de captura filtra. */
  chegou_em: string;
}

/** Tipos que o agente executa, para os filtros do Prisma. */
const TIPOS_DO_AGENTE: string[] = [...OPERACOES_DO_AGENTE];
const TIPOS_GRAVACAO: readonly string[] = OPERACOES_DE_GRAVACAO;
const TIPOS_LEITURA: readonly string[] = OPERACOES_DE_LEITURA;

/**
 * Rotas do agente para o Módulo Guarita (`/facial/agent/condo/:token/guarita/:deviceId/*`).
 *
 * Tudo que é estado mora no banco (a API roda em duas instâncias): a fila em
 * Guarita_Operacoes, a entrega reivindicada por UPDATE condicional, o estado de
 * conexão e os "não cadastrados" em Estado_Compartilhado.
 *
 * NÃO validado em aparelho.
 */
@Injectable()
export class GuaritaAgenteService {
  private readonly logger = new Logger(GuaritaAgenteService.name);
  private readonly estado: EstadoCompartilhado;

  constructor(
    private readonly prisma: PrismaService,
    private readonly facial: FacialService,
    @Optional() private readonly importacao?: GuaritaImportacaoService,
    @Optional() private readonly operacoes?: GuaritaOperacoesService,
    @Optional() private readonly eventos?: GuaritaEventosService,
  ) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  /**
   * Token do agente (agent_token do condomínio ou, agente antigo, o webhook_token
   * de um dispositivo) + id do Guarita. Token inválido → 401 (mesmo das outras
   * rotas condo/*); Guarita de outro condomínio, de outro dispositivo do token,
   * inativo ou que não é `tipo 'guarita'` → 404.
   */
  async resolverGuarita(token: string, deviceIdBruto: unknown): Promise<GuaritaDoAgente> {
    const deviceId = Number(deviceIdBruto);
    if (!Number.isInteger(deviceId) || deviceId <= 0) throw new NotFoundException('Guarita não encontrado.');
    const agente = await this.facial.resolveAgente(token);
    if (agente.viaTokenDispositivo && agente.idDispositivo !== deviceId) {
      throw new NotFoundException('Guarita não encontrado.');
    }
    const d = await this.prisma.facial_Devices.findFirst({
      where: { id: deviceId, id_condominio: agente.idCondominio, ativo: 1, tipo: TIPO_DEVICE_GUARITA },
      // Sem api_password: a palavra de autorização não passa por aqui.
      select: { id: true, id_condominio: true, nome: true },
    });
    if (!d) throw new NotFoundException('Guarita não encontrado.');
    return d;
  }

  // ---------------------------------------------------------------- operações

  /**
   * Próximo lote de operações, em ordem de id, no máximo 50.
   *
   * Ordem estrita, mesmo com perda: enquanto houver operação `enviada` há menos
   * de 5 min (lote em voo) nada novo sai; passados 5 min sem resultado, o lote
   * volta a sair a partir da mais antiga (o agente ignora id repetido). Cada
   * operação é reivindicada por UPDATE condicional — com duas instâncias, só uma
   * entrega; o lote para na primeira que a outra instância levou.
   *
   * Barreiras: importação/conferência sai sozinha (fecha o lote); gravação
   * (67) só sai depois que existe cópia de segurança do cadastro. O
   * `atualizar_receptores` sai junto com as gravações do lote: o agente o junta
   * ao 29 automático (um só, 30 s depois da última gravação) e devolve o
   * resultado do 29 nele.
   */
  async buscarOperacoes(device: GuaritaDoAgente, agora = new Date()): Promise<{ operacoes: OperacaoEntregue[] }> {
    const limiteReentrega = new Date(agora.getTime() - REENTREGA_MS);
    const abertas = await this.prisma.guarita_Operacoes.findMany({
      where: {
        id_device: device.id,
        tipo: { in: TIPOS_DO_AGENTE },
        estado: { in: [ESTADO_OP.pendente, ESTADO_OP.enviada, ESTADO_OP.processando] },
      },
      orderBy: { id: 'asc' },
      take: MAX_OPERACOES_POR_PEDIDO * 4,
      select: { id: true, tipo: true, frame_hex: true, estado: true, enviada_em: true, id_tag: true, criado_por: true },
    });

    // Importação que ficou "processando" (instância caiu no meio) além do
    // prazo: não trava a fila para sempre — vira falha visível.
    for (const op of abertas) {
      if (op.estado === ESTADO_OP.processando && (!op.enviada_em || op.enviada_em < limiteReentrega)) {
        await this.prisma.guarita_Operacoes.updateMany({
          where: { id: op.id, estado: ESTADO_OP.processando },
          data: { estado: ESTADO_OP.falhou, erro: 'A leitura do Guarita foi interrompida. Tente de novo.', concluida_em: agora },
        });
        op.estado = ESTADO_OP.falhou;
      }
    }
    const fila = abertas.filter((o) => o.estado !== ESTADO_OP.falhou);
    const emVoo = fila.some(
      (o) =>
        o.estado === ESTADO_OP.processando ||
        (o.estado === ESTADO_OP.enviada && o.enviada_em && o.enviada_em >= limiteReentrega),
    );
    if (emVoo || fila.length === 0) return { operacoes: [] };

    let temCopia: boolean | null = null;
    const lote: OperacaoEntregue[] = [];
    // Uma gravação por tag por lote: a seguinte da mesma tag só sai depois do
    // resultado da anterior, com o `esperado` do que ela deixou confirmado.
    const tagsNoLote = new Set<number>();
    for (const op of fila) {
      if (lote.length >= MAX_OPERACOES_POR_PEDIDO) break;
      if (TIPOS_GRAVACAO.includes(op.tipo)) {
        if (temCopia === null) temCopia = await this.temCopiaDeSeguranca(device.id);
        if (!temCopia) break;
      }
      if (TIPOS_GRAVACAO.includes(op.tipo) && op.id_tag != null) {
        if (tagsNoLote.has(op.id_tag)) continue;
        tagsNoLote.add(op.id_tag);
      }
      // editar/apagar levam o que o Prestare acredita estar no Guarita; sem
      // isso não há como o agente conferir, e a operação não sai.
      let esperado: { unidade: number; bloco: number } | undefined;
      if (op.tipo === 'cadastrar' && op.criado_por === CRIADO_POR_RECADASTRO_INCERTO && this.operacoes) {
        op.frame_hex = await this.operacoes.atualizarFrameDoRecadastro(op);
      }
      if ((op.tipo === 'editar' || op.tipo === 'apagar') && this.operacoes) {
        const conferencia = await this.esperadoDaOperacao(op);
        if (!conferencia) continue;
        esperado = conferencia;
      }
      const r = await this.prisma.guarita_Operacoes.updateMany({
        where: {
          id: op.id,
          OR: [
            { estado: ESTADO_OP.pendente },
            { estado: ESTADO_OP.enviada, enviada_em: { lt: limiteReentrega } },
          ],
        },
        data: { estado: ESTADO_OP.enviada, enviada_em: agora },
      });
      if (r.count !== 1) break;
      // apagar com o frame da unidade a conferir: para o agente, só tipo + serial.
      const frameEntregue = op.tipo === 'apagar' && apagarComUnidade(op.frame_hex) ? codificarApagarDoFrame(op.frame_hex as string) : op.frame_hex;
      lote.push({
        id: op.id,
        tipo: op.tipo,
        ...(frameEntregue ? { frame_hex: frameEntregue } : {}),
        ...(esperado ? { esperado } : {}),
      });
      if (TIPOS_LEITURA.includes(op.tipo)) break;
    }
    return { operacoes: lote };
  }

  /**
   * (unidade, bloco) que o Prestare acredita estar no Guarita para a tag desta
   * operação, tirado do frame conhecido (lido na importação ou confirmado pela
   * última gravação). Sem frame conhecido, ou tag fora da lista branca: a
   * operação é cancelada (nunca sai às cegas) e o motivo fica na tag.
   */
  private async esperadoDaOperacao(op: { id: number; id_tag: number | null; tipo?: string; frame_hex?: string | null }): Promise<{ unidade: number; bloco: number } | null> {
    const ops = this.operacoes as GuaritaOperacoesService;
    const tag = op.id_tag != null ? await this.prisma.tags.findUnique({ where: { id: op.id_tag } }) : null;
    // apagar de uma remoção F2: a unidade a conferir é a do próprio frame da operação.
    const proprio = op.tipo === 'apagar' && apagarComUnidade(op.frame_hex) ? (op.frame_hex as string) : null;
    const frame = tag && (await ops.podeEscrever(tag)) ? (proprio ?? (await ops.frameConhecido(tag))) : null;
    let esperado: { unidade: number; bloco: number } | null = null;
    if (frame) {
      try {
        const d = decodificarDispositivo(frame);
        esperado = { unidade: d.unidade, bloco: blocoParaByte(d.bloco) };
      } catch {
        esperado = null;
      }
    }
    if (esperado) return esperado;
    const motivo = 'Sem dados do Guarita para conferir este dispositivo antes de escrever. Faça a conferência.';
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id: op.id, estado: { in: [ESTADO_OP.pendente, ESTADO_OP.enviada] } },
      data: { estado: ESTADO_OP.cancelada, erro: motivo, concluida_em: new Date() },
    });
    if (tag) await this.prisma.tags.update({ where: { id: tag.id }, data: { guarita_erro: motivo } });
    return null;
  }

  /** Há cópia de segurança completa (importação ou conferência) deste Guarita? */
  async temCopiaDeSeguranca(idDevice: number): Promise<boolean> {
    const n = await this.prisma.guarita_Backups.count({
      where: { id_device: idDevice, motivo: { in: ['importacao', 'conferencia'] } },
    });
    return n > 0;
  }

  /**
   * Resultado de uma operação. Idempotente: operação já concluída (ok, falhou,
   * cancelada) responde 200 sem regravar nada.
   */
  async registrarResultado(device: GuaritaDoAgente, idOperacaoBruto: unknown, corpo: unknown): Promise<{ ok: true }> {
    const idOperacao = Number(idOperacaoBruto);
    if (!Number.isInteger(idOperacao) || idOperacao <= 0) throw new NotFoundException('Operação não encontrada.');
    const op = await this.prisma.guarita_Operacoes.findFirst({
      where: { id: idOperacao, id_device: device.id, tipo: { in: TIPOS_DO_AGENTE } },
      select: { id: true, tipo: true, estado: true },
    });
    if (!op) throw new NotFoundException('Operação não encontrada.');
    if (op.estado === ESTADO_OP.ok || op.estado === ESTADO_OP.falhou || op.estado === ESTADO_OP.cancelada) {
      return { ok: true };
    }
    const r = this.validarResultado(corpo);
    if (TIPOS_LEITURA.includes(op.tipo)) {
      if (!this.importacao) throw new Error('GuaritaImportacaoService ausente');
      await this.importacao.receberResultado(device, op, r);
      return { ok: true };
    }
    if (this.operacoes) {
      // Gravação (67) e atualizar receptores (29): efeito nas tags.
      await this.operacoes.aplicarResultado(op.id, r);
      if (!r.ok) this.logger.warn(`Guarita ${device.id}: operação ${op.id} (${op.tipo}) falhou (código ${r.codigo ?? '-'})`);
      return { ok: true };
    }
    const agora = new Date();
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id: op.id, estado: { in: [ESTADO_OP.pendente, ESTADO_OP.enviada] } },
      data: {
        estado: r.ok ? ESTADO_OP.ok : ESTADO_OP.falhou,
        codigo: r.codigo ?? null,
        erro: r.ok ? null : r.erro ?? 'O Guarita não confirmou a operação.',
        concluida_em: agora,
      },
    });
    if (!r.ok) this.logger.warn(`Guarita ${device.id}: operação ${op.id} (${op.tipo}) falhou (código ${r.codigo ?? '-'})`);
    return { ok: true };
  }

  validarResultado(corpo: unknown): ResultadoOperacaoDto & { erro?: string } {
    const b = (corpo ?? {}) as Record<string, unknown>;
    const ok = booleano(b.ok, 'ok');
    const codigo = inteiroOuNulo(b.codigo, 'codigo', 0, 255);
    const erro = textoCurto(b.erro, 255);
    let frames: string[] | undefined;
    if (b.frames_hex !== undefined && b.frames_hex !== null) {
      if (!Array.isArray(b.frames_hex)) throw new BadRequestException('Campo "frames_hex" inválido.');
      frames = b.frames_hex as string[];
    }
    const parte = inteiroOuNulo(b.parte, 'parte', 0, 100000);
    const fim = booleanoOpcional(b.fim);
    const conflito = b.conflito === true;
    const jaEstava = b.ja_estava === true;
    const incerto = b.incerto === true;
    let lido: { unidade?: number; bloco?: number; frame_hex?: string } | null = null;
    if (b.lido && typeof b.lido === 'object') {
      const l = b.lido as Record<string, unknown>;
      // R7: `lido` é informativo — fora de faixa é ignorado, sem derrubar o resultado.
      const dentro = (v: unknown, max: number): number | null =>
        typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
      const unidade = dentro(l.unidade, 9999);
      const bloco = dentro(l.bloco, 255);
      const frameLido = typeof l.frame_hex === 'string' && /^[0-9a-fA-F]{78}$/.test(l.frame_hex.trim()) ? l.frame_hex.trim().toUpperCase() : null;
      const montado = {
        ...(unidade !== null && bloco !== null && { unidade, bloco }),
        ...(frameLido && { frame_hex: frameLido }),
      };
      lido = Object.keys(montado).length ? montado : null;
    }
    return {
      ok,
      ...(codigo !== null && { codigo }),
      ...(erro !== null && { erro }),
      ...(frames !== undefined && { frames_hex: frames }),
      ...(parte !== null && { parte }),
      ...(fim !== undefined && { fim }),
      ...(lido && { lido }),
      ...(conflito && { conflito }),
      ...(jaEstava && { ja_estava: true }),
      ...(incerto && { incerto: true }),
    };
  }

  // ------------------------------------------------------------------ eventos

  /**
   * Lote de eventos do Guarita: só registra (GuaritaEventosService) — nunca
   * passa por runWebhook/processAgentEvent nem aciona relé.
   */
  async registrarEventos(device: GuaritaDoAgente, corpo: unknown): Promise<{ aceitos: number; novos?: number }> {
    const b = (corpo ?? {}) as Record<string, unknown>;
    if (!Array.isArray(b.eventos)) throw new BadRequestException('Campo "eventos" inválido.');
    if (!this.eventos) return { aceitos: 0 };
    return this.eventos.registrarEventos(device, corpo);
  }

  // ---------------------------------------------------------- não cadastrado

  /**
   * Dispositivo não cadastrado acionado (comandos 42, 46, 90): fica 10 min no
   * Estado_Compartilhado para a captura do console (duas instâncias enxergam).
   * O mesmo serial de novo atualiza a linha, sem perder o contador que um 42/90
   * já trouxe (o 46 não traz o contador completo).
   */
  async registrarNaoCadastrado(device: GuaritaDoAgente, corpo: unknown): Promise<{ ok: true }> {
    const b = (corpo ?? {}) as Record<string, unknown>;
    const comando = inteiro(b.comando, 'comando', 0, 255);
    if (![42, 46, 90].includes(comando)) throw new BadRequestException('Campo "comando" inválido.');
    const tipo = inteiro(b.tipo, 'tipo', 0, 255);
    if (!(TIPOS_DISPOSITIVO_GUARITA as readonly number[]).includes(tipo)) {
      throw new BadRequestException('Campo "tipo" inválido.');
    }
    const serial = typeof b.serial_hex === 'string' ? b.serial_hex.trim().toUpperCase() : '';
    const tamanho = tipo === 1 ? 7 : 6;
    if (!/^[0-9A-F]+$/.test(serial) || serial.length > 8) throw new BadRequestException('Campo "serial_hex" inválido.');
    const serialHex = serial.replace(/^0+(?=.)/, '').padStart(tamanho, '0');
    if (serialHex.length > tamanho) throw new BadRequestException('Campo "serial_hex" inválido.');
    const contador = inteiroOuNulo(b.contador, 'contador', 0, 0xffff);
    const receptor = inteiroOuNulo(b.receptor, 'receptor', 0, 255);
    const chave = `${prefixoNaoCadastrado(device.id)}${tipo}:${serialHex}`;
    const anterior = (await this.estado.obter<NaoCadastradoGuardado>(chave))?.valor;
    const valor: NaoCadastradoGuardado = {
      comando,
      tipo,
      serial_hex: serialHex,
      // 46 (sem contador) depois de um 42/90 não apaga o contador já recebido.
      contador: contador ?? anterior?.contador ?? null,
      receptor,
      bateria_fraca: b.bateria_fraca === true,
      recebido_em: dataOuNula(b.recebido_em)?.toISOString() ?? null,
      chegou_em: new Date().toISOString(),
    };
    await this.estado.definir(chave, valor, NAO_CADASTRADO_TTL_MS);
    return { ok: true };
  }

  /** "Não cadastrados" recebidos deste Guarita (ainda dentro dos 10 min). */
  async listarNaoCadastrados(idDevice: number): Promise<NaoCadastradoGuardado[]> {
    const linhas = await this.estado.listarPorPrefixo<NaoCadastradoGuardado>(prefixoNaoCadastrado(idDevice));
    return linhas.map((l) => l.valor);
  }

  // ------------------------------------------------------------------- estado

  /**
   * Estado da conexão do agente com o Guarita. Guarda no Estado_Compartilhado
   * (vale 3 min; o agente manda a cada 60 s) e, conectado, marca
   * `ultima_sincr` do device (última comunicação confirmada).
   */
  async registrarEstado(device: GuaritaDoAgente, corpo: unknown): Promise<{ ok: true }> {
    const b = (corpo ?? {}) as Record<string, unknown>;
    const conectado = booleano(b.conectado, 'conectado');
    const autorizado = booleano(b.autorizado, 'autorizado');
    const anterior = await this.lerEstado(device.id);
    const valor: EstadoGuaritaGuardado = {
      conectado,
      autorizado,
      firmware: textoCurto(b.firmware, 40),
      total_dispositivos: inteiroOuNulo(b.total_dispositivos, 'total_dispositivos', 0, 1_000_000),
      total_eventos: inteiroOuNulo(b.total_eventos, 'total_eventos', 0, 1_000_000),
      relogio_delta_s: inteiroOuNulo(
        typeof b.relogio_delta_s === 'number' ? Math.round(b.relogio_delta_s) : b.relogio_delta_s,
        'relogio_delta_s',
        -10 * 365 * 86400,
        10 * 365 * 86400,
      ),
      erro: textoCurto(b.erro, 255),
      recebido_em: new Date().toISOString(),
    };
    await this.estado.definir(chaveEstadoGuarita(device.id), valor, ESTADO_TTL_MS);
    if (conectado) {
      await this.prisma.facial_Devices.update({ where: { id: device.id }, data: { ultima_sincr: new Date() } });
      // (Re)conexão: as remoções que falharam ganham mais uma tentativa.
      if (!anterior?.conectado && this.operacoes) await this.operacoes.reenfileirarRemocoes(device.id);
    }
    return { ok: true };
  }

  /** Último estado reportado (null = nada nos últimos 3 min). */
  async lerEstado(idDevice: number): Promise<EstadoGuaritaGuardado | null> {
    return (await this.estado.obter<EstadoGuaritaGuardado>(chaveEstadoGuarita(idDevice)))?.valor ?? null;
  }
}
