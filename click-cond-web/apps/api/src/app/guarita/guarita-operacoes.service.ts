import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizarPlaca } from '../facial/placa.util';
import { EstadoCompartilhado } from '../common/estado-compartilhado';
import {
  ESTADO_OP,
  ESTADO_TAG,
  MSG_RF_SO_POR_CAPTURA,
  OPERACOES_DE_GRAVACAO,
  OPERACOES_DE_LEITURA,
  TIPO_DEVICE_GUARITA,
} from './guarita.constantes';
import {
  blocoParaByte,
  byteParaBloco,
  codificarApagar,
  codificarApagarDoFrame,
  codificarDispositivo,
  corParaByte,
  decodificarDispositivo,
  marcaParaByte,
} from './guarita-frame.util';
import { buscarGuaritaDoCondominio, unidadeGuaritaDoTexto } from './guarita-comum.util';
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
  /** O dispositivo lido no Guarita está em outra unidade/bloco: o agente NÃO escreveu. */
  conflito?: boolean;
  /** Unidade e byte do bloco que o agente leu no Guarita (com `conflito`). */
  lido?: { unidade?: number; bloco?: number; frame_hex?: string } | null;
  /** Cadastrar (0x02 na mesma unidade) ou apagar (0x03): já estava como pedido. */
  ja_estava?: boolean;
  /** A pergunta foi escrita e a resposta não chegou: o desfecho é desconhecido. */
  incerto?: boolean;
}

/** Texto do desfecho desconhecido (também marca a operação: é por ele que as tentativas são contadas). */
export const MSG_INCERTO = 'Não foi possível confirmar no Guarita.';
/** Marca do cadastro reenfileirado depois de um incerto: o frame é recalculado na entrega (R5). */
export const CRIADO_POR_RECADASTRO_INCERTO = 'Conferir cadastro sem confirmação';

/** Depois do segundo cadastro incerto (sem mais tentativa automática). */
export const MSG_INCERTO_CONFERIR = 'Não foi possível confirmar no Guarita. Use Conferir agora.';

/** Código de tag criado pelos fluxos do Guarita (importação, captura, digitado): G<tipo>-<serial>[-D<id>]. */
const CODIGO_DO_GUARITA = /^G[1236]-[0-9A-F]+(-D\d+)?$/;

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
/** Estados em que a tag nunca recebe `editar` (o veículo é salvo só no Prestare). */
const ESTADOS_SEM_EDICAO: string[] = [
  'removendo',
  'remocao_falhou',
  'conflito',
  'incerto',
  'ausente',
  'recusada',
  'aguardando_aprovacao',
  'a_vincular',
];

/** Remoção que falha volta à fila até isto (uma vez por conexão/conferência). */
export const MAX_TENTATIVAS_REMOCAO = 5;

@Injectable()
export class GuaritaOperacoesService {
  private readonly logger = new Logger(GuaritaOperacoesService.name);
  private readonly estado: EstadoCompartilhado;

  constructor(private readonly prisma: PrismaService) {
    this.estado = new EstadoCompartilhado(prisma);
  }

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
    let frame: string;
    try {
      frame = await this.montarFrame(tag, null);
    } catch (err: any) {
      // Não grava: a operação nem é criada, e a tag mostra o motivo.
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: { guarita_estado: ESTADO_TAG.falhou, guarita_erro: String(err?.message ?? err).slice(0, 255) },
      });
      throw err;
    }
    return this.criarGravacao(tag, 'cadastrar', frame, autor, ESTADO_TAG.pendente);
  }

  /**
   * Edição (67, opção 1) usando o frame do Guarita como base (grupo, receptores
   * e flags ficam). Cadastro desta tag ainda não entregue: só troca o frame
   * dele. Tag fora da lista branca (podeEscrever) → null, nada é enfileirado.
   * Frame que não monta: o motivo fica em `guarita_erro` e a exceção sobe.
   */
  async enfileirarEdicao(idTag: number, autor: string): Promise<{ id_operacao: number } | null> {
    const tag = await this.tagDoGuarita(idTag);
    // Tag saindo, em conflito, sem confirmação, fora do Guarita ou ainda não
    // aprovada: o dado do veículo é salvo no Prestare, nada vai ao Guarita (e
    // o estado de remoção nunca é trocado por uma edição — N1).
    if (ESTADOS_SEM_EDICAO.includes(tag.guarita_estado ?? '')) return null;
    const cadastroPendente = await this.prisma.guarita_Operacoes.findFirst({
      where: { id_tag: tag.id, tipo: 'cadastrar', estado: ESTADO_OP.pendente },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (cadastroPendente) {
      const frame = await this.montarFrameOuRegistrar(tag, null);
      const r = await this.prisma.guarita_Operacoes.updateMany({
        where: { id: cadastroPendente.id, estado: ESTADO_OP.pendente },
        data: { frame_hex: frame },
      });
      if (r.count === 1) return { id_operacao: cadastroPendente.id };
    }
    // Edição ainda não entregue: só troca o frame dela (nunca duas edições da
    // mesma tag na fila, cada uma com um `esperado`).
    const edicaoPendente = await this.prisma.guarita_Operacoes.findFirst({
      where: { id_tag: tag.id, tipo: 'editar', estado: ESTADO_OP.pendente },
      orderBy: { id: 'desc' },
      select: { id: true },
    });
    if (edicaoPendente) {
      const frame = await this.montarFrameOuRegistrar(tag, (await this.frameConhecido(tag)) ?? null);
      const r = await this.prisma.guarita_Operacoes.updateMany({
        where: { id: edicaoPendente.id, estado: ESTADO_OP.pendente },
        data: { frame_hex: frame },
      });
      if (r.count === 1) return { id_operacao: edicaoPendente.id };
    }
    // Cadastro entregue e ainda sem resultado: a edição entra atrás dele (a fila
    // só a entrega depois do resultado, e a cancela se o cadastro não der ok).
    // Idem com uma edição em voo: a nova sai depois, com o frame que a anterior confirmar.
    const gravacaoEmVoo = await this.prisma.guarita_Operacoes.count({
      where: { id_tag: tag.id, tipo: { in: ['cadastrar', 'editar'] }, estado: { in: [ESTADO_OP.enviada, ESTADO_OP.processando] } },
    });
    if (gravacaoEmVoo === 0 && !this.podeEditar(tag)) return null;
    const base = (await this.frameConhecido(tag)) ?? null;
    const frame = await this.montarFrameOuRegistrar(tag, base);
    return this.criarGravacao(tag, 'editar', frame, autor, ESTADO_TAG.pendente);
  }

  private async montarFrameOuRegistrar(tag: any, base: string | null): Promise<string> {
    try {
      return await this.montarFrame(tag, base);
    } catch (err: any) {
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: { guarita_erro: String(err?.message ?? err).slice(0, 255) },
      });
      throw err;
    }
  }

  /**
   * A ÚNICA regra que decide se uma tag pode gerar escrita (editar/apagar) no
   * Guarita. Lista branca: `gravado`, `ativo`, `removendo` (só nasce de uma
   * destas) e `pendente`/`falhou` quando o Prestare já teve a confirmação de
   * que o dispositivo é dele no Guarita — um `cadastrar` desta tag concluído
   * `ok`, ou um `editar` (que só existe para tag já confirmada). Qualquer outro
   * estado (`a_vincular`, `conflito`, `ausente`, `aguardando_aprovacao`,
   * `recusada`, nulo) nunca escreve.
   */
  async podeEscrever(tag: any): Promise<boolean> {
    return this.podeApagar(tag);
  }

  /**
   * Pode receber `editar`? Só `gravado` e `ativo` (o dispositivo está no
   * Guarita com os dados do Prestare). Tag em remoção, incerta, em conflito,
   * ausente, recusada ou aguardando NUNCA é editada (a edição a tiraria da
   * remoção — N1).
   */
  podeEditar(tag: any): boolean {
    if (!tag || tag.id_device == null || tag.guarita_tipo == null || !tag.guarita_serial) return false;
    return tag.guarita_estado === ESTADO_TAG.gravado || tag.guarita_estado === ESTADO_TAG.ativo;
  }

  /** Pode receber `apagar`? A lista branca (inclui `incerto`, `removendo`, `remocao_falhou`). */
  async podeApagar(tag: any): Promise<boolean> {
    if (!tag || tag.id_device == null || tag.guarita_tipo == null || !tag.guarita_serial) return false;
    const e = tag.guarita_estado;
    if (e === ESTADO_TAG.gravado || e === ESTADO_TAG.ativo || e === ESTADO_TAG.removendo || e === ESTADO_TAG.remocaoFalhou) return true;
    // Cadastro talvez gravado: pode receber apagar (o agente confere a unidade antes).
    if (e === ESTADO_TAG.incerto) return true;
    if (e !== ESTADO_TAG.pendente && e !== ESTADO_TAG.falhou) return false;
    const confirmacoes = await this.prisma.guarita_Operacoes.count({
      where: {
        id_tag: tag.id,
        OR: [{ tipo: 'cadastrar', estado: ESTADO_OP.ok }, { tipo: 'editar' }],
      },
    });
    return confirmacoes > 0;
  }

  /**
   * R5: o cadastro reenfileirado depois de um incerto sai com o frame ATUAL da
   * tag (dados de hoje do veículo/morador), não com o de quando foi pedido.
   * Não monta (unidade inválida, sem veículo...): fica o frame guardado.
   */
  async atualizarFrameDoRecadastro(op: { id: number; id_tag: number | null; frame_hex: string | null }): Promise<string | null> {
    if (op.id_tag == null) return op.frame_hex;
    const tag = await this.prisma.tags.findUnique({ where: { id: op.id_tag } });
    if (!tag) return op.frame_hex;
    try {
      const frame = await this.montarFrame(tag, null);
      if (frame !== op.frame_hex) {
        await this.prisma.guarita_Operacoes.updateMany({ where: { id: op.id, estado: ESTADO_OP.pendente }, data: { frame_hex: frame } });
      }
      return frame;
    } catch {
      return op.frame_hex;
    }
  }

  /** O frame que o Prestare acredita estar no Guarita: o lido/confirmado, ou o do último cadastro. */
  async frameConhecido(tag: any): Promise<string | null> {
    if (tag?.guarita_frame) return tag.guarita_frame;
    const cad = await this.prisma.guarita_Operacoes.findFirst({
      where: { id_tag: tag.id, tipo: 'cadastrar', frame_hex: { not: null } },
      orderBy: { id: 'desc' },
      select: { frame_hex: true },
    });
    return cad?.frame_hex ?? null;
  }

  /**
   * Desfaz a tag SÓ no Prestare (nada vai para o Guarita): cancela as
   * operações abertas dela; tag criada pelo Guarita (código G…) sai, tag
   * digitada no app só perde o vínculo com o Guarita.
   */
  async desfazerNoPrestare(tag: any): Promise<void> {
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id_tag: tag.id, estado: ESTADO_OP.pendente },
      data: { estado: ESTADO_OP.cancelada, concluida_em: new Date() },
    });
    if (CODIGO_DO_GUARITA.test(String(tag.codigo ?? ''))) {
      await this.prisma.$transaction([
        this.prisma.veiculos.updateMany({ where: { id_tag: tag.id }, data: { id_tag: null } }),
        this.prisma.tags.deleteMany({ where: { id: tag.id } }),
      ]);
      return;
    }
    await this.prisma.tags.update({
      where: { id: tag.id },
      data: {
        id_device: null,
        guarita_estado: null,
        guarita_erro: null,
        guarita_tipo: null,
        guarita_serial: null,
        guarita_contador: null,
        guarita_frame: null,
      },
    });
  }

  /** `POST …/atualizar-receptores`: um 29 pedido pelo console (no máximo um pendente por Guarita). */
  async solicitarAtualizarReceptores(idCondominio: number, deviceId: number, autor: string) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    if (device.ativo !== 1) throw new BadRequestException('Este Guarita está desativado.');
    let op = await this.prisma.guarita_Operacoes.findFirst({
      where: { id_device: device.id, tipo: 'atualizar_receptores', estado: ESTADO_OP.pendente },
      orderBy: { id: 'desc' },
    });
    if (!op) {
      op = await this.prisma.guarita_Operacoes.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          tipo: 'atualizar_receptores',
          estado: ESTADO_OP.pendente,
          criado_por: String(autor ?? 'Portaria').slice(0, 120),
        },
      });
    }
    return { id: op.id, tipo: op.tipo, estado: op.estado, erro: op.erro ?? null };
  }

  /**
   * `POST …/dispositivos/:idTag/regravar`: dispositivo `ausente` (sumiu do
   * Guarita) volta a ser cadastrado, por decisão do síndico. Com veículo, o
   * frame é montado dos dados atuais (grupo e receptores do frame antigo);
   * sem veículo, vai o frame antigo. RF exige o contador guardado.
   */
  async regravar(idCondominio: number, deviceId: number, idTag: number, autor: string) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(idTag), id_device: device.id, id_condominio: device.id_condominio },
    });
    if (!tag) throw new NotFoundException('Dispositivo não encontrado neste Guarita.');
    if (tag.guarita_estado !== ESTADO_TAG.ausente) {
      throw new BadRequestException('Só dá para regravar um dispositivo que não está mais no Guarita.');
    }
    if (tag.guarita_tipo === 1 && tag.guarita_contador == null) throw new BadRequestException(MSG_RF_SO_POR_CAPTURA);
    if (tag.guarita_tipo == null || !tag.guarita_serial) throw new BadRequestException('Dispositivo sem tipo ou serial.');
    const comVeiculo = await this.prisma.veiculos.count({ where: { id_tag: tag.id, ativo: 1 } });
    let frame: string | null = null;
    if (comVeiculo > 0) frame = await this.montarFrame(tag, tag.guarita_frame ?? null);
    else frame = tag.guarita_frame ?? null;
    if (!frame) throw new BadRequestException('Sem os dados do dispositivo para regravar. Cadastre de novo pela captura.');
    const { id_operacao } = await this.criarGravacao(tag, 'cadastrar', frame, autor, ESTADO_TAG.pendente);
    return { id_tag: tag.id, estado: ESTADO_TAG.pendente, id_operacao };
  }

  /**
   * `POST …/dispositivos/:idTag/desfazer`: tag em `conflito` (ou `ausente`)
   * sai do Prestare — a linha some, nenhuma operação vai para o Guarita.
   */
  async desfazer(idCondominio: number, deviceId: number, idTag: number) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(idTag), id_device: device.id, id_condominio: device.id_condominio },
    });
    if (!tag) throw new NotFoundException('Dispositivo não encontrado neste Guarita.');
    if (tag.guarita_estado !== ESTADO_TAG.conflito && tag.guarita_estado !== ESTADO_TAG.ausente) {
      throw new BadRequestException('Só dá para desfazer o vínculo de um dispositivo em conflito ou que não está mais no Guarita.');
    }
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id_tag: tag.id, estado: ESTADO_OP.pendente },
      data: { estado: ESTADO_OP.cancelada, concluida_em: new Date() },
    });
    await this.prisma.$transaction([
      this.prisma.veiculos.updateMany({ where: { id_tag: tag.id }, data: { id_tag: null } }),
      this.prisma.tags.deleteMany({ where: { id: tag.id } }),
    ]);
    return { id_tag: tag.id, desfeito: true };
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
    if (estado === ESTADO_TAG.aguardandoAprovacao || estado === ESTADO_TAG.recusada) {
      await this.desfazerNoPrestare(tag);
      return false;
    }
    // Em conflito quando o morador sai: não apaga (o dispositivo lá é de
    // outra unidade), mas a intenção de remover não some — alerta e texto na tag.
    if (estado === ESTADO_TAG.conflito) {
      await this.alertarRemocaoNaoConfirmada(tag);
      return false;
    }
    // Cadastro e edição desta tag ainda não entregues: cancela (o apagar usa o
    // frame confirmado atual).
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id_tag: tag.id, tipo: { in: ['cadastrar', 'editar'] }, estado: ESTADO_OP.pendente },
      data: { estado: ESTADO_OP.cancelada, concluida_em: new Date() },
    });
    // Cadastro já entregue e sem resultado: o apagar entra na fila e só sai
    // depois do resultado dele (a fila não entrega nada com lote em voo), e é
    // cancelado se o cadastro não der ok.
    const cadastroEmVoo = await this.prisma.guarita_Operacoes.count({
      where: { id_tag: tag.id, tipo: 'cadastrar', estado: { in: [ESTADO_OP.enviada, ESTADO_OP.processando] } },
    });
    if (cadastroEmVoo === 0 && !(await this.podeEscrever(tag))) {
      // a_vincular, conflito, ausente: o Prestare não gravou — NUNCA apaga do
      // Guarita (fica como está, o síndico decide). Pendente que nunca chegou
      // ao Guarita: só desfaz no Prestare.
      if (estado === ESTADO_TAG.pendente || estado === ESTADO_TAG.falhou) await this.desfazerNoPrestare(tag);
      return false;
    }
    if (tag.guarita_tipo == null || !tag.guarita_serial) return false;
    // Remoção já desistida automaticamente: a intenção continua (alerta aberto);
    // nova tentativa só pelo "remover de novo" do console.
    if (estado === ESTADO_TAG.remocaoFalhou) return true;
    if (estado === ESTADO_TAG.removendo) {
      const aberta = await this.prisma.guarita_Operacoes.count({
        where: { id_tag: tag.id, tipo: 'apagar', estado: { in: ABERTAS } },
      });
      if (aberta > 0) return true;
    }
    const conhecido = await this.frameConhecido(tag);
    const frame = conhecido ? codificarApagarDoFrame(conhecido) : codificarApagar(tag.guarita_tipo, tag.guarita_serial);
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
    // Estado de remoção nunca é trocado por outro: de `removendo`/`remocao_falhou`
    // só se sai por remoção confirmada ou por "desfazer".
    const removendo = [ESTADO_TAG.removendo, ESTADO_TAG.remocaoFalhou];
    await this.prisma.tags.updateMany({
      where:
        tipo === 'apagar'
          ? { id: tag.id }
          : { id: tag.id, OR: [{ guarita_estado: null }, { guarita_estado: { notIn: removendo } }] },
      data: { guarita_estado: estado, guarita_erro: null },
    });
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
    const u = unidadeGuaritaDoTexto(bloco, apto, await this.condominioSemBlocos(tag.id_condominio));
    if (!u.ok) throw new BadRequestException(u.erro);
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
          unidade: u.unidade,
          bloco: u.bloco,
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

  /** Nenhum apartamento do condomínio tem bloco preenchido? (Só então bloco vazio vira A.) */
  async condominioSemBlocos(idCondominio: number): Promise<boolean> {
    const aptos = await this.prisma.apartamentos.findMany({ where: { id_condominio: Number(idCondominio) }, select: { bloco: true } });
    return aptos.every((a: any) => !String(a.bloco ?? '').trim());
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
   * `POST …/dispositivos/:idTag/aprovar { tipo: 2|3|6, codigo_impresso }`: a tag
   * que o morador vinculou no app vai para este Guarita. Tipo e código impresso
   * são obrigatórios (sem padrão: gravar o tipo errado deixa um fantasma no
   * Guarita e o cartão real não abre). RF nunca: o contador só vem na captura.
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
    const tipo = Number(corpo?.tipo);
    if (tipo === 1) throw new BadRequestException(MSG_RF_SO_POR_CAPTURA);
    if (![2, 3, 6].includes(tipo)) {
      throw new BadRequestException('Informe o tipo do dispositivo: 2 (TAG ativo), 3 (cartão) ou 6 (TAG passivo).');
    }
    const serial = wiegandParaSerial(String(corpo?.codigo_impresso ?? ''));
    if (!serial) throw new BadRequestException(MSG_CODIGO_IMPRESSO_INVALIDO);
    // O mesmo serial em QUALQUER tipo neste Guarita: não grava por cima.
    const repetida = await this.prisma.tags.findFirst({
      where: { id_device: device.id, guarita_serial: serial, id: { not: tag.id }, guarita_tipo: { not: null } },
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
   * `POST …/dispositivos/:idTag/recusar`: a tag não vai para o Guarita e fica
   * `recusada` (persistente): o app reenviar o MESMO código não a põe de novo
   * na fila; um código diferente é outra tag e volta a aguardar aprovação. A
   * tag continua ligada ao veículo como tag comum (antena/leitor como hoje).
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
      data: {
        id_device: device.id,
        guarita_estado: ESTADO_TAG.recusada,
        guarita_erro: 'A portaria não aprovou esta tag para o Guarita.',
      },
    });
    return { id_tag: tag.id, estado: ESTADO_TAG.recusada };
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
  async aplicarResultado(idOperacao: number, resultado: ResultadoGravacao): Promise<void> {
    const op = await this.prisma.guarita_Operacoes.findUnique({ where: { id: Number(idOperacao) } });
    if (!op) return;
    let r = resultado;
    // R3: `editar` incerto ou em "conflito" cujo frame LIDO é o que foi enviado
    // (fora o byte 30, só de leitura): a edição valeu — ok, e guarda o lido.
    let frameLidoDaEdicao: string | null = null;
    if (op.tipo === 'editar' && (r.incerto === true || r.conflito === true) && r.lido?.frame_hex && op.frame_hex) {
      const semFlags = (h: string) => h.toUpperCase().slice(0, 58) + h.toUpperCase().slice(60);
      if (semFlags(r.lido.frame_hex) === semFlags(op.frame_hex)) {
        frameLidoDaEdicao = r.lido.frame_hex.toUpperCase();
        r = { ok: true, codigo: 0 };
      }
    }
    // Conflito: o agente leu o dispositivo em outra unidade e não escreveu; ou
    // o cadastro voltou 0x02 sem ser "já estava" (o serial é de outra pessoa).
    const conflito =
      r.conflito === true || (op.tipo === 'cadastrar' && !r.ok && r.codigo === 0x02 && r.ja_estava !== true);
    if (conflito) {
      await this.marcarConflito(op, r);
      return;
    }
    // Desfecho desconhecido: só quando o agente diz (`incerto`). "Não foi
    // gravado" que o agente conferiu (ok:false sem incerto) é falha (R4).
    const incerto = r.incerto === true;
    if (incerto && TIPOS_GRAVACAO.includes(op.tipo)) {
      await this.marcarIncerto(op);
      return;
    }
    // "Já estava" num cadastro só vale com o frame LIDO do Guarita e o mesmo
    // dispositivo (tipo + serial, + contador no RF) na MESMA unidade/bloco; o
    // frame confirmado passa a ser o lido. Sem o frame lido: incerto.
    let frameConfirmado: string | null = op.frame_hex ?? null;
    if (op.tipo === 'cadastrar' && r.ok && r.ja_estava === true) {
      const lido = r.lido?.frame_hex ?? null;
      const pedido = String(op.frame_hex ?? '').toUpperCase();
      if (!lido || pedido.length !== 78) {
        await this.marcarIncerto(op);
        return;
      }
      const ehRf = pedido.startsWith('1');
      const mesmoDispositivo = lido.slice(0, 8) === pedido.slice(0, 8) && (!ehRf || lido.slice(8, 12) === pedido.slice(8, 12));
      const mesmaUnidade = lido.slice(12, 18) === pedido.slice(12, 18);
      if (!mesmaUnidade) {
        await this.marcarConflito(op, {
          ...r,
          lido: { unidade: parseInt(lido.slice(12, 14), 16) * 100 + parseInt(lido.slice(14, 16), 16), bloco: parseInt(lido.slice(16, 18), 16) },
        });
        return;
      }
      if (!mesmoDispositivo) {
        await this.marcarIncerto(op);
        return;
      }
      frameConfirmado = lido;
    }
    if (frameLidoDaEdicao) frameConfirmado = frameLidoDaEdicao;
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
      // Só vira "ativo" a tag cuja última gravação ok veio ANTES deste 29 na fila
      // (id menor): um 29 atrasado não promove o que foi gravado depois dele.
      const gravadas = await this.prisma.tags.findMany({
        where: { id_device: op.id_device, guarita_estado: ESTADO_TAG.gravado },
        select: { id: true },
      });
      for (const t of gravadas) {
        const ultima = await this.prisma.guarita_Operacoes.findFirst({
          where: { id_tag: t.id, tipo: { in: ['cadastrar', 'editar'] }, estado: ESTADO_OP.ok },
          orderBy: { id: 'desc' },
          select: { id: true },
        });
        if (ultima && ultima.id < op.id) {
          await this.prisma.tags.updateMany({
            where: { id: t.id, guarita_estado: ESTADO_TAG.gravado },
            data: { guarita_estado: ESTADO_TAG.ativo },
          });
        }
      }
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
      // A remoção NÃO aconteceu: o dispositivo ainda abre o portão. A tag
      // continua `removendo` (a linha só some com a confirmação do agente), a
      // portaria recebe alerta e a remoção volta para a fila na próxima
      // conexão/conferência (até MAX_TENTATIVAS_REMOCAO, nunca em laço).
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: { guarita_erro: `Remoção: ${mensagem}`.slice(0, 255), guarita_estado: ESTADO_TAG.removendo },
      });
      await this.alertarRemocaoPendente(tag, String(mensagem));
      await this.desistirSeEsgotou(tag, String(mensagem));
      return;
    }

    if (ok) {
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: {
          guarita_frame: frameConfirmado,
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
    // Cadastro que não deu ok: o dispositivo não está no Guarita por nós. As
    // gravações seguintes desta tag ainda na fila (editar/apagar) não têm o que
    // escrever: são canceladas; se ela estava saindo, sai só do Prestare.
    if (op.tipo === 'cadastrar') {
      await this.prisma.guarita_Operacoes.updateMany({
        where: { id_tag: tag.id, estado: ESTADO_OP.pendente, id: { gt: op.id }, tipo: { in: ['editar', 'apagar'] } },
        data: { estado: ESTADO_OP.cancelada, concluida_em: agora },
      });
      if (tag.guarita_estado === ESTADO_TAG.removendo && !(await this.podeEscrever({ ...tag, guarita_estado: ESTADO_TAG.pendente }))) {
        await this.desfazerNoPrestare(tag);
      }
    }
  }

  /**
   * Gravação escrita sem resposta. Nada é dado como feito nem como não feito:
   *  - cadastrar → tag `incerto` e o PRÓPRIO cadastro volta uma vez à fila (o
   *    agente responde `ja_estava` se ele já estiver lá); morador que sai com a
   *    tag `incerto` recebe `apagar` com a unidade pedida;
   *  - apagar → continua `removendo`, alerta, e volta à fila (conta nas tentativas);
   *  - editar → volta à fila (conta nas tentativas).
   */
  private async marcarIncerto(op: any) {
    const agora = new Date();
    const reivindicou = await this.prisma.guarita_Operacoes.updateMany({
      where: { id: op.id, estado: { in: ABERTAS } },
      data: { estado: ESTADO_OP.falhou, codigo: null, erro: MSG_INCERTO, concluida_em: agora },
    });
    if (reivindicou.count !== 1 || op.id_tag == null) return;
    const tag = await this.prisma.tags.findUnique({ where: { id: op.id_tag } });
    if (!tag) return;
    const tentativas = await this.prisma.guarita_Operacoes.count({
      where: { id_tag: tag.id, tipo: op.tipo, estado: ESTADO_OP.falhou, ...(op.tipo === 'apagar' ? {} : { erro: MSG_INCERTO }) },
    });
    if (op.tipo === 'cadastrar') {
      const saindo = tag.guarita_estado === ESTADO_TAG.removendo;
      // Segundo incerto do mesmo cadastro: não há nova tentativa sozinha; a tela diz o que fazer.
      const texto = tentativas >= 2 ? MSG_INCERTO_CONFERIR : MSG_INCERTO;
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: { guarita_erro: texto, ...(!saindo && { guarita_estado: ESTADO_TAG.incerto }) },
      });
      if (!saindo && tentativas === 1 && op.frame_hex) {
        await this.prisma.guarita_Operacoes.create({
          data: {
            id_condominio: tag.id_condominio,
            id_device: op.id_device,
            id_tag: tag.id,
            tipo: 'cadastrar',
            frame_hex: op.frame_hex,
            estado: ESTADO_OP.pendente,
            criado_por: CRIADO_POR_RECADASTRO_INCERTO,
          },
        });
        await this.garantirAtualizarReceptores(tag.id_condominio, op.id_device);
      }
      return;
    }
    if (op.tipo === 'apagar') {
      await this.prisma.tags.update({
        where: { id: tag.id },
        data: { guarita_erro: `Remoção: ${MSG_INCERTO}`, guarita_estado: ESTADO_TAG.removendo },
      });
      await this.alertarRemocaoPendente(tag, MSG_INCERTO);
      if (tentativas < MAX_TENTATIVAS_REMOCAO && op.frame_hex) {
        await this.criarGravacao(tag, 'apagar', op.frame_hex, `Nova tentativa de remoção (${tentativas + 1}/${MAX_TENTATIVAS_REMOCAO})`, ESTADO_TAG.removendo);
      } else {
        await this.desistirSeEsgotou(tag, MSG_INCERTO);
      }
      return;
    }
    await this.prisma.tags.update({ where: { id: tag.id }, data: { guarita_erro: MSG_INCERTO } });
    if (tentativas < MAX_TENTATIVAS_REMOCAO && op.frame_hex) {
      await this.criarGravacao(tag, 'editar', op.frame_hex, 'Nova tentativa de edição sem confirmação', tag.guarita_estado ?? ESTADO_TAG.pendente);
    }
  }

  /**
   * Depois de MAX_TENTATIVAS_REMOCAO apagar falhos, a tag vira
   * `remocao_falhou` (visível, sem nova tentativa automática) e um alerta
   * `remocao_pendente` novo é aberto, mesmo que o anterior já tenha sido visto.
   */
  private async desistirSeEsgotou(tag: any, motivo: string) {
    const falhas = await this.prisma.guarita_Operacoes.count({
      where: { id_tag: tag.id, tipo: 'apagar', estado: ESTADO_OP.falhou },
    });
    if (falhas < MAX_TENTATIVAS_REMOCAO) return;
    const aberta = await this.prisma.guarita_Operacoes.count({
      where: { id_tag: tag.id, tipo: 'apagar', estado: { in: ABERTAS } },
    });
    if (aberta > 0) return;
    const texto = `Remoção não confirmada depois de ${falhas} tentativas: ${motivo}`.slice(0, 255);
    await this.prisma.tags.update({ where: { id: tag.id }, data: { guarita_estado: ESTADO_TAG.remocaoFalhou, guarita_erro: texto } });
    await this.prisma.guarita_Alertas.create({
      data: {
        id_condominio: tag.id_condominio,
        id_device: tag.id_device,
        tipo: 'remocao_pendente',
        descricao: `Não foi possível remover do Guarita o dispositivo de ${await this.quemDaTag(tag)}: ele ainda abre o portão. As tentativas automáticas acabaram; use "Remover de novo".`.slice(0, 255),
        dados: JSON.stringify({ id_tag: tag.id, serial: tag.guarita_serial, tipo: tag.guarita_tipo, motivo, tentativas: falhas }),
      },
    });
  }

  /**
   * `POST …/dispositivos/:idTag/remover-de-novo`: nova tentativa manual de
   * remover uma tag `remocao_falhou` (uma por clique).
   */
  async removerDeNovo(idCondominio: number, deviceId: number, idTag: number, autor: string) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const tag = await this.prisma.tags.findFirst({
      where: { id: Number(idTag), id_device: device.id, id_condominio: device.id_condominio },
    });
    if (!tag) throw new NotFoundException('Dispositivo não encontrado neste Guarita.');
    if (tag.guarita_estado !== ESTADO_TAG.remocaoFalhou) {
      throw new BadRequestException('Só dá para remover de novo um dispositivo cuja remoção falhou.');
    }
    const conhecido = await this.frameConhecido(tag);
    if (!conhecido && (tag.guarita_tipo == null || !tag.guarita_serial)) {
      throw new BadRequestException('Sem os dados do dispositivo para remover. Faça a conferência.');
    }
    const frame = conhecido ? codificarApagarDoFrame(conhecido) : codificarApagar(tag.guarita_tipo as number, tag.guarita_serial as string);
    const { id_operacao } = await this.criarGravacao(tag, 'apagar', frame, autor, ESTADO_TAG.removendo);
    return { id_tag: tag.id, estado: ESTADO_TAG.removendo, id_operacao };
  }

  /** Alerta "ainda abre o portão" para a portaria (no máximo um a cada 12 h por tag). */
  private async alertarRemocaoPendente(tag: any, motivo: string) {
    if (!(await this.estado.criarSeAusente(`guarita:alerta-remocao:${tag.id}`, true, 12 * 60 * 60 * 1000))) return;
    let quem = `serial ${tag.guarita_serial ?? '?'}`;
    try {
      const d = tag.guarita_frame ? decodificarDispositivo(tag.guarita_frame) : null;
      if (d) quem = `${d.rotulo ? `${d.rotulo}, ` : ''}unidade ${d.unidade} bloco ${d.bloco}`;
    } catch {
      /* mantém o serial */
    }
    await this.prisma.guarita_Alertas.create({
      data: {
        id_condominio: tag.id_condominio,
        id_device: tag.id_device,
        tipo: 'remocao_pendente',
        descricao: `Não foi possível remover do Guarita o dispositivo de ${quem}: ele ainda abre o portão.`.slice(0, 255),
        dados: JSON.stringify({ id_tag: tag.id, serial: tag.guarita_serial, tipo: tag.guarita_tipo, motivo }),
      },
    });
  }

  /**
   * Remoções que falharam voltam para a fila — chamado a cada (re)conexão do
   * agente com o Guarita e depois de cada conferência, nunca em laço. Até
   * MAX_TENTATIVAS_REMOCAO apagar por tag; depois disso só o alerta fica.
   */
  async reenfileirarRemocoes(idDevice: number): Promise<number> {
    const tags = await this.prisma.tags.findMany({
      where: { id_device: idDevice, guarita_estado: ESTADO_TAG.removendo },
    });
    let n = 0;
    for (const tag of tags) {
      const aberta = await this.prisma.guarita_Operacoes.count({
        where: { id_tag: tag.id, tipo: 'apagar', estado: { in: [...ABERTAS, ESTADO_OP.processando] } },
      });
      if (aberta > 0) continue;
      const falhas = await this.prisma.guarita_Operacoes.count({
        where: { id_tag: tag.id, tipo: 'apagar', estado: ESTADO_OP.falhou },
      });
      if (falhas === 0 || falhas >= MAX_TENTATIVAS_REMOCAO) continue;
      if (!(await this.podeEscrever(tag))) continue;
      const conhecido = await this.frameConhecido(tag);
      if (!conhecido && (tag.guarita_tipo == null || !tag.guarita_serial)) continue;
      const frame = conhecido ? codificarApagarDoFrame(conhecido) : codificarApagar(tag.guarita_tipo as number, tag.guarita_serial as string);
      await this.criarGravacao(tag, 'apagar', frame, `Nova tentativa de remoção (${falhas + 1}/${MAX_TENTATIVAS_REMOCAO})`, ESTADO_TAG.removendo);
      n++;
    }
    return n;
  }

  /**
   * O serial está no Guarita em OUTRA unidade/bloco: a tag vira `conflito` (nunca
   * recebe apagar nem editar) e as operações dela ainda na fila são canceladas.
   * Só sai daí pelo "desfazer vínculo" do síndico.
   */
  private async marcarConflito(op: any, r: ResultadoGravacao) {
    const agora = new Date();
    const lido =
      r.lido && Number.isInteger(r.lido.unidade) && Number.isInteger(r.lido.bloco)
        ? ` (lá está na unidade ${r.lido.unidade} bloco ${byteParaBloco(r.lido.bloco as number)})`
        : '';
    const mensagem = `Este dispositivo já está no Guarita em outra unidade${lido}. Nada foi gravado.`;
    const reivindicou = await this.prisma.guarita_Operacoes.updateMany({
      where: { id: op.id, estado: { in: ABERTAS } },
      data: { estado: ESTADO_OP.falhou, codigo: r.codigo ?? null, erro: mensagem.slice(0, 255), concluida_em: agora },
    });
    if (reivindicou.count !== 1 || op.id_tag == null) return;
    await this.marcarTagEmConflito(op.id_tag, mensagem);
    // Conflito numa REMOÇÃO: a intenção era tirar alguém — não pode sumir em silêncio.
    if (op.tipo === 'apagar') {
      const tag = await this.prisma.tags.findUnique({ where: { id: op.id_tag } });
      if (tag) await this.alertarRemocaoNaoConfirmada(tag);
    }
  }

  /** Quem é o dono do dispositivo, para os textos: o morador do veículo, ou o rótulo/unidade do frame. */
  private async quemDaTag(tag: any): Promise<string> {
    const v = await this.prisma.veiculos.findFirst({ where: { id_tag: tag.id }, select: { id_morador: true } });
    const m = v ? await this.prisma.moradores.findUnique({ where: { id: v.id_morador }, select: { nome: true, bloco: true, apartamento: true } }) : null;
    if (m) return `${m.nome}${m.apartamento ? ` (unidade ${m.apartamento}${m.bloco ? ` bloco ${m.bloco}` : ''})` : ''}`;
    try {
      const frame = await this.frameConhecido(tag);
      const d = frame ? decodificarDispositivo(frame) : null;
      if (d) return `${d.rotulo ? `${d.rotulo}, ` : ''}unidade ${d.unidade} bloco ${d.bloco}`;
    } catch {
      /* cai no serial */
    }
    return `serial ${tag.guarita_serial ?? '?'}`;
  }

  /**
   * A remoção não pôde ser confirmada porque o Guarita mostra o dispositivo em
   * outra unidade: tag `conflito` com o texto e alerta `remocao_pendente` (no
   * máximo um a cada 12 h por tag).
   */
  async alertarRemocaoNaoConfirmada(tag: any) {
    const texto = `Não foi possível confirmar a remoção do dispositivo de ${await this.quemDaTag(tag)} no Guarita. Confira no aparelho.`.slice(0, 255);
    await this.prisma.tags.updateMany({
      where: { id: tag.id },
      data: { guarita_estado: ESTADO_TAG.conflito, guarita_erro: texto },
    });
    if (!(await this.estado.criarSeAusente(`guarita:alerta-remocao-conflito:${tag.id}`, true, 12 * 60 * 60 * 1000))) return;
    await this.prisma.guarita_Alertas.create({
      data: {
        id_condominio: tag.id_condominio,
        id_device: tag.id_device,
        tipo: 'remocao_pendente',
        descricao: texto,
        dados: JSON.stringify({ id_tag: tag.id, serial: tag.guarita_serial, tipo: tag.guarita_tipo, motivo: 'conflito' }),
      },
    });
  }

  /** Tag → `conflito` e operações pendentes dela canceladas (usado também pela importação/conferência). */
  async marcarTagEmConflito(idTag: number, mensagem: string) {
    await this.prisma.guarita_Operacoes.updateMany({
      where: { id_tag: idTag, estado: ESTADO_OP.pendente },
      data: { estado: ESTADO_OP.cancelada, concluida_em: new Date() },
    });
    await this.prisma.tags.updateMany({
      where: { id: idTag },
      data: { guarita_estado: ESTADO_TAG.conflito, guarita_erro: mensagem.slice(0, 255) },
    });
  }

  /**
   * (unidade, byte do bloco) que o Prestare espera para esta tag no Guarita: a
   * do frame conhecido (lido/confirmado ou do último cadastro) ou, sem frame, a
   * do morador dono do veículo. null = não há como saber.
   */
  async unidadeEsperada(tag: any): Promise<{ unidade: number; bloco: number } | null> {
    const frame = await this.frameConhecido(tag);
    if (frame) {
      try {
        const d = decodificarDispositivo(frame);
        return { unidade: d.unidade, bloco: blocoParaByte(d.bloco) };
      } catch {
        /* cai para o morador */
      }
    }
    const veiculo = await this.prisma.veiculos.findFirst({ where: { id_tag: tag.id, ativo: 1 }, select: { id_morador: true } });
    if (!veiculo) return null;
    const m = await this.prisma.moradores.findUnique({ where: { id: veiculo.id_morador }, select: { bloco: true, apartamento: true } });
    if (!m) return null;
    const u = unidadeGuaritaDoTexto(m.bloco, m.apartamento, await this.condominioSemBlocos(tag.id_condominio));
    return u.ok ? { unidade: u.unidade, bloco: u.bloco } : null;
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
