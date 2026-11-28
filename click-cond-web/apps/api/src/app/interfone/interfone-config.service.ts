import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { AuditoriaAutorTipo } from '../auditoria/auditoria.service';
import { normalizarBloco } from '../common/rotulo-bloco.util';
import { rotuloAptoBloco } from '../visitantes/rotulo-apto-bloco.util';
import { facialAtendeBloco, ramalValido, sugerirRamais } from './regras';
import { TOQUE_APTO_S, TOQUE_PORTARIA_S } from './interfone.service';
import { VOZ_HOST } from './token-voz';
import { AgentBridgeService, VERSAO_AGENTE_COM_INTERFONE_CONFIG } from '../facial/agent-bridge.service';
import { compararVersoesAgente } from '../facial/agent-version.service';
import { contaFacial } from './interfone.service';
import type { ContatoInterfoneAgente } from '../facial/agent-bridge.service';
import { normalizarFabricante } from '../facial/fabricantes';
import { validarAgenda } from './destino-portaria';
import type { FaixaAgenda } from './destino-portaria';

/**
 * Facial pelo tipo: cadastros antigos têm `tipo` vazio e contam como facial,
 * como no resto do código (facial.service). A coluna é NOT NULL, então não há null.
 */
const TIPO_FACIAL = { OR: [{ tipo: 'facial' }, { tipo: '' }] };

/**
 * Porta SIP do facial e do monitor (UDP). 5080, não 5060: o SIP ALG dos roteadores
 * mexe na 5060 e engole as respostas da central (bancada SS 3530, 28/11).
 */
export const VOZ_SIP_PORTA = 5080;
const ALFABETO_SENHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Cabeçalho do phoneBook do Intelbras (separador `;`). */
export const CABECALHO_LISTA_INTELBRAS =
  'Ramal;1° núm. chamado;Conta SIP;Tempo de ring;2° núm. chamado;Grupo agenda;Nome do bloco;Núm. andar';
/** Folga do "Tempo de ring" do facial sobre o toque da unidade + portaria (o facial não pode desligar antes da transferência). */
const FOLGA_RING_S = 10;

/** Só o Intelbras (família Dahua) tem o comando `interfone_config` no agente. */
function temConfigAutomatica(fabricante: unknown): boolean {
  return normalizarFabricante(fabricante) === 'intelbras';
}

/** Liga a configuração automática (G1). Desligada até a bancada aprovar. */
function flagConfigAutomatica(): boolean {
  return process.env['INTERFONE_CONFIG_AUTOMATICA'] === '1';
}

/** Resposta de "Configurar automaticamente" ao console. */
export interface ResultadoConfigFacial {
  ok: boolean;
  erro?: string;
  servidor_atual?: string;
  parcial?: boolean;
  restantes?: number;
  conflitos?: string[];
  avisos?: string[];
}

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
  /** Com a central contratada é sempre true (incluído no contrato) e o síndico não muda. */
  transferir: boolean;
  toque_portaria_s: number;
  /** Portaria autônoma: a Prestare liga no CRM. */
  central_contratada: boolean;
  /** true = o console mostra o "transferir" travado ("incluído no contrato da central"). */
  transferir_travado: boolean;
  /** Agenda da portaria (só leitura para o síndico); vazia sem central contratada. */
  agenda: FaixaAgenda[];
}

/** Campos que o síndico edita no PUT da config. */
export type ConfigInterfoneEdicao = Partial<Pick<ConfigInterfone, 'ativo' | 'toque_apto_s' | 'transferir' | 'toque_portaria_s'>>;

/** Cliente na aba Interfone do CRM. */
export interface ClienteInterfoneCrm {
  id: number;
  nome: string;
  contratado: boolean;
  central_contratada: boolean;
  ia_portao_ativa: boolean;
  numero_portaria: string;
  instrucao_entregas: string | null;
}

/** Número que o visitante digita no facial para chamar a portaria. */
const NUMERO_PORTARIA = /^\d{1,8}$/;
const INSTRUCAO_ENTREGAS_MAX = 2000;
/** 7 dias × faixas de meia hora: folga larga, só para barrar lista absurda. */
const AGENDA_MAX_FAIXAS = 336;

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

/**
 * Célula do CSV com `;`: aspas quando precisa. Texto que começa com = + - @
 * ganha um apóstrofo na frente, para o Excel do instalador não tratar como
 * fórmula (dado vem do síndico).
 */
function celula(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
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
    @Optional() private readonly agent?: AgentBridgeService,
  ) {}

  // ─────────────────────────────────────────── módulo

  async config(idCondominio: number): Promise<ConfigInterfone> {
    const c = await this.condominio(idCondominio);
    const agenda = c.central_contratada === 1 ? await this.lerAgenda(idCondominio) : [];
    return this.paraConfig(c, agenda);
  }

  /**
   * PUT do síndico. Com a central contratada a transferência é do contrato:
   * `transferir` do corpo é ignorado (nem validado) e a resposta volta com
   * `transferir: true, transferir_travado: true`.
   */
  async salvarConfig(idCondominio: number, body: ConfigInterfoneEdicao, ator: AtorConfig): Promise<ConfigInterfone> {
    const c = await this.assertContratado(idCondominio);
    if (c.central_contratada === 1 && body && typeof body === 'object' && 'transferir' in body) {
      const { transferir: _ignorado, ...resto } = body;
      body = resto;
    }
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
    const c = await this.assertContratado(idCondominio);
    if (!Array.isArray(itens) || itens.length > 5000) throw new BadRequestException('Envie a lista de ramais.');
    // Com a central, o número da portaria tem precedência no facial: um ramal igual nunca tocaria a unidade.
    const numPortaria = c.central_contratada === 1 ? String(c.interfone_numero_portaria ?? '').trim() : '';
    const aptos = await this.aptos(idCondominio);
    const porId = new Map(aptos.map((a) => [a.id, a]));
    const erros: { id_apartamento: number; ramal: string | null; motivo: string }[] = [];
    const novos = new Map<number, string | null>();
    for (const it of itens) {
      const id = Number(it?.id_apartamento);
      const ramal = it?.ramal === null || it?.ramal === undefined || String(it.ramal).trim() === '' ? null : String(it.ramal).trim();
      if (!porId.has(id)) erros.push({ id_apartamento: id, ramal, motivo: 'unidade_invalida' });
      else if (ramal !== null && !ramalValido(ramal)) erros.push({ id_apartamento: id, ramal, motivo: 'ramal_invalido' });
      else if (ramal !== null && numPortaria && ramal === numPortaria) {
        erros.push({ id_apartamento: id, ramal, motivo: 'ramal_conflita_portaria' });
      } else novos.set(id, ramal);
    }
    // Estado final: o que foi enviado por cima do que está gravado.
    const final = new Map<number, string | null>(aptos.map((a) => [a.id, a.interfone_ramal ?? null]));
    for (const [id, r] of novos) final.set(id, r);
    const usados = new Map<string, number[]>();
    for (const [id, r] of final) if (r) usados.set(r, [...(usados.get(r) ?? []), id]);
    for (const [id, r] of novos) {
      if (r && (usados.get(r)?.length ?? 0) > 1) erros.push({ id_apartamento: id, ramal: r, motivo: 'ramal_repetido' });
    }
    if (erros.length) {
      const message = erros.some((e) => e.motivo === 'ramal_conflita_portaria')
        ? `O ramal ${numPortaria} é o número da portaria (o visitante disca ${numPortaria} para chamar a portaria). Escolha outro número.`
        : 'Ramais inválidos.';
      throw new BadRequestException({ statusCode: 400, message, erros });
    }

    const mudam = [...novos].filter(([id, r]) => (porId.get(id)?.interfone_ramal ?? null) !== r);
    if (mudam.length) {
      // Primeiro limpa, depois grava: a chave única (un_apto_ramal) não
      // impede trocar dois ramais entre si.
      try {
        await this.prisma.$transaction([
          this.prisma.apartamentos.updateMany({ where: { id: { in: mudam.map(([id]) => id) }, id_condominio: idCondominio }, data: { interfone_ramal: null } }),
          ...mudam
            .filter(([, r]) => r !== null)
            .map(([id, r]) => this.prisma.apartamentos.update({ where: { id }, data: { interfone_ramal: r } })),
        ]);
      } catch (e: any) {
        // Outro save gravou o mesmo número entre a validação e a gravação.
        if (e?.code === 'P2002') {
          throw new BadRequestException({
            statusCode: 400,
            message: 'Ramal já usado por outra unidade. Recarregue e tente de novo.',
            erros: mudam.map(([id, r]) => ({ id_apartamento: id, ramal: r, motivo: 'ramal_repetido' })),
          });
        }
        throw e;
      }
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
      where: { id_condominio: idCondominio, ...TIPO_FACIAL },
      orderBy: { id: 'asc' },
    });
    const auto = await this.configAutomaticaDisponivel(idCondominio);
    return lista.map((f) => this.paraFacial(f, auto));
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
    return this.paraFacial(await this.facialDoCondominio(idCondominio, idFacial), await this.configAutomaticaDisponivel(idCondominio));
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
   * Configuração automática do facial Intelbras pelo Agente Local (G1): grava
   * no aparelho a conta SIP e a lista telefônica (unidades com ramal dos
   * blocos que o facial atende). Só pela rota manual do síndico — salvar o
   * facial ou os ramais NÃO dispara isto até a bancada confirmar os nomes da
   * API no SS 3532. Erro de negócio ou do agente volta como `{ok:false, erro}`
   * (o console mostra); a senha não vai para a auditoria nem para a resposta.
   */
  async configurarFacialAutomatico(
    idCondominio: number,
    idFacial: number,
    ator: AtorConfig,
    opcoes: { forcar?: boolean } = {},
  ): Promise<ResultadoConfigFacial> {
    await this.assertContratado(idCondominio);
    const f = await this.facialDoCondominio(idCondominio, idFacial);
    if (!(await this.configAutomaticaDisponivel(idCondominio))) {
      throw new ConflictException({
        statusCode: 409,
        motivo: 'indisponivel',
        message: 'Configuração automática indisponível (desligada ou Agente Local desatualizado). Use os dados para o instalador.',
      });
    }
    if (f.ativo !== 1) return { ok: false, erro: 'Facial desativado: ative o dispositivo antes de configurar.' };
    if (f.interfone_habilitado !== 1 || !f.interfone_senha) {
      return { ok: false, erro: 'Facial sem interfone habilitado: marque "Faz chamadas" e salve antes de configurar.' };
    }
    if (!temConfigAutomatica(f.fabricante)) {
      return { ok: false, erro: 'A configuração automática existe só para facial Intelbras. Use os dados para o instalador.' };
    }
    if (!this.agent) return { ok: false, erro: 'Agente Local indisponível.' };
    const forcar = opcoes.forcar === true;

    const contatos: ContatoInterfoneAgente[] = (await this.aptos(idCondominio))
      .filter((a) => a.interfone_ramal && facialAtendeBloco(f.interfone_blocos ?? null, a.bloco))
      .map((a) => ({
        nome: rotuloAptoBloco(a.apto, a.bloco),
        numero: a.interfone_ramal as string,
        bloco: a.bloco ?? '',
        andar: andarDoApto(a.apto),
      }));
    const r = await this.agent.enqueue(f.id, {
      type: 'interfone_config',
      interfone: { servidor: VOZ_HOST, porta: VOZ_SIP_PORTA, conta: contaFacial(f.id), senha: f.interfone_senha, forcar, contatos },
    });
    await this.auditar(
      idCondominio,
      ator,
      r.ok
        ? `Facial "${f.nome}" configurado automaticamente para o interfone`
        : `Configuração automática do facial "${f.nome}" falhou`,
      {
        id_facial: f.id,
        contatos: contatos.length,
        forcar,
        ok: r.ok,
        ...(r.ok
          ? { sip: r.sip ?? null, lista: r.contatos ?? null, parcial: !!r.parcial, conflitos: r.conflitos ?? [] }
          : { erro: r.error ?? null, servidor_atual: r.servidor_atual ?? null }),
      },
    );
    if (!r.ok) {
      const erro = r.error || 'O agente não conseguiu configurar o facial.';
      return erro === 'sip_de_outro_servidor'
        ? { ok: false, erro, servidor_atual: r.servidor_atual ?? '' }
        : { ok: false, erro };
    }
    return {
      ok: true,
      parcial: !!r.parcial,
      restantes: Number(r.restantes) || 0,
      conflitos: Array.isArray(r.conflitos) ? r.conflitos : [],
      avisos: Array.isArray(r.avisos) ? r.avisos : [],
    };
  }

  /**
   * Botão e rota só com a flag `INTERFONE_CONFIG_AUTOMATICA=1` E o Agente
   * Local do condomínio numa versão que tem o comando (pela telemetria).
   */
  private async configAutomaticaDisponivel(idCondominio: number): Promise<boolean> {
    if (!flagConfigAutomatica() || !this.agent) return false;
    const versao = (await this.agent.getTelemetria(idCondominio).catch(() => null))?.versao;
    return !!versao && compararVersoesAgente(versao, VERSAO_AGENTE_COM_INTERFONE_CONFIG) >= 0;
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

  async clientesCrm(): Promise<ClienteInterfoneCrm[]> {
    const l = await this.prisma.condominios.findMany({
      select: {
        id: true,
        nome: true,
        interfone_contratado: true,
        central_contratada: true,
        ia_portao_ativa: true,
        interfone_numero_portaria: true,
        instrucao_entregas: true,
      },
      orderBy: { nome: 'asc' },
    });
    return l.map((c) => ({
      id: c.id,
      nome: c.nome,
      contratado: c.interfone_contratado === 1,
      central_contratada: c.central_contratada === 1,
      ia_portao_ativa: c.ia_portao_ativa === 1,
      numero_portaria: c.interfone_numero_portaria ?? '0',
      instrucao_entregas: c.instrucao_entregas ?? null,
    }));
  }

  /**
   * Central Prestare (portaria autônoma). Ligar exige o interfone contratado
   * (`400 interfone_nao_contratado`); desligar vale sempre, para o CRM poder
   * limpar um condomínio que perdeu o interfone.
   */
  async definirCentral(idCondominio: number, ligado: boolean, ator: AtorConfig): Promise<{ id: number; central_contratada: boolean }> {
    if (typeof ligado !== 'boolean') throw new BadRequestException('ligado deve ser true ou false.');
    const c = await this.prisma.condominios.findUnique({ where: { id: idCondominio }, select: { id: true, interfone_contratado: true } });
    if (!c) throw new NotFoundException('Condomínio não encontrado.');
    if (ligado && c.interfone_contratado !== 1) {
      throw new BadRequestException({
        statusCode: 400,
        motivo: 'interfone_nao_contratado',
        message: 'Contrate o Interfone pelo app antes de ligar a central.',
      });
    }
    await this.prisma.condominios.update({ where: { id: idCondominio }, data: { central_contratada: ligado ? 1 : 0 } });
    await this.auditar(idCondominio, ator, `Central Prestare ${ligado ? 'CONTRATADA' : 'descontratada'} pelo CRM`, { central_contratada: ligado });
    return { id: idCondominio, central_contratada: ligado };
  }

  /** IA no portão: só guarda a coluna (a IA age a partir da Entrega 2). */
  async definirIa(idCondominio: number, ligado: boolean, ator: AtorConfig): Promise<{ id: number; ia_portao_ativa: boolean }> {
    if (typeof ligado !== 'boolean') throw new BadRequestException('ligado deve ser true ou false.');
    await this.condominioExiste(idCondominio);
    await this.prisma.condominios.update({ where: { id: idCondominio }, data: { ia_portao_ativa: ligado ? 1 : 0 } });
    await this.auditar(idCondominio, ator, `IA no portão ${ligado ? 'ligada' : 'desligada'} pelo CRM`, { ia_portao_ativa: ligado });
    return { id: idCondominio, ia_portao_ativa: ligado };
  }

  /**
   * Número da portaria (1–8 dígitos, diferente de todo ramal do condomínio:
   * `400 numero_conflita_ramal`) e instruções de entrega (texto livre, vazio
   * limpa). Campo ausente no corpo fica como está.
   */
  async salvarPortaria(
    idCondominio: number,
    body: { numero_portaria?: unknown; instrucao_entregas?: unknown },
    ator: AtorConfig,
  ): Promise<{ id: number; numero_portaria: string; instrucao_entregas: string | null }> {
    const data: { interfone_numero_portaria?: string; instrucao_entregas?: string | null } = {};
    if (body?.numero_portaria !== undefined) {
      const n = body.numero_portaria;
      if (typeof n !== 'string' || !NUMERO_PORTARIA.test(n.trim())) {
        throw new BadRequestException({ statusCode: 400, motivo: 'numero_invalido', message: 'Número da portaria: de 1 a 8 dígitos.' });
      }
      data.interfone_numero_portaria = n.trim();
    }
    if (body?.instrucao_entregas !== undefined) {
      const t = body.instrucao_entregas;
      if (t !== null && typeof t !== 'string') throw new BadRequestException('instrucao_entregas deve ser texto.');
      const limpo = (t ?? '').trim();
      if (limpo.length > INSTRUCAO_ENTREGAS_MAX) {
        throw new BadRequestException(`Instruções de entrega: até ${INSTRUCAO_ENTREGAS_MAX} caracteres.`);
      }
      data.instrucao_entregas = limpo || null;
    }
    await this.condominioExiste(idCondominio);
    if (data.interfone_numero_portaria !== undefined) {
      const conflito = await this.prisma.apartamentos.findFirst({
        where: { id_condominio: idCondominio, interfone_ramal: data.interfone_numero_portaria },
        select: { id: true, apto: true, bloco: true },
      });
      if (conflito) {
        throw new BadRequestException({
          statusCode: 400,
          motivo: 'numero_conflita_ramal',
          message: `O número ${data.interfone_numero_portaria} já é o ramal de ${rotuloAptoBloco(conflito.apto, conflito.bloco)}. Escolha outro.`,
        });
      }
    }
    if (Object.keys(data).length) {
      await this.prisma.condominios.update({ where: { id: idCondominio }, data });
      await this.auditar(idCondominio, ator, 'Portaria da central alterada pelo CRM', { alteracoes: data });
    }
    const c = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { interfone_numero_portaria: true, instrucao_entregas: true },
    });
    return { id: idCondominio, numero_portaria: c?.interfone_numero_portaria ?? '0', instrucao_entregas: c?.instrucao_entregas ?? null };
  }

  async agendaCrm(idCondominio: number): Promise<FaixaAgenda[]> {
    await this.condominioExiste(idCondominio);
    return this.lerAgenda(idCondominio);
  }

  /**
   * Troca a agenda inteira (lista vazia = sem agenda, tudo local). Valida com
   * `validarAgenda` antes de apagar qualquer coisa (`400 agenda_invalida`).
   */
  async salvarAgenda(idCondominio: number, faixas: unknown, ator: AtorConfig): Promise<FaixaAgenda[]> {
    if (!Array.isArray(faixas) || faixas.length > AGENDA_MAX_FAIXAS) {
      throw new BadRequestException({ statusCode: 400, motivo: 'agenda_invalida', message: 'Envie a lista de faixas da agenda.' });
    }
    const lista: FaixaAgenda[] = faixas.map((f: any) => ({
      dia_semana: Number(f?.dia_semana),
      inicio: String(f?.inicio ?? '').trim(),
      fim: String(f?.fim ?? '').trim(),
      destino: f?.destino,
    }));
    const erro = validarAgenda(lista);
    if (erro) throw new BadRequestException({ statusCode: 400, motivo: 'agenda_invalida', message: erro });
    await this.condominioExiste(idCondominio);
    await this.prisma.$transaction([
      this.prisma.portaria_Agenda.deleteMany({ where: { id_condominio: idCondominio } }),
      ...lista.map((f) => this.prisma.portaria_Agenda.create({ data: { id_condominio: idCondominio, ...f } })),
    ]);
    await this.auditar(idCondominio, ator, `Agenda da portaria alterada pelo CRM (${lista.length} faixa(s))`, { agenda: lista });
    return this.lerAgenda(idCondominio);
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
        central_contratada: true,
        interfone_numero_portaria: true,
      },
    });
    if (!c) throw new NotFoundException('Condomínio não encontrado.');
    return c;
  }

  private async condominioExiste(idCondominio: number): Promise<void> {
    const c = await this.prisma.condominios.findUnique({ where: { id: idCondominio }, select: { id: true } });
    if (!c) throw new NotFoundException('Condomínio não encontrado.');
  }

  private async lerAgenda(idCondominio: number): Promise<FaixaAgenda[]> {
    const l = await this.prisma.portaria_Agenda.findMany({
      where: { id_condominio: idCondominio },
      orderBy: [{ dia_semana: 'asc' }, { inicio: 'asc' }],
    });
    return l.map((f) => ({ dia_semana: f.dia_semana, inicio: f.inicio, fim: f.fim, destino: f.destino as FaixaAgenda['destino'] }));
  }

  private paraConfig(c: Awaited<ReturnType<InterfoneConfigService['condominio']>>, agenda: FaixaAgenda[]): ConfigInterfone {
    const central = c.central_contratada === 1;
    return {
      contratado: c.interfone_contratado === 1,
      ativo: c.interfone_ativo === 1,
      toque_apto_s: c.interfone_toque_apto_s,
      transferir: central || c.interfone_transferir === 1,
      toque_portaria_s: c.interfone_toque_portaria_s,
      central_contratada: central,
      transferir_travado: central,
      agenda: central ? agenda : [],
    };
  }

  private async assertContratado(idCondominio: number) {
    const c = await this.condominio(idCondominio);
    if (c.interfone_contratado !== 1) throw new ForbiddenException('O interfone não está contratado para este condomínio.');
    return c;
  }

  private aptos(idCondominio: number) {
    return this.prisma.apartamentos.findMany({
      where: { id_condominio: idCondominio },
      select: { id: true, apto: true, bloco: true, interfone_ramal: true },
      orderBy: [{ bloco: 'asc' }, { apto: 'asc' }, { id: 'asc' }],
    });
  }

  private async facialDoCondominio(idCondominio: number, idFacial: number) {
    const f = await this.prisma.facial_Devices.findFirst({ where: { id: idFacial, id_condominio: idCondominio, ...TIPO_FACIAL } });
    if (!f) throw new NotFoundException('Facial não encontrado.');
    return f;
  }

  private paraFacial(f: {
    id: number;
    nome: string;
    modelo: string | null;
    fabricante?: string | null;
    ativo?: number;
    interfone_habilitado: number;
    interfone_blocos: string | null;
    interfone_dtmf: string | null;
    interfone_senha: string | null;
    interfone_registrado: number;
    interfone_registrado_em: Date | null;
  }, configAutomatica = false) {
    return {
      id: f.id,
      nome: f.nome,
      modelo: f.modelo ?? null,
      habilitado: f.interfone_habilitado === 1,
      blocos: lerBlocos(f.interfone_blocos),
      dtmf: f.interfone_dtmf ?? null,
      conta: contaFacial(f.id),
      senha: f.interfone_senha ?? null,
      servidor: VOZ_HOST,
      porta: VOZ_SIP_PORTA,
      registrado: f.interfone_registrado === 1,
      registrado_em: f.interfone_registrado_em ?? null,
      /** Intelbras: o console oferece "Configurar automaticamente" (G1). */
      config_automatica: configAutomatica && f.ativo === 1 && temConfigAutomatica(f.fabricante),
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
      conta: `mon${m.id}`,
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
