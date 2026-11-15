import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgentBridgeService } from '../facial/agent-bridge.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { autorDoToken } from '../auth/usuario-do-token.util';
import { AVISO_RELOGIO_S, ESTADO_OP, ESTADO_TAG, OPERACAO_CAPTURA, TIPOS_DISPOSITIVO_GUARITA } from './guarita.constantes';
import { GuaritaAgenteService } from './guarita-agente.service';
import { autorDoUsuario, buscarGuaritaDoCondominio } from './guarita-comum.util';

/** Corpo do portão vindo do console (POST e PUT, inteiro). */
export interface PortaoDto {
  nome: string;
  /** 1 RF, 2 TA, 3 CT, 6 TP. */
  tipo_receptor: number;
  /** Endereço CAN 1..8, como aparece no Guarita (o agente converte para 0..7 no frame). */
  num_receptor: number;
  /** Botão/leitora 1..4 (casa o evento com o portão) ou null = qualquer. */
  botao?: number | null;
  /** Relé 1..4 do botão de abrir, ou null = portão só para o histórico. */
  rele?: number | null;
  sentido?: 'entrada' | 'saida' | null;
}

function validarPortao(b: any) {
  const nome = typeof b?.nome === 'string' ? b.nome.trim() : '';
  if (!nome || nome.length > 100) throw new BadRequestException('Informe o nome do portão (até 100 caracteres).');
  const tipo = Number(b?.tipo_receptor);
  if (!(TIPOS_DISPOSITIVO_GUARITA as readonly number[]).includes(tipo)) {
    throw new BadRequestException('Receptor inválido: use RF (1), TA (2), CT (3) ou TP (6).');
  }
  const can = Number(b?.num_receptor);
  if (!Number.isInteger(can) || can < 1 || can > 8) throw new BadRequestException('Endereço do receptor inválido: use 1 a 8.');
  const entre1e4 = (v: unknown, campo: string): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 4) throw new BadRequestException(`${campo} inválido: use 1 a 4.`);
    return n;
  };
  const sentido = b?.sentido === null || b?.sentido === undefined || b?.sentido === '' ? null : b.sentido;
  if (sentido !== null && sentido !== 'entrada' && sentido !== 'saida') {
    throw new BadRequestException('Sentido inválido: use entrada, saida ou deixe em branco.');
  }
  return {
    nome,
    tipo_receptor: tipo,
    num_receptor: can,
    botao: entre1e4(b?.botao, 'Botão'),
    rele: entre1e4(b?.rele, 'Relé'),
    sentido,
  };
}

const CAMPOS_PORTAO = {
  id: true,
  id_device: true,
  nome: true,
  tipo_receptor: true,
  num_receptor: true,
  botao: true,
  rele: true,
  sentido: true,
  created_at: true,
  updated_at: true,
} as const;

/**
 * Portões do Guarita, abertura pelo relé e o estado do aparelho para o console.
 *
 * Abrir = UM comando `guarita_rele` na ponte (o agente escreve UM comando 13
 * com gera_evt; o Guarita não responde ao 13, então "enviado" é o que dá para
 * afirmar). Nunca o 92. Toda tentativa vira uma linha de auditoria.
 *
 * NÃO validado em aparelho.
 */
@Injectable()
export class GuaritaPortoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: AgentBridgeService,
    private readonly auditoria: AuditoriaService,
    private readonly agente: GuaritaAgenteService,
  ) {}

  async listar(idCondominio: number, deviceId: number) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    return this.prisma.guarita_Portoes.findMany({
      where: { id_device: device.id },
      orderBy: { id: 'asc' },
      select: CAMPOS_PORTAO,
    });
  }

  async criar(idCondominio: number, deviceId: number, corpo: unknown) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const dados = validarPortao(corpo);
    return this.prisma.guarita_Portoes.create({
      data: { ...dados, id_condominio: device.id_condominio, id_device: device.id },
      select: CAMPOS_PORTAO,
    });
  }

  async atualizar(idCondominio: number, deviceId: number, idPortao: number, corpo: unknown) {
    const portao = await this.portaoDoGuarita(idCondominio, deviceId, idPortao);
    const dados = validarPortao(corpo);
    return this.prisma.guarita_Portoes.update({ where: { id: portao.id }, data: dados, select: CAMPOS_PORTAO });
  }

  async remover(idCondominio: number, deviceId: number, idPortao: number) {
    const portao = await this.portaoDoGuarita(idCondominio, deviceId, idPortao);
    await this.prisma.guarita_Portoes.delete({ where: { id: portao.id } });
    return { ok: true };
  }

  private async portaoDoGuarita(idCondominio: number, deviceId: number, idPortao: number) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const portao = await this.prisma.guarita_Portoes.findFirst({ where: { id: Number(idPortao), id_device: device.id } });
    if (!portao) throw new NotFoundException('Portão não encontrado.');
    return { ...portao, device };
  }

  /** `POST …/portoes/:idPortao/abrir` → `{ enviado: true }` ou erro com a causa. */
  async abrir(idCondominio: number, deviceId: number, idPortao: number, user: JwtPayload) {
    const portao = await this.portaoDoGuarita(idCondominio, deviceId, idPortao);
    if (portao.rele == null) throw new BadRequestException('Este portão não tem relé cadastrado.');
    if (portao.device.ativo !== 1) throw new BadRequestException('Este Guarita está desativado.');

    let falha: string | null = null;
    if (!this.bridge.isOnline(portao.device.id)) {
      falha = 'O Agente Local deste condomínio não está conectado. O comando não foi enviado.';
    } else {
      const estado = await this.agente.lerEstado(portao.device.id);
      if (estado && estado.conectado === false) {
        falha = `O Guarita está desconectado do Agente Local${estado.erro ? ` (${estado.erro})` : ''}. O comando não foi enviado.`;
      }
    }
    if (!falha) {
      // Um clique = um comando. num_receptor vai em 1..8 (o agente subtrai 1 no frame).
      const r = await this.bridge.enqueue(portao.device.id, {
        type: 'guarita_rele',
        payload: { tipo_receptor: portao.tipo_receptor, num_receptor: portao.num_receptor, rele: portao.rele },
      });
      if (!r.ok) falha = r.error ?? 'O Agente Local não confirmou o envio do comando.';
    }
    const autor = autorDoToken(user);
    await this.auditoria.registrar({
      id_condominio: portao.device.id_condominio,
      usuario_nome: autorDoUsuario(user),
      autor_id: autor.autor_id,
      autor_tipo: autor.autor_tipo,
      acao: 'MANUAL_OVERRIDE',
      modulo: 'guarita',
      entidade_id: portao.id,
      descricao: falha
        ? `Tentou abrir "${portao.nome}" pelo Guarita "${portao.device.nome}" (não enviado)`
        : `Abriu "${portao.nome}" pelo Guarita "${portao.device.nome}" (comando enviado)`,
      detalhes: {
        id_device: portao.device.id,
        tipo_receptor: portao.tipo_receptor,
        num_receptor: portao.num_receptor,
        rele: portao.rele,
        enviado: !falha,
        ...(falha ? { erro: falha } : {}),
      },
    });
    if (falha) throw new ServiceUnavailableException(falha);
    return { enviado: true };
  }

  /** `GET …/estado`: estado reportado pelo agente + contagens da fila e das tags. */
  async estado(idCondominio: number, deviceId: number) {
    const device = await buscarGuaritaDoCondominio(this.prisma, idCondominio, deviceId);
    const e = await this.agente.lerEstado(device.id);
    const [pendentes, falhas, aVincular, aguardando, extra] = await Promise.all([
      this.prisma.guarita_Operacoes.count({
        where: {
          id_device: device.id,
          tipo: { not: OPERACAO_CAPTURA },
          estado: { in: [ESTADO_OP.pendente, ESTADO_OP.enviada, ESTADO_OP.processando] },
        },
      }),
      this.prisma.tags.count({ where: { id_device: device.id, guarita_estado: ESTADO_TAG.falhou } }),
      this.prisma.tags.count({ where: { id_device: device.id, guarita_estado: ESTADO_TAG.aVincular } }),
      this.prisma.tags.count({ where: { id_device: device.id, guarita_estado: ESTADO_TAG.aguardandoAprovacao } }),
      this.prisma.facial_Devices.findUnique({ where: { id: device.id }, select: { ultima_sincr: true } }),
    ]);
    // Último 29 que falhou (sem um ok depois): as tags ficam "gravado" e o motivo aparece aqui.
    const ultimo29 = await this.prisma.guarita_Operacoes.findFirst({
      where: { id_device: device.id, tipo: 'atualizar_receptores', estado: { in: [ESTADO_OP.ok, ESTADO_OP.falhou] } },
      orderBy: { id: 'desc' },
      select: { estado: true, erro: true },
    });
    const erro29 = ultimo29?.estado === ESTADO_OP.falhou ? `Receptores não atualizados: ${ultimo29.erro ?? 'falha no comando 29'}` : null;
    const delta = e?.relogio_delta_s ?? null;
    return {
      conectado: e ? e.conectado : null,
      autorizado: e ? e.autorizado : null,
      firmware: e?.firmware ?? null,
      total_dispositivos: e?.total_dispositivos ?? null,
      total_eventos: e?.total_eventos ?? null,
      relogio_delta_s: delta,
      aviso_relogio: delta !== null && Math.abs(delta) > AVISO_RELOGIO_S,
      ultima_comunicacao: e?.recebido_em ?? extra?.ultima_sincr ?? null,
      agente_online: this.bridge.isOnline(device.id),
      pendentes,
      falhas,
      a_vincular: aVincular,
      aguardando_aprovacao: aguardando,
      erro: e?.erro ?? erro29,
    };
  }
}
