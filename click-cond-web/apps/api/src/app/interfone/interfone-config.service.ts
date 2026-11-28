import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { AuditoriaAutorTipo } from '../auditoria/auditoria.service';
import { normalizarBloco } from '../common/rotulo-bloco.util';
import { rotuloAptoBloco } from '../visitantes/rotulo-apto-bloco.util';
import { facialAtendeBloco, ramalValido, sugerirRamais } from './regras';
import { TOQUE_APTO_S, TOQUE_PORTARIA_S } from './interfone.service';
import { VOZ_HOST } from './token-voz';

/** Porta SIP do facial e do monitor (UDP/TCP). */
export const VOZ_SIP_PORTA = 5060;
const ALFABETO_SENHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Cabeçalho do phoneBook do Intelbras (separador `;`). */
export const CABECALHO_LISTA_INTELBRAS =
  'Ramal;1° núm. chamado;Conta SIP;Tempo de ring;2° núm. chamado;Grupo agenda;Nome do bloco;Núm. andar';
/** Folga do "Tempo de ring" do facial sobre o toque da unidade + portaria (o facial não pode desligar antes da transferência). */
const FOLGA_RING_S = 10;

/** Quem fez a alteração (para a auditoria). */
export interface AtorConfig {
  nome: string;
  autor_id: number | null;
  autor_tipo: AuditoriaAutorTipo | null;
}

export interface ConfigInterfone {
  contratado: boolean;
  ativo: boolean;
  toque_apto_s: number;
  transferir: boolean;
  toque_portaria_s: number;
}

/** Senha SIP: 24 caracteres [A-Za-z0-9] de crypto.randomBytes (sem viés: rejeita bytes ≥ 248). */
export function gerarSenhaSip(tamanho = 24): string {
  let s = '';
  while (s.length < tamanho) {
    for (const b of randomBytes(tamanho * 2)) {
      if (b < 248 && s.length < tamanho) s += ALFABETO_SENHA[b % ALFABETO_SENHA.length];
    }
  }
  return s;
}

/** Célula do CSV com `;`: aspas quando precisa. */
function celula(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Andar = dígitos do apto sem os dois últimos ("106" → "1", "1203" → "12"); vazio com menos de 3 dígitos. */
export function andarDoApto(apto: string | null | undefined): string {
  const d = (apto ?? '').replace(/\D/g, '');
  return d.length < 3 ? '' : d.slice(0, -2).replace(/^0+(?=\d)/, '');
}

function lerBlocos(json: string | null | undefined): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) && v.length ? v.filter((b) => typeof b === 'string') : null;
  } catch {
    return null;
  }
}

/**
 * Configuração do interfone pelo síndico (console) e pelo CRM. O síndico só
 * mexe com o módulo contratado (o CRM liga); o GET da config responde mesmo
 * sem contrato, para o console decidir se mostra a aba.
 */
@Injectable()
export class InterfoneConfigService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  // ─────────────────────────────────────────── módulo

  async config(idCondominio: number): Promise<ConfigInterfone> {
    const c = await this.condominio(idCondominio);
    return this.paraConfig(c);
  }

  async salvarConfig(
    idCondominio: number,
    body: Partial<Omit<ConfigInterfone, 'contratado'>>,
    ator: AtorConfig,
  ): Promise<ConfigInterfone> {
    await this.assertContratado(idCondominio);
    const data: Record<string, number> = {};
    const bool = (k: 'ativo' | 'transferir', col: string) => {
      const v = (body as any)?.[k];
      if (v === undefined) return;
      if (typeof v !== 'boolean') throw new BadRequestException(`${k} deve ser true ou false.`);
      data[col] = v ? 1 : 0;
    };
    const faixa = (k: 'toque_apto_s' | 'toque_portaria_s', col: string, [min, max]: readonly number[]) => {
      const v = (body as any)?.[k];
      if (v === undefined) return;
      if (!Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${k} deve ser um inteiro de ${min} a ${max}.`);
      data[col] = v;
    };
    bool('ativo', 'interfone_ativo');
    bool('transferir', 'interfone_transferir');
    faixa('toque_apto_s', 'interfone_toque_apto_s', TOQUE_APTO_S);
    faixa('toque_portaria_s', 'interfone_toque_portaria_s', TOQUE_PORTARIA_S);
    if (Object.keys(data).length) {
      await this.prisma.condominios.update({ where: { id: idCondominio }, data });
      await this.auditar(idCondominio, ator, 'Configuração do interfone alterada', { alteracoes: data });
    }
    return this.config(idCondominio);
  }

  // ─────────────────────────────────────────── ramais

  async ramais(idCondominio: number) {
    await this.assertContratado(idCondominio);
    const aptos = await this.aptos(idCondominio);
    const s = sugerirRamais(aptos.map((a) => ({ id: a.id, apto: a.apto, bloco: a.bloco, ramal: a.interfone_ramal })));
    return aptos.map((a) => ({
      id_apartamento: a.id,
      unidade: rotuloAptoBloco(a.apto, a.bloco),
      ramal: a.interfone_ramal ?? null,
      sugestao: s.get(a.id)?.sugestao ?? null,
      conflito: s.get(a.id)?.conflito ?? false,
    }));
  }

  /**
   * Grava os ramais. Valida o estado final inteiro (os enviados + os que já
   * estão gravados nas outras unidades): ramal inválido, unidade de outro
   * condomínio ou número repetido → 400 com a lista, nada gravado.
   */
  async salvarRamais(idCondominio: number, itens: { id_apartamento: number; ramal: string | null }[], ator: AtorConfig) {
    await this.assertContratado(idCondominio);
    if (!Array.isArray(itens) || itens.length > 5000) throw new BadRequestException('Envie a lista de ramais.');
    const aptos = await this.aptos(idCondominio);
    const porId = new Map(aptos.map((a) => [a.id, a]));
    const erros: { id_apartamento: number; ramal: string | null; motivo: string }[] = [];
    const novos = new Map<number, string | null>();
    for (const it of itens) {
      const id = Number(it?.id_apartamento);
      const ramal = it?.ramal === null || it?.ramal === undefined || String(it.ramal).trim() === '' ? null : String(it.ramal).trim();
      if (!porId.has(id)) erros.push({ id_apartamento: id, ramal, motivo: 'unidade_invalida' });
      else if (ramal !== null && !ramalValido(ramal)) erros.push({ id_apartamento: id, ramal, motivo: 'ramal_invalido' });
      else novos.set(id, ramal);
    }
    // Estado final: o que foi enviado por cima do que está gravado.
    const final = new Map<number, string | null>(aptos.map((a) => [a.id, a.interfone_ramal ?? null]));
    for (const [id, r] of novos) final.set(id, r);
    const usados = new Map<string, number[]>();
    for (const [id, r] of final) if (r) usados.set(r, [...(usados.get(r) ?? []), id]);
    for (const [id, r] of novos) {
      if (r && (usados.get(r)?.length ?? 0) > 1) erros.push({ id_apartamento: id, ramal: r, motivo: 'ramal_repetido' });
    }
    if (erros.length) throw new BadRequestException({ statusCode: 400, message: 'Ramais inválidos.', erros });

    const mudam = [...novos].filter(([id, r]) => (porId.get(id)?.interfone_ramal ?? null) !== r);
    if (mudam.length) {
      // Primeiro limpa, depois grava: a chave única (un_apto_ramal) não
      // impede trocar dois ramais entre si.
      await this.prisma.$transaction([
        this.prisma.apartamentos.updateMany({ where: { id: { in: mudam.map(([id]) => id) }, id_condominio: idCondominio }, data: { interfone_ramal: null } }),
        ...mudam
          .filter(([, r]) => r !== null)
          .map(([id, r]) => this.prisma.apartamentos.update({ where: { id }, data: { interfone_ramal: r } })),
      ]);
      await this.auditar(idCondominio, ator, `Ramais do interfone alterados (${mudam.length})`, {
        ramais: mudam.map(([id, r]) => ({ id_apartamento: id, ramal: r })),
      });
    }
    return this.ramais(idCondominio);
  }

  // ─────────────────────────────────────────── faciais

  async faciais(idCondominio: number) {
    await this.assertContratado(idCondominio);
    const lista = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, tipo: 'facial' },
      orderBy: { id: 'asc' },
    });
    return lista.map((f) => this.paraFacial(f));
  }

  async salvarFacial(
    idCondominio: number,
    idFacial: number,
    body: { habilitado?: boolean; blocos?: string[] | null; dtmf?: string | null },
    ator: AtorConfig,
  ) {
    await this.assertContratado(idCondominio);
    const f = await this.facialDoCondominio(idCondominio, idFacial);
    const data: Record<string, unknown> = {};

    if (body?.habilitado !== undefined) {
      if (typeof body.habilitado !== 'boolean') throw new BadRequestException('habilitado deve ser true ou false.');
      data['interfone_habilitado'] = body.habilitado ? 1 : 0;
      if (body.habilitado && !f.interfone_senha) data['interfone_senha'] = gerarSenhaSip();
    }
    if (body?.blocos !== undefined) {
      if (body.blocos === null || (Array.isArray(body.blocos) && body.blocos.length === 0)) {
        data['interfone_blocos'] = null;
      } else if (!Array.isArray(body.blocos) || body.blocos.some((b) => typeof b !== 'string' || !b.trim())) {
        throw new BadRequestException('blocos deve ser uma lista de nomes de bloco ou null (todos).');
      } else {
        const existentes = new Set((await this.aptos(idCondominio)).map((a) => normalizarBloco(a.bloco)).filter(Boolean));
        const faltam = body.blocos.filter((b) => !existentes.has(normalizarBloco(b)));
        if (faltam.length) throw new BadRequestException({ statusCode: 400, message: 'Bloco inexistente no condomínio.', blocos: faltam });
        data['interfone_blocos'] = JSON.stringify([...new Set(body.blocos.map((b) => b.trim()))]);
      }
    }
    if (body?.dtmf !== undefined) {
      const d = body.dtmf === null ? '' : String(body.dtmf).trim();
      if (d && !/^[0-9*#]{1,10}$/.test(d)) throw new BadRequestException('dtmf: só dígitos, * e #, até 10.');
      data['interfone_dtmf'] = d || null;
    }

    if (Object.keys(data).length) {
      await this.prisma.facial_Devices.update({ where: { id: f.id }, data });
      const { interfone_senha: _senha, ...semSenha } = data;
      await this.auditar(idCondominio, ator, `Interfone do facial "${f.nome}" alterado`, {
        id_facial: f.id,
        alteracoes: semSenha,
        senha_gerada: _senha !== undefined,
      });
    }
    return this.paraFacial(await this.facialDoCondominio(idCondominio, idFacial));
  }

  async novaSenha(idCondominio: number, idFacial: number, ator: AtorConfig): Promise<{ senha: string }> {
    await this.assertContratado(idCondominio);
    const f = await this.facialDoCondominio(idCondominio, idFacial);
    const senha = gerarSenhaSip();
    await this.prisma.facial_Devices.update({ where: { id: f.id }, data: { interfone_senha: senha } });
    await this.auditar(idCondominio, ator, `Nova senha SIP do facial "${f.nome}"`, { id_facial: f.id });
    return { senha };
  }

  /**
   * phoneBook do Intelbras: uma linha por unidade com ramal dos blocos que o
   * facial chama. "Tempo de ring" cobre o toque da unidade + o da portaria +
   * folga, para o facial não desligar antes da transferência.
   */
  async listaTelefonica(idCondominio: number, idFacial: number): Promise<string> {
    await this.assertContratado(idCondominio);
    const f = await this.facialDoCondominio(idCondominio, idFacial);
    const c = await this.condominio(idCondominio);
    const ring = (c.interfone_toque_apto_s ?? 30) + (c.interfone_toque_portaria_s ?? 45) + FOLGA_RING_S;
    const aptos = (await this.aptos(idCondominio)).filter(
      (a) => a.interfone_ramal && facialAtendeBloco(f.interfone_blocos ?? null, a.bloco),
    );
    const linhas = [CABECALHO_LISTA_INTELBRAS];
    for (const a of aptos) {
      linhas.push(
        [rotuloAptoBloco(a.apto, a.bloco), a.interfone_ramal, 1, ring, '', '', a.bloco ?? '', andarDoApto(a.apto)].map(celula).join(';'),
      );
    }
    return linhas.join('\r\n') + '\r\n';
  }

  // ─────────────────────────────────────────── monitores

  async monitores(idCondominio: number) {
    await this.assertContratado(idCondominio);
    const lista = await this.prisma.interfone_Monitores.findMany({
      where: { id_condominio: idCondominio },
      include: { apartamento: { select: { apto: true, bloco: true } } },
      orderBy: { id: 'asc' },
    });
    return lista.map((m) => this.paraMonitor(m));
  }

  async criarMonitor(idCondominio: number, body: { id_apartamento?: number; nome?: string }, ator: AtorConfig) {
    await this.assertContratado(idCondominio);
    const nome = String(body?.nome ?? '').trim();
    if (!nome || nome.length > 80) throw new BadRequestException('nome é obrigatório (até 80 caracteres).');
    const apto = await this.prisma.apartamentos.findFirst({
      where: { id: Number(body?.id_apartamento), id_condominio: idCondominio },
      select: { id: true },
    });
    if (!apto) throw new BadRequestException('Unidade inválida.');
    const m = await this.prisma.interfone_Monitores.create({
      data: { id_condominio: idCondominio, id_apartamento: apto.id, nome, senha: gerarSenhaSip(), ativo: 1 },
      include: { apartamento: { select: { apto: true, bloco: true } } },
    });
    await this.auditar(idCondominio, ator, `Monitor IP "${nome}" cadastrado`, { id_monitor: m.id, id_apartamento: apto.id });
    return this.paraMonitor(m);
  }

  async removerMonitor(idCondominio: number, id: number, ator: AtorConfig): Promise<{ ok: true }> {
    await this.assertContratado(idCondominio);
    const m = await this.prisma.interfone_Monitores.findFirst({ where: { id, id_condominio: idCondominio } });
    if (!m) throw new NotFoundException('Monitor não encontrado.');
    await this.prisma.interfone_Monitores.delete({ where: { id: m.id } });
    await this.auditar(idCondominio, ator, `Monitor IP "${m.nome}" removido`, { id_monitor: m.id });
    return { ok: true };
  }

  // ─────────────────────────────────────────── CRM

  async clientesCrm(): Promise<{ id: number; nome: string; contratado: boolean }[]> {
    const l = await this.prisma.condominios.findMany({
      select: { id: true, nome: true, interfone_contratado: true },
      orderBy: { nome: 'asc' },
    });
    return l.map((c) => ({ id: c.id, nome: c.nome, contratado: c.interfone_contratado === 1 }));
  }

  async definirContratado(idCondominio: number, ligado: boolean, ator: AtorConfig): Promise<{ id: number; contratado: boolean }> {
    if (typeof ligado !== 'boolean') throw new BadRequestException('ligado deve ser true ou false.');
    const c = await this.prisma.condominios.findUnique({ where: { id: idCondominio }, select: { id: true } });
    if (!c) throw new NotFoundException('Condomínio não encontrado.');
    await this.prisma.condominios.update({ where: { id: idCondominio }, data: { interfone_contratado: ligado ? 1 : 0 } });
    await this.auditar(idCondominio, ator, `Interfone ${ligado ? 'CONTRATADO' : 'descontratado'} pelo CRM`, { contratado: ligado });
    return { id: idCondominio, contratado: ligado };
  }

  // ─────────────────────────────────────────── apoio

  private async condominio(idCondominio: number) {
    const c = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: {
        id: true,
        interfone_contratado: true,
        interfone_ativo: true,
        interfone_toque_apto_s: true,
        interfone_transferir: true,
        interfone_toque_portaria_s: true,
      },
    });
    if (!c) throw new NotFoundException('Condomínio não encontrado.');
    return c;
  }

  private paraConfig(c: Awaited<ReturnType<InterfoneConfigService['condominio']>>): ConfigInterfone {
    return {
      contratado: c.interfone_contratado === 1,
      ativo: c.interfone_ativo === 1,
      toque_apto_s: c.interfone_toque_apto_s,
      transferir: c.interfone_transferir === 1,
      toque_portaria_s: c.interfone_toque_portaria_s,
    };
  }

  private async assertContratado(idCondominio: number) {
    const c = await this.condominio(idCondominio);
    if (c.interfone_contratado !== 1) throw new ForbiddenException('O interfone não está contratado para este condomínio.');
  }

  private aptos(idCondominio: number) {
    return this.prisma.apartamentos.findMany({
      where: { id_condominio: idCondominio },
      select: { id: true, apto: true, bloco: true, interfone_ramal: true },
      orderBy: [{ bloco: 'asc' }, { apto: 'asc' }, { id: 'asc' }],
    });
  }

  private async facialDoCondominio(idCondominio: number, idFacial: number) {
    const f = await this.prisma.facial_Devices.findFirst({ where: { id: idFacial, id_condominio: idCondominio, tipo: 'facial' } });
    if (!f) throw new NotFoundException('Facial não encontrado.');
    return f;
  }

  private paraFacial(f: {
    id: number;
    nome: string;
    modelo: string | null;
    interfone_habilitado: number;
    interfone_blocos: string | null;
    interfone_dtmf: string | null;
    interfone_senha: string | null;
    interfone_registrado: number;
    interfone_registrado_em: Date | null;
  }) {
    return {
      id: f.id,
      nome: f.nome,
      modelo: f.modelo ?? null,
      habilitado: f.interfone_habilitado === 1,
      blocos: lerBlocos(f.interfone_blocos),
      dtmf: f.interfone_dtmf ?? null,
      conta: `fac-${f.id}`,
      senha: f.interfone_senha ?? null,
      servidor: VOZ_HOST,
      porta: VOZ_SIP_PORTA,
      registrado: f.interfone_registrado === 1,
      registrado_em: f.interfone_registrado_em ?? null,
    };
  }

  private paraMonitor(m: {
    id: number;
    id_apartamento: number;
    nome: string;
    senha: string;
    ativo: number;
    apartamento?: { apto: string | null; bloco: string | null } | null;
  }) {
    return {
      id: m.id,
      id_apartamento: m.id_apartamento,
      unidade: m.apartamento ? rotuloAptoBloco(m.apartamento.apto, m.apartamento.bloco) : '',
      nome: m.nome,
      ativo: m.ativo === 1,
      conta: `mon-${m.id}`,
      senha: m.senha,
      servidor: VOZ_HOST,
      porta: VOZ_SIP_PORTA,
    };
  }

  private async auditar(idCondominio: number, ator: AtorConfig, descricao: string, detalhes: object) {
    await this.auditoria?.registrar({
      id_condominio: idCondominio,
      usuario_nome: ator.nome || 'Síndico',
      autor_id: ator.autor_id,
      autor_tipo: ator.autor_tipo,
      acao: 'INTERFONE_CONFIG',
      modulo: 'interfone',
      descricao,
      detalhes,
    });
  }
}
