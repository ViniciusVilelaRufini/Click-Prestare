import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import { SIGLA_TIPO } from './guarita.constantes';
import { EventoGuarita, chaveDedupEvento, dataDoEvento, decodificarEvento } from './guarita-frame.util';
import type { GuaritaDoAgente } from './guarita-agente.service';

/** Máximo de eventos por POST (o agente manda em lotes; o Guarita guarda 8.192). */
const MAX_EVENTOS_POR_LOTE = 2000;
/** Bateria fraca: no máximo um alerta por dispositivo a cada 7 dias. */
const BATERIA_INTERVALO_MS = 7 * 24 * 60 * 60 * 1000;

/** Tipo de alerta da portaria (`Guarita_Alertas.tipo`): nomes curtos, minúsculos, sem acento. */
export const TIPOS_ALERTA = {
  panico: 'panico',
  clonagem: 'clonagem',
  receptoresDesatualizados: 'receptores_desatualizados',
  portaViolada: 'porta_violada',
  portaAberta: 'porta_aberta',
  canalInibido: 'canal_inibido',
  despertaPorteiro: 'desperta_porteiro',
  sdRemovido: 'sd_removido',
  bateriaFraca: 'bateria_fraca',
} as const;

function alertaDoEvento(e: EventoGuarita): { tipo: string; titulo: string } | null {
  switch (e.tipo) {
    case 0x9:
      return { tipo: TIPOS_ALERTA.panico, titulo: e.flags1 === 0xff ? 'Pânico não atendido' : 'Pânico acionado' };
    case 0x8:
      return { tipo: TIPOS_ALERTA.clonagem, titulo: 'Tentativa de clonagem' };
    case 0x7:
      return { tipo: TIPOS_ALERTA.receptoresDesatualizados, titulo: 'Receptores não atualizados' };
    case 0x3:
      return { tipo: TIPOS_ALERTA.despertaPorteiro, titulo: e.flags1 === 0xff ? 'Desperta porteiro não atendido' : 'Desperta porteiro' };
    case 0xa:
      return { tipo: TIPOS_ALERTA.sdRemovido, titulo: e.flags1 === 0xff ? 'Cartão SD do Guarita cheio' : 'Cartão SD do Guarita removido' };
    case 0xc:
      if (e.flags1 === 0xf9) return { tipo: TIPOS_ALERTA.portaViolada, titulo: 'Porta violada' };
      if (e.flags1 === 0xff) return { tipo: TIPOS_ALERTA.portaAberta, titulo: 'Porta aberta' };
      if (e.flags1 === 0xc0) return { tipo: TIPOS_ALERTA.canalInibido, titulo: 'Canal inibido' };
      return null;
    default:
      return null;
  }
}

/**
 * Eventos do Guarita (frames de 16 bytes repassados pelo agente).
 *
 *  - Guarita_Eventos: um por conteúdo (índice único device+chave; a chave
 *    ignora o bit "lido") — duplicata, inclusive de outra instância, é ignorada;
 *  - tipos 0 (acionado) e 1 (passagem) → histórico em Acessos_Facial;
 *  - pânico, clonagem, receptores desatualizados, porta violada/aberta, canal
 *    inibido, desperta porteiro, SD removido e bateria fraca → Guarita_Alertas;
 *  - o resto (ligado, programação pelo PC, acionamento pelo PC...) fica só bruto.
 *
 * Este serviço NÃO depende do FacialService nem da ponte de comandos: nada
 * daqui chega a runWebhook/processAgentEvent/triggerRelay. O Guarita já
 * decidiu e abriu o portão — aqui só se registra.
 *
 * NÃO validado em aparelho.
 */
@Injectable()
export class GuaritaEventosService {
  private readonly logger = new Logger(GuaritaEventosService.name);
  private readonly estado: EstadoCompartilhado;

  constructor(private readonly prisma: PrismaService) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  async registrarEventos(device: GuaritaDoAgente, corpo: unknown): Promise<{ aceitos: number; novos: number }> {
    const b = (corpo ?? {}) as Record<string, unknown>;
    if (!Array.isArray(b.eventos)) throw new BadRequestException('Campo "eventos" inválido.');
    if (b.eventos.length > MAX_EVENTOS_POR_LOTE) throw new BadRequestException('Eventos demais num lote.');
    // 0 (ou ausente) = sem correção: o agente manda 0 quando não leu o relógio.
    const delta = typeof b.relogio_delta_s === 'number' && Number.isFinite(b.relogio_delta_s) ? Math.round(b.relogio_delta_s) : 0;
    // 1. Frames válidos do lote, uma vez cada (a chave ignora o bit "lido").
    const doLote = new Map<string, { frame: string; origem: string; evento: EventoGuarita }>();
    for (const item of b.eventos as unknown[]) {
      const ev = (item ?? {}) as Record<string, unknown>;
      const frame = typeof ev.frame_hex === 'string' ? ev.frame_hex.trim().toUpperCase() : '';
      if (!/^[0-9A-F]{32}$/.test(frame)) continue;
      const chave = chaveDedupEvento(device.id, frame);
      if (doLote.has(chave)) continue;
      doLote.set(chave, { frame, origem: ev.origem === 'recuperacao' ? 'recuperacao' : 'ao_vivo', evento: decodificarEvento(frame) });
    }
    const chaves = [...doLote.keys()];
    if (!chaves.length) return { aceitos: 0, novos: 0 };

    // 2. Uma leitura + um INSERT em lote (a recuperação relê até 8.192 eventos:
    //    os já registrados nem viram INSERT). O índice único (id_device, chave)
    //    continua sendo a defesa entre instâncias (skipDuplicates).
    const existentes = await this.prisma.guarita_Eventos.findMany({
      where: { id_device: device.id, chave: { in: chaves } },
      select: { chave: true, id_acesso: true },
    });
    const jaProcessados = new Set(existentes.filter((x: any) => x.id_acesso != null).map((x: any) => x.chave));
    const jaGravados = new Set(existentes.map((x: any) => x.chave));
    const inserir = chaves.filter((c) => !jaGravados.has(c));
    if (inserir.length) {
      await this.prisma.guarita_Eventos.createMany({
        data: inserir.map((chave) => {
          const x = doLote.get(chave) as { frame: string; origem: string; evento: EventoGuarita };
          return {
            id_condominio: device.id_condominio,
            id_device: device.id,
            chave,
            frame_hex: x.frame,
            ocorrido_em: dataDoEvento(x.evento.dataHora, delta),
            origem: x.origem,
          };
        }),
        skipDuplicates: true,
      });
    }

    // 3. Histórico e alertas: cada evento é REIVINDICADO (id_acesso nulo → 0)
    //    por uma instância só. Falhou no meio: volta a nulo e o reenvio refaz
    //    (antes, o P2002 do reenvio deixava o acesso fora do histórico).
    let novos = 0;
    for (const chave of chaves) {
      if (jaProcessados.has(chave)) continue;
      const x = doLote.get(chave) as { frame: string; origem: string; evento: EventoGuarita };
      const r = await this.prisma.guarita_Eventos.updateMany({
        where: { id_device: device.id, chave, id_acesso: null },
        data: { id_acesso: 0 },
      });
      if (r.count !== 1) continue;
      try {
        await this.processar(device, chave, x.frame, x.evento, dataDoEvento(x.evento.dataHora, delta));
        novos++;
      } catch (err: any) {
        await this.prisma.guarita_Eventos.updateMany({ where: { id_device: device.id, chave }, data: { id_acesso: null } }).catch(() => undefined);
        this.logger.warn(`Guarita ${device.id}: evento não registrado no histórico: ${err?.message ?? err}`);
      }
    }
    return { aceitos: chaves.length, novos };
  }

  /**
   * Histórico e alertas de UM evento já reivindicado. `Guarita_Eventos.id_acesso`:
   * nulo = ainda não processado; 0 = processado sem acesso no histórico; > 0 =
   * o acesso em Acessos_Facial.
   */
  private async processar(device: GuaritaDoAgente, chave: string, frame: string, e: EventoGuarita, ocorrido: Date | null) {
    if ((e.tipo === 0 || e.tipo === 1) && ocorrido) {
      const acesso = await this.registrarAcesso(device, e, ocorrido);
      if (acesso) {
        await this.prisma.guarita_Eventos.updateMany({ where: { id_device: device.id, chave }, data: { id_acesso: acesso } });
      }
    }
    const alerta = alertaDoEvento(e);
    if (alerta) await this.criarAlerta(device, alerta.tipo, alerta.titulo, e, frame, ocorrido);
    // Bateria (bit 7 de flags0) só vale com RF/TA nos tipos 0 e 9 (no tipo 1 o bit é "sem sentido").
    if ((e.tipo === 0 || e.tipo === 9) && (e.receptorTipo === 1 || e.receptorTipo === 2) && e.bateriaFraca) {
      const chave = `guarita:bateria:${device.id}:${e.receptorTipo}:${e.serialHex}`;
      if (await this.estado.criarSeAusente(chave, true, BATERIA_INTERVALO_MS)) {
        await this.criarAlerta(device, TIPOS_ALERTA.bateriaFraca, 'Bateria fraca', e, frame, ocorrido);
      }
    }
  }

  private async registrarAcesso(device: GuaritaDoAgente, e: EventoGuarita, ocorrido: Date): Promise<number | null> {
    const tag = await this.prisma.tags.findFirst({
      where: { id_device: device.id, guarita_tipo: e.receptorTipo, guarita_serial: e.serialHex },
      select: { id: true },
    });
    const veiculo = tag
      ? await this.prisma.veiculos.findFirst({ where: { id_tag: tag.id, ativo: 1 }, select: { id_morador: true } })
      : null;
    const morador = veiculo
      ? await this.prisma.moradores.findUnique({ where: { id: veiculo.id_morador }, select: { id: true, nome: true } })
      : null;
    // Receptor no evento: nibble 0..7; no portão (e no console): CAN 1..8.
    const can = e.receptorNum + 1;
    const portoes = await this.prisma.guarita_Portoes.findMany({
      where: { id_device: device.id, tipo_receptor: e.receptorTipo, num_receptor: can },
      orderBy: { id: 'asc' },
    });
    const portao =
      portoes.find((p: any) => p.botao != null && p.botao === e.botao) ?? portoes.find((p: any) => p.botao == null) ?? null;

    let evento = 'entrada';
    if (e.tipo === 0 && e.flags1 === 0xaa) {
      evento = 'negado';
    } else if (e.tipo === 1 && (e.flags0 & 0x80) === 0) {
      // Passagem com sentido: bits 2..0 pares = entrada (E1A, E2A, E1B, E2B), ímpares = saída.
      evento = (e.flags0 & 0x01) === 1 ? 'saida' : 'entrada';
    } else if (portao?.sentido === 'saida') {
      evento = 'saida';
    }
    const sigla = SIGLA_TIPO[e.receptorTipo] ?? `R${e.receptorTipo}`;
    const nomeDispositivo = String(portao?.nome ?? `${device.nome} · ${sigla} ${can}`).slice(0, 100);
    const criado = await this.prisma.acessos_Facial.create({
      data: {
        id_condominio: device.id_condominio,
        id_device: device.id,
        tipo_dispositivo: 'guarita',
        nome_dispositivo: nomeDispositivo,
        face_id: `G${e.receptorTipo}-${e.serialHex}`,
        tipo_pessoa: morador ? 'morador' : 'desconhecido',
        id_pessoa: morador?.id ?? null,
        nome_pessoa: morador?.nome ?? `Não identificado · unidade ${e.unidade} bloco ${e.bloco}`,
        evento,
        confianca: null,
        timestamp: ocorrido,
      },
    });
    return criado?.id ?? null;
  }

  private async criarAlerta(
    device: GuaritaDoAgente,
    tipo: string,
    titulo: string,
    e: EventoGuarita,
    frame: string,
    ocorrido: Date | null,
  ) {
    const sigla = SIGLA_TIPO[e.receptorTipo];
    const quem = sigla ? ` (${sigla} ${e.serialHex}, unidade ${e.unidade} bloco ${e.bloco})` : '';
    await this.prisma.guarita_Alertas.create({
      data: {
        id_condominio: device.id_condominio,
        id_device: device.id,
        tipo,
        descricao: `${titulo} no ${device.nome}${quem}`.slice(0, 255),
        dados: JSON.stringify({
          frame_hex: frame,
          tipo_evento: e.tipo,
          serial: e.serialHex,
          receptor_tipo: e.receptorTipo,
          num_receptor: e.receptorNum + 1,
          unidade: e.unidade,
          bloco: e.bloco,
          ocorrido_em: ocorrido ? ocorrido.toISOString() : null,
        }),
      },
    });
  }

  // ------------------------------------------------------------- console

  /** `GET condominios/:id/guarita/alertas?pendentes=1`: alertas do condomínio (100 mais novos). */
  async listarAlertas(idCondominio: number, soPendentes: boolean) {
    const linhas = await this.prisma.guarita_Alertas.findMany({
      where: { id_condominio: Number(idCondominio), ...(soPendentes ? { visto_em: null } : {}) },
      orderBy: { id: 'desc' },
      take: 100,
    });
    return linhas.map((a: any) => {
      let dados: unknown = null;
      try {
        dados = a.dados ? JSON.parse(a.dados) : null;
      } catch {
        dados = null;
      }
      return {
        id: a.id,
        id_device: a.id_device,
        tipo: a.tipo,
        descricao: a.descricao,
        dados,
        created_at: a.created_at,
        visto_em: a.visto_em ?? null,
        visto_por: a.visto_por ?? null,
      };
    });
  }

  /** `POST …/alertas/:idAlerta/visto`. */
  async marcarVisto(idCondominio: number, idAlerta: number, quem: string) {
    const alerta = await this.prisma.guarita_Alertas.findFirst({
      where: { id: Number(idAlerta), id_condominio: Number(idCondominio) },
      select: { id: true },
    });
    if (!alerta) throw new NotFoundException('Alerta não encontrado.');
    await this.prisma.guarita_Alertas.updateMany({
      where: { id: alerta.id, visto_em: null },
      data: { visto_em: new Date(), visto_por: quem },
    });
    return { ok: true };
  }
}
