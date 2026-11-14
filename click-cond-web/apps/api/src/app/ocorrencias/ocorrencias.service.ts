import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantAccessService, ehFuncionarioDoApp } from '../auth/tenant-access.service';
import { StorageService } from '../common/storage/storage.service';
import { assertOperador, assertSindicoEstrito, assertStaff, isOperador, isSindicoEstrito } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { idFuncionarioPortariaDoToken, idUsuarioDoToken } from '../auth/usuario-do-token.util';
import { autorOcorrencia, OrigemOcorrencia, rotuloPortaria } from './autor-ocorrencia.util';
import { subirAnexosOcorrencia } from './anexos-ocorrencia.util';
import { INCLUDE_AUTOR_MENSAGEM, mensagemParaResposta } from './mensagem-ocorrencia.util';

export type OcorrenciaStatus = 'Pendente' | 'Ciente' | 'Solucionado';

/**
 * Status que a tela de resposta do app envia ('ciente' | 'solucionado') para o
 * vocabulário gravado no banco e lido pela portaria. 'Pendente' não é resposta.
 */
const STATUS_DA_RESPOSTA_APP: Record<string, OcorrenciaStatus> = {
  ciente: 'Ciente',
  solucionado: 'Solucionado',
};

/**
 * De onde cada status pedido pode partir (updateStatus). 'Pendente' é o
 * Reabrir da tela: só de Solucionado (inclusive as grafias antigas).
 */
/** Grafias antigas de "solucionado" ainda gravadas (o console já tratava 'Resolvida'). */
const SOLUCIONADO_LEGADO = ['Solucionado', 'Solucionada', 'Resolvida', 'Resolvido'];

const ORIGENS_DO_STATUS: Record<OcorrenciaStatus, string[]> = {
  Ciente: ['Pendente'],
  Solucionado: ['Pendente', 'Ciente'],
  Pendente: SOLUCIONADO_LEGADO,
};

/** Status para comparar: minúsculo, sem espaços, grafias antigas de solucionado juntas. */
function statusComparavel(s: string | null | undefined): string {
  const n = (s ?? 'Pendente').trim().toLowerCase();
  return SOLUCIONADO_LEGADO.some((x) => x.toLowerCase() === n) ? 'solucionado' : n;
}

/** Pendente = ninguém da equipe deu ciência ainda (status nulo conta como Pendente). */
function estaPendente(status: string | null | undefined): boolean {
  return (status ?? 'Pendente').trim().toLowerCase() === 'pendente';
}

/** Mensagem que não é do autor (porteiro do console grava id_usuario NULL). */
function mensagemDeOutro(idAutor: number) {
  return { OR: [{ id_usuario: null }, { id_usuario: { not: idAutor } }] };
}

/**
 * Filtro da escrita do autor: ninguém da equipe respondeu (resposta pública)
 * nem escreveu no chat. Sem isso, "Pendente" não bastava — a equipe responde
 * sem dar Ciente, e o autor reescrevia ou apagava (com o chat em cascata).
 */
function semRespostaDaEquipe(idAutor: number) {
  return { resposta_at: null, mensagens: { none: mensagemDeOutro(idAutor) } };
}

function idValido(id: unknown): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException('Ocorrência inválida.');
  return n;
}

export interface CreateOcorrenciaDto {
  descricao: string;
  tipo: number;
  anexos?: string;
  id_condominio: number;
  user?: number;
}

/** Autoria de quem abre sem conta em Users — só o servidor preenche (token, CRM, monitor). */
export interface AutoriaOcorrencia {
  origem: OrigemOcorrencia;
  id_funcionario_portaria?: number | null;
}

/**
 * Rótulos que só o createMessageDoSistema escreve no início da mensagem
 * (um ou mais, ignorando maiúsculas e espaços). A rota pública os retira.
 */
const PREFIXO_RESERVADO = /^\s*(?:\[\s*(?:suporte\s+prestare|kabania)\s*\]\s*)+/i;

/** Categoria criada pelo monitor de dispositivos (facial.service), não pela portaria. */
const CATEGORIA_AUTOMATICA = 'Dispositivos';

/** Taxonomia inicial (prioridade: 1 crítica, 2 alta, 3 média, 4 baixa; SLA em horas). */
const CATEGORIAS_PADRAO = [
  { nome: 'Segurança', prioridade: 1, sla_horas: 4 },
  { nome: 'Portaria e acesso', prioridade: 2, sla_horas: 24 },
  { nome: 'Manutenção', prioridade: 2, sla_horas: 48 },
  { nome: 'Barulho e convivência', prioridade: 3, sla_horas: 48 },
  { nome: 'Limpeza', prioridade: 3, sla_horas: 48 },
  { nome: 'Outros', prioridade: 4, sla_horas: null },
];

/**
 * Categorias são globais e definidas pela operadora, não pelo condomínio.
 * A claim `role` só vale vinda das rotas do CRM (CrmAdminGuard reconfere crm_admins.ativo); a rota de
 * tenant monta os mesmos métodos sem o guard.
 */
function assertAdminCrm(user?: JwtPayload, opcoes: { viaCrm?: boolean } = {}): void {
  if (opcoes.viaCrm !== true || user?.role !== 'crm_admin') {
    throw new ForbiddenException('As categorias são definidas pela Prestare.');
  }
}

@Injectable()
export class OcorrenciasService {
  private readonly logger = new Logger(OcorrenciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly tenant: TenantAccessService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Carrega uma ocorrência, confirma que pertence ao condomínio do operador
   * e que o operador é síndico/funcionário. Use antes da resposta pelo app
   * (o atendimento do console usa loadParaAtendimento; remover e
   * visibilidade, loadParaAdministrar) — sem isso, um
   * morador (ou usuário de outro condomínio) altera/apaga ocorrência alheia
   * só chutando o id.
   */
  private async loadParaMutacaoStaff(id: number, user: JwtPayload | undefined, contexto: string) {
    assertStaff(user, contexto);
    const o = await this.prisma.ocorrencias.findUnique({ where: { id }, select: { id_condominio: true } });
    if (!o) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${id}`);
    // Administrar ocorrência é a área `ocorrencias`: funcionário do app sem a
    // flag mudava status, respondia e atribuía a que não pode nem ler. Síndico
    // não depende de flag; o operador da portaria-web, sem typeAccess, já para
    // no assertStaff acima, como antes.
    await this.exigirFlagOcorrencias(o.id_condominio, user);
    return o;
  }

  /**
   * Remover e alternar Pública/Privada: só o síndico (regra do dono), pelo
   * typeAccess carimbado no login — o mesmo critério de `acesso().administrar`.
   * O funcionário com a flag `ocorrencias` atende, mas não apaga nem expõe a
   * ocorrência privada; o `turno` do porteiro é texto livre e não conta.
   */
  private async loadParaAdministrar(id: number, user: JwtPayload | undefined, contexto: string) {
    assertSindicoEstrito(user, contexto);
    const o = await this.prisma.ocorrencias.findUnique({ where: { id }, select: { id_condominio: true } });
    if (!o) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${id}`);
    return o;
  }

  /**
   * Como loadParaMutacaoStaff, para o atendimento do dia a dia (ciente,
   * solucionar, reabrir, responder, atribuir): aceita também o porteiro do
   * console (assertOperador), a mesma regra das outras telas da portaria. O
   * funcionário do app — inclusive no console por QR Code — continua
   * dependendo da flag `ocorrencias`. Remover e alternar Pública/Privada
   * seguem em loadParaMutacaoStaff, fora do alcance do porteiro.
   */
  private async loadParaAtendimento(id: number, user: JwtPayload | undefined, contexto: string) {
    assertOperador(user, contexto);
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id },
      select: { id_condominio: true, tipo: true, status: true, updated_at: true },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${id}`);
    await this.exigirFlagOcorrencias(o.id_condominio, user);
    return o;
  }

  /**
   * O que a tela do console pode oferecer a quem está logado — a mesma regra
   * que as rotas aplicam, para a tela não mostrar botão que vai dar 403.
   *  - operar: ciente, solucionar, reabrir, responder, atribuir;
   *  - administrar: remover e alternar Pública/Privada (só síndico na tela);
   *  - conversar: escrever no chat — com Users.id ou como porteiro do
   *    console (a mensagem dele grava id_funcionario_portaria).
   */
  async acesso(idCondominio: number, user?: JwtPayload) {
    const operar = isOperador(user) && !(await this.semFlagOcorrencias(idCondominio, user));
    return {
      operar,
      administrar: operar && isSindicoEstrito(user),
      conversar: operar && (idUsuarioDoToken(user) != null || idFuncionarioPortariaDoToken(user) != null),
    };
  }

  /**
   * Qualquer um se a ocorrência é pública; o autor; e a equipe — síndico,
   * operador do console e funcionário do app COM a flag `ocorrencias`, a
   * mesma regra do `getOcorrenciaById` do app. Sem a flag, o funcionário via
   * o chat e a ficha da ocorrência privada que lá tomava 403.
   */
  private async assertPodeVer(
    o: { id_condominio: number; user: number | null; publica: boolean },
    requester?: JwtPayload,
  ) {
    if (o.publica || this.ehAutor(o, requester)) return;
    if (!this.ehEquipe(requester)) {
      throw new ForbiddenException('Acesso negado: ocorrência não pertence a você');
    }
    await this.exigirFlagOcorrencias(o.id_condominio, requester);
  }

  /** Só o funcionário do app depende da flag; síndico e console, não. */
  private async exigirFlagOcorrencias(idCondominio: number, requester?: JwtPayload) {
    if (!ehFuncionarioDoApp(requester)) return;
    await this.tenant.assertPermissaoFuncionario(idCondominio, 'ocorrencias', requester);
  }

  /** Funcionário do app sem a flag `ocorrencias` lê só o que o morador leria. */
  private async semFlagOcorrencias(idCondominio: number, requester?: JwtPayload): Promise<boolean> {
    try {
      await this.exigirFlagOcorrencias(idCondominio, requester);
      return false;
    } catch (e) {
      if (e instanceof ForbiddenException) return true;
      throw e;
    }
  }

  /**
   * Síndico/funcionário do app ou operador da portaria-web (token com
   * id_condominio) — o mesmo critério que a listagem já usava. Antes o
   * porteiro via a ocorrência na lista e levava 403 ao abri-la.
   */
  private ehEquipe(requester?: JwtPayload): boolean {
    const typeAccess = requester?.typeAccess ?? requester?.user?.typeAccess;
    return typeAccess === 'Sindico' || typeAccess === 'Funcionario' || !!requester?.id_condominio;
  }

  /** A equipe já respondeu (resposta pública) ou escreveu no chat — só para a mensagem certa; a garantia é o filtro da escrita. */
  private async equipeJaRespondeu(idOc: number, o: { user: number | null; resposta_at?: Date | null }): Promise<boolean> {
    if (o.resposta_at) return true;
    if (o.user == null) return false;
    const n = await this.prisma.ocorrenciaMensagens.count({ where: { id_ocorrencia: idOc, ...mensagemDeOutro(o.user) } });
    return n > 0;
  }

  /** Autor pelo Users.id real — `sub` do porteiro é Funcionarios_Portaria.id. */
  private ehAutor(o: { user: number | null }, requester?: JwtPayload): boolean {
    const callerId = idUsuarioDoToken(requester);
    return callerId != null && o.user === callerId;
  }

  async listCategorias() {
    const todas = await this.prisma.ocorrencias_Categorias.findMany({ orderBy: { prioridade: 'asc' } });
    // Instalação nova só tem "Dispositivos" (criada pelo monitor facial), e aí
    // toda ocorrência da portaria saía como Crítica. Semeia uma taxonomia
    // básica uma única vez; depois o síndico edita em "Categorias / SLA".
    if (todas.some((c) => c.nome !== CATEGORIA_AUTOMATICA)) return todas;
    await this.prisma.ocorrencias_Categorias.createMany({ data: CATEGORIAS_PADRAO });
    return this.prisma.ocorrencias_Categorias.findMany({ orderBy: { prioridade: 'asc' } });
  }

  // ----- Categorias CRUD (mini-helpdesk: nome, prioridade, SLA em horas) -----
  // Categorias são globais (tabela sem id_condominio): não há dono por tenant,
  // então síndico de um prédio não pode editá-las para todos. Só o administrador
  // do CRM (role 'crm_admin', rotas sob CrmAdminGuard) escreve; os demais leem.
  async createCategoria(
    data: { nome: string; prioridade?: number; sla_horas?: number | null },
    user?: JwtPayload,
    opcoes: { viaCrm?: boolean } = {},
  ) {
    assertAdminCrm(user, opcoes);
    return this.prisma.ocorrencias_Categorias.create({
      data: {
        nome: data.nome,
        prioridade: data.prioridade ?? 0,
        sla_horas: data.sla_horas ?? null,
      },
    });
  }

  async updateCategoria(
    id: number,
    data: { nome?: string; prioridade?: number; sla_horas?: number | null },
    user?: JwtPayload,
    opcoes: { viaCrm?: boolean } = {},
  ) {
    assertAdminCrm(user, opcoes);
    try {
      return await this.prisma.ocorrencias_Categorias.update({
        where: { id },
        data: {
          ...(data.nome !== undefined ? { nome: data.nome } : {}),
          ...(data.prioridade !== undefined ? { prioridade: data.prioridade } : {}),
          ...(data.sla_horas !== undefined ? { sla_horas: data.sla_horas } : {}),
        },
      });
    } catch {
      throw new NotFoundException(`Categoria ${id} não encontrada`);
    }
  }

  async removeCategoria(id: number, user?: JwtPayload, opcoes: { viaCrm?: boolean } = {}) {
    assertAdminCrm(user, opcoes);
    try {
      await this.prisma.ocorrencias_Categorias.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Categoria ${id} não encontrada`);
    }
  }

  /** Resolve nome (Users.name) para uma lista de ids de responsável. */
  // Aceita null: os chamadores passam `id_responsavel`, que e opcional. O
  // filtro logo abaixo ja descartava os nulos — so o tipo estava estreito.
  private async responsavelNomes(ids: (number | null)[]): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((v): v is number => v != null))];
    if (uniq.length === 0) return new Map();
    const users = await this.prisma.users.findMany({
      where: { id: { in: uniq } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name ?? '']));
  }

  /**
   * Funcionários (porteiros) do condomínio que podem ser responsáveis por
   * ocorrências. Retorna id_user (Users.id, usado no push) + nome.
   */
  async listFuncionariosAtribuiveis(idCondominio: number) {
    const reais = await this.prisma.funcionarios_Portaria.findMany({
      where: { id_condominio: Number(idCondominio), ativo: 1 },
      orderBy: { nome: 'asc' },
    });
    const logins = reais.map((f) => f.login).filter(Boolean) as string[];
    if (logins.length === 0) return [];
    const users = await this.prisma.users.findMany({
      where: { login: { in: logins } },
      select: { id: true, login: true },
    });
    const idMap = new Map(users.map((u) => [u.login, u.id]));
    return reais
      .map((f) => ({
        id_user: f.login ? idMap.get(f.login) ?? null : null,
        id_funcionario_portaria: f.id,
        nome: f.nome ?? '',
        funcao: f.turno ? `Porteiro ${f.turno}` : 'Porteiro',
      }))
      .filter((f) => f.id_user != null);
  }

  /**
   * A regra de visibilidade já existia — `assertPodeVer`, usada no `findOne`:
   * staff vê tudo, morador vê as públicas e as que ele mesmo abriu. Só que a
   * LISTAGEM não aplicava nada e devolvia todas as ocorrências do condomínio,
   * inclusive as privadas, com a descrição e o nome de quem abriu.
   *
   * Num condomínio, ocorrência costuma ser reclamação — muitas vezes sobre o
   * vizinho. O mesmo recorte do `findOne` agora vale aqui, direto no `where`.
   */
  async findAll(idCondominio: number, status?: string, requester?: JwtPayload) {
    const typeAccess = requester?.typeAccess ?? requester?.user?.typeAccess;
    const isStaff = typeAccess === 'Sindico' || typeAccess === 'Funcionario';
    const callerId = idUsuarioDoToken(requester) ?? -1;
    // Operador do console (token com id_condominio) também administra.
    // Funcionário sem a flag `ocorrencias` fica com o recorte do morador.
    const podeVerTudo =
      (isStaff || !!requester?.id_condominio || !requester) &&
      !(await this.semFlagOcorrencias(idCondominio, requester));

    const list = await this.prisma.ocorrencias.findMany({
      where: {
        id_condominio: idCondominio,
        ...(status ? { status } : {}),
        ...(podeVerTudo ? {} : { OR: [{ publica: true }, { user: callerId }] }),
      },
      include: {
        categoria: { select: { nome: true, sla_horas: true } },
        criadoPor: { select: { name: true } },
        funcionarioPortaria: { select: { nome: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    const nomes = await this.responsavelNomes(list.map((o) => o.id_responsavel));
    return list.map((o) => ({
      id: o.id,
      descricao: o.descricao,
      anexos: o.anexos,
      status: o.status,
      resposta: o.resposta,
      resposta_at: o.resposta_at,
      tipo: o.tipo,
      tipoNome: o.categoria?.nome ?? null,
      sla_horas: o.categoria?.sla_horas ?? null,
      prazo: o.prazo,
      id_responsavel: o.id_responsavel,
      responsavelNome: o.id_responsavel ? nomes.get(o.id_responsavel) ?? null : null,
      criadoPorNome: autorOcorrencia(o.criadoPor?.name, o.categoria?.nome, o.origem, o.funcionarioPortaria?.nome),
      created_at: o.created_at,
      // Carimbo da última alteração: a tela devolve ao mudar status (updated_at_esperado).
      updated_at: o.updated_at,
      publica: o.publica,
    }));
  }

  async findOne(id: number, requester?: JwtPayload) {
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id },
      include: {
        categoria: { select: { nome: true, sla_horas: true } },
        criadoPor: { select: { name: true } },
        funcionarioPortaria: { select: { nome: true } },
      },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, requester, `ocorrência #${id}`);
    await this.assertPodeVer(o, requester);
    const nomes = await this.responsavelNomes([o.id_responsavel]);
    return {
      ...o,
      tipoNome: o.categoria?.nome ?? null,
      sla_horas: o.categoria?.sla_horas ?? null,
      responsavelNome: o.id_responsavel ? nomes.get(o.id_responsavel) ?? null : null,
      criadoPorNome: autorOcorrencia(o.criadoPor?.name, o.categoria?.nome, o.origem, o.funcionarioPortaria?.nome),
    };
  }

  async create(dto: CreateOcorrenciaDto, autoria?: AutoriaOcorrencia) {
    // Ocorrência nova: nenhuma URL do bucket é anexo dela (a API assina toda
    // URL do bucket que devolve — ver StorageService.exigirArquivoDoRegistro).
    // Cada parte separada por ';' também, sem exceção para data URL: as partes
    // de uma data URL legítima nunca são URL do bucket, e "data:x;<URL>" não
    // pode passar escondida.
    await this.storage.exigirArquivoDoRegistro(dto.anexos, []);
    if (typeof dto.anexos === 'string') {
      for (const parte of dto.anexos.split(';')) await this.storage.exigirArquivoDoRegistro(parte.trim(), []);
    }

    // Normaliza tipo: app Flutter pode enviar como string mas schema eh Int.
    const tipoNum = dto.tipo != null ? Number(dto.tipo) : null;
    const prazo = await this.prazoDaCategoria(tipoNum);

    try {
      return await this.prisma.ocorrencias.create({
        data: {
          descricao: dto.descricao,
          anexos: dto.anexos ?? null,
          tipo: tipoNum,
          status: 'Pendente',
          id_condominio: dto.id_condominio,
          user: dto.user ?? null,
          prazo,
          // Campos explícitos: `dto` pode vir do corpo da requisição e não
          // escolhe a autoria.
          ...(autoria
            ? { origem: autoria.origem, id_funcionario_portaria: autoria.id_funcionario_portaria ?? null }
            : {}),
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[ocorrencias.create] Falha: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel registrar a ocorrencia. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }
  }

  /** SLA: prazo = agora + sla_horas da categoria; sem categoria ou sem SLA, nulo. Também usado pelo Reabrir do CRM. */
  async prazoDaCategoria(tipo: number | null): Promise<Date | null> {
    if (tipo == null) return null;
    const cat = await this.prisma.ocorrencias_Categorias.findUnique({
      where: { id: tipo },
      select: { sla_horas: true },
    });
    return cat?.sla_horas != null ? new Date(Date.now() + cat.sla_horas * 3600 * 1000) : null;
  }

  /** Push ao autor da ocorrência, respeitando a preferência `notif_ocorrencias`. */
  private async notificarAutor(ocorrenciaId: number, idUser: number | null | undefined, titulo: string, corpo: string) {
    if (!idUser) return;
    try {
      const u = await this.prisma.users.findUnique({
        where: { id: idUser },
        select: { fcm_token: true, notif_ocorrencias: true },
      });
      if (!u?.fcm_token || u.notif_ocorrencias === 0) return;
      await this.notifications.sendPushNotification(u.fcm_token, titulo, corpo, {
        type: 'ocorrencia',
        id: String(ocorrenciaId),
      });
    } catch (e: any) {
      this.logger.error(`[ocorrencias.push] ${e?.message ?? e}`);
    }
  }

  /**
   * `esperado` (opcional, o console manda): o status e o `updated_at` que a
   * tela mostrava. Diferente do atual → 409. Sem ele vale só a regra de
   * origem (cliente antigo e app). O carimbo pega o que o status sozinho não
   * pega: solucionada e reaberta de novo enquanto a tela de outro porteiro
   * ainda mostrava "Pendente".
   */
  async updateStatus(
    id: number,
    status: OcorrenciaStatus,
    user?: JwtPayload,
    esperado: { status?: string | null; updated_at?: string | null } = {},
  ) {
    // Fora do vocabulário (inclusive chaves herdadas como 'toString'): 400.
    if (typeof status !== 'string' || !Object.prototype.hasOwnProperty.call(ORIGENS_DO_STATUS, status)) {
      throw new BadRequestException('Status inválido.');
    }
    let carimbo: Date | null = null;
    if (esperado.updated_at != null && esperado.updated_at !== '') {
      carimbo = new Date(esperado.updated_at);
      if (Number.isNaN(carimbo.getTime())) throw new BadRequestException('updated_at_esperado inválido.');
    }
    const atual = await this.loadParaAtendimento(id, user, 'alterar status da ocorrência');
    // A escrita é condicionada ao status de origem: com a lista de 30 s
    // atrás, um "Marcar como ciente" sobre uma ocorrência já solucionada a
    // fazia regredir (e o morador recebia "Ciente" logo depois de
    // "Solucionado"). Reabrir ('Pendente', o que a tela manda) só sai de
    // Solucionado e grava Pendente (o app mostra Responder e a aba Pendentes
    // por esse status); a proteção do autor é a da resposta/chat da equipe.
    const reabrindo = status === 'Pendente';
    const origens = ORIGENS_DO_STATUS[status];
    const atualNorm = statusComparavel(atual.status);
    const mudou =
      (esperado.status != null && esperado.status !== '' && statusComparavel(esperado.status) !== atualNorm) ||
      (carimbo != null && (!atual.updated_at || new Date(atual.updated_at).getTime() !== carimbo.getTime()));
    if (mudou) {
      throw new ConflictException(
        `A ocorrência mudou enquanto você via a lista (agora está ${atual.status}). A lista foi atualizada; confira antes de agir.`,
      );
    }
    if (!origens.some((s) => statusComparavel(s) === atualNorm)) {
      throw new ConflictException(
        reabrindo
          ? `A ocorrência já está ${atual.status}: só é possível reabrir uma ocorrência solucionada.`
          : `A ocorrência já está ${atual.status}.`,
      );
    }
    // Reabrir: o prazo recomeça de agora pelo SLA da categoria (a mesma conta
    // do cadastro). Com o prazo original a ocorrência voltava já "Atrasada".
    const data = reabrindo ? { status, prazo: await this.prazoDaCategoria(atual.tipo ?? null) } : { status };
    const r = await this.prisma.ocorrencias.updateMany({
      where: { id, status: { in: origens }, ...(carimbo ? { updated_at: carimbo } : {}) },
      data,
    });
    if (r.count === 0) {
      throw new ConflictException('A ocorrência mudou enquanto você atendia. Recarregue a lista.');
    }
    const atualizado = await this.prisma.ocorrencias.findUnique({ where: { id } });
    if (!atualizado) throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    await this.notificarAutor(
      id,
      atualizado.user,
      'Ocorrência atualizada',
      reabrindo ? `Sua ocorrência #${id} foi reaberta.` : `Sua ocorrência #${id} agora está: ${status}.`,
    );
    return atualizado;
  }

  async updatePublica(id: number, publica: boolean, user?: JwtPayload) {
    await this.loadParaAdministrar(id, user, 'alterar visibilidade da ocorrência');
    try {
      return await this.prisma.ocorrencias.update({
        where: { id },
        data: { publica },
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
  }

  async updateResposta(id: number, resposta: string, user?: JwtPayload) {
    await this.loadParaAtendimento(id, user, 'responder ocorrência');
    let atualizado;
    try {
      atualizado = await this.prisma.ocorrencias.update({
        where: { id },
        data: {
          resposta,
          resposta_at: new Date(),
        },
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
    await this.notificarAutor(id, atualizado.user, 'Ocorrência respondida', resposta.slice(0, 140));
    return atualizado;
  }

  async remove(id: number, user?: JwtPayload) {
    await this.loadParaAdministrar(id, user, 'remover ocorrência');
    try {
      await this.prisma.ocorrencias.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
  }

  // ----- Superfície do app (POST ocorrencias/update e ocorrencias/remove) -----

  /**
   * Resposta da equipe pelo app: grava a resposta (se houver texto) e o status
   * num update só. Quem pode é o mesmo de `updateResposta`/`updateStatus`/
   * `atribuir` — síndico, ou funcionário com a flag `ocorrencias`, do
   * condomínio da ocorrência (loadParaMutacaoStaff). Morador nunca responde,
   * nem a própria.
   */
  async responderPeloApp(id: number, dados: { resposta?: unknown; status?: unknown }, user?: JwtPayload) {
    const idOc = idValido(id);
    await this.loadParaMutacaoStaff(idOc, user, 'responder ocorrência');
    const status = STATUS_DA_RESPOSTA_APP[String(dados.status ?? '').trim().toLowerCase()];
    if (!status) throw new BadRequestException('Informe o status da ocorrência!');
    const resposta = typeof dados.resposta === 'string' ? dados.resposta.trim() : '';

    let atualizado;
    try {
      atualizado = await this.prisma.ocorrencias.update({
        where: { id: idOc },
        // Sem texto, a resposta anterior fica como estava: só o status muda.
        data: resposta ? { status, resposta, resposta_at: new Date() } : { status },
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${idOc} não encontrada`);
    }
    if (resposta) {
      await this.notificarAutor(idOc, atualizado.user, 'Ocorrência respondida', resposta.slice(0, 140));
    } else {
      await this.notificarAutor(idOc, atualizado.user, 'Ocorrência atualizada', `Sua ocorrência #${idOc} agora está: ${status}.`);
    }
    return atualizado;
  }

  /**
   * Edição pelo autor, pelo app: só quem abriu (Users.id do token) e só
   * enquanto ninguém da equipe deu ciência (Pendente). Síndico e funcionário
   * não reescrevem o relato do morador por aqui — eles respondem.
   *
   * Fotos novas em `docs` SUBSTITUEM os anexos; sem fotos novas, os atuais
   * ficam. Tipo trocado recalcula o prazo (SLA) como no cadastro.
   */
  async editarPeloAutor(
    id: number,
    dados: { descricao?: unknown; tipo?: unknown; publica?: unknown; docs?: unknown },
    user?: JwtPayload,
  ) {
    const idOc = idValido(id);
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id: idOc },
      select: { id_condominio: true, user: true, status: true, tipo: true, resposta_at: true },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${idOc} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${idOc}`);
    if (!this.ehAutor(o, user)) {
      throw new ForbiddenException('Acesso negado: só quem abriu a ocorrência pode editá-la.');
    }
    if (!estaPendente(o.status) || (await this.equipeJaRespondeu(idOc, o))) {
      throw new BadRequestException('Esta ocorrência já está em atendimento e não pode mais ser editada.');
    }
    const descricao = typeof dados.descricao === 'string' ? dados.descricao.trim() : '';
    if (!descricao) throw new BadRequestException('Descrição é obrigatória.');

    const data: Record<string, unknown> = { descricao };
    if (dados.publica !== undefined && dados.publica !== null) {
      data.publica = dados.publica === true || dados.publica === 1 || dados.publica === 'true';
    }
    if (dados.tipo !== undefined && dados.tipo !== null && dados.tipo !== '') {
      const tipo = Number(dados.tipo);
      if (!Number.isInteger(tipo)) throw new BadRequestException('Tipo de ocorrência inválido.');
      if (tipo !== o.tipo) {
        data.tipo = tipo;
        data.prazo = await this.prazoDaCategoria(tipo);
      }
    }
    const anexos = await subirAnexosOcorrencia(this.storage, dados.docs);
    if (anexos) data.anexos = anexos;

    // A checagem de Pendente acima é só para dar a mensagem certa: a garantia
    // é o filtro da própria escrita (autor + Pendente), senão uma ciência da
    // equipe entre o findUnique e o update seria sobrescrita. A coluna é
    // NOT NULL e o MySQL compara sem diferenciar caixa, então 'Pendente' cobre
    // o mesmo que `estaPendente`.
    let r: { count: number };
    try {
      r = await this.prisma.ocorrencias.updateMany({
        where: { id: idOc, user: idUsuarioDoToken(user) as number, status: 'Pendente', ...semRespostaDaEquipe(idUsuarioDoToken(user) as number) },
        data,
      });
    } catch (err: any) {
      this.logger.error(`[ocorrencias.editarPeloAutor] Falha: ${err?.message ?? err}`);
      throw new BadRequestException('Não foi possível salvar a ocorrência. Verifique os dados e tente novamente.');
    }
    if (r.count === 0) {
      throw new BadRequestException('Esta ocorrência já está em atendimento e não pode mais ser editada.');
    }
    return this.prisma.ocorrencias.findUnique({ where: { id: idOc } });
  }

  /**
   * Exclusão pelo app: o autor, enquanto Pendente; ou o síndico do condomínio,
   * pela mesma regra do `remove` do console. Funcionário não exclui pelo app.
   */
  async removerPeloApp(id: number, user?: JwtPayload) {
    const idOc = idValido(id);
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id: idOc },
      select: { id_condominio: true, user: true, status: true, resposta_at: true },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${idOc} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${idOc}`);

    const autor = this.ehAutor(o, user);
    if (autor && estaPendente(o.status) && !(await this.equipeJaRespondeu(idOc, o))) {
      // Exclusão condicionada a autor + Pendente + sem resposta da equipe: se
      // a equipe deu ciência, respondeu ou escreveu no chat no meio do
      // caminho, nada é apagado (a cascata levaria as mensagens dela).
      const r = await this.prisma.ocorrencias.deleteMany({
        where: { id: idOc, user: idUsuarioDoToken(user) as number, status: 'Pendente', ...semRespostaDaEquipe(idUsuarioDoToken(user) as number) },
      });
      if (r.count === 0) {
        throw new BadRequestException('Esta ocorrência já está em atendimento e não pode mais ser excluída.');
      }
      return;
    }
    if (isSindicoEstrito(user)) return this.remove(idOc, user);
    if (autor) {
      throw new BadRequestException('Esta ocorrência já está em atendimento e não pode mais ser excluída.');
    }
    throw new ForbiddenException('Acesso negado: só quem abriu a ocorrência pode excluí-la.');
  }

  /**
   * Atribui a ocorrência a um funcionário (Users.id) e dispara push a ele.
   * idResponsavel = null desatribui.
   */
  async atribuir(id: number, idResponsavel: number | null, user?: JwtPayload) {
    const o = await this.loadParaAtendimento(id, user, 'atribuir ocorrência');
    // O responsável vem do corpo como Users.id global: precisa estar na
    // equipe atribuível DESTE condomínio (a mesma lista que o app e o console
    // mostram). Sem isso, a equipe de um condomínio lia o nome de qualquer
    // usuário do sistema (responsavelNome) e mandava push para ele.
    if (idResponsavel != null) {
      const atribuiveis = await this.listFuncionariosAtribuiveis(o.id_condominio);
      if (!atribuiveis.some((f) => f.id_user === Number(idResponsavel))) {
        throw new BadRequestException('Responsável inválido: escolha um funcionário deste condomínio.');
      }
    }
    let updated;
    try {
      updated = await this.prisma.ocorrencias.update({
        where: { id },
        data: { id_responsavel: idResponsavel },
        include: { categoria: { select: { nome: true } } },
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }

    if (idResponsavel != null) {
      try {
        const resp = await this.prisma.users.findUnique({
          where: { id: idResponsavel },
          select: { fcm_token: true },
        });
        if (resp?.fcm_token) {
          const cat = updated.categoria?.nome ? ` (${updated.categoria.nome})` : '';
          await this.notifications.sendPushNotification(
            resp.fcm_token,
            'Ocorrência atribuída a você',
            `Você é o responsável pela ocorrência #${id}${cat}.`,
            { id: id.toString(), type: 'ocorrencia_atribuida' },
          );
        }
      } catch (e: any) {
        this.logger.error(`[ocorrencias.atribuir] push falhou: ${e?.message ?? e}`);
      }
    }

    return updated;
  }

  async listMessages(idOcorrencia: number, requester?: JwtPayload) {
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id: idOcorrencia },
      select: { id_condominio: true, user: true, publica: true },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${idOcorrencia} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, requester, `ocorrência #${idOcorrencia}`);
    // Só o condomínio era conferido: qualquer morador lia o chat da ocorrência
    // privada do vizinho. Mesma regra do findOne.
    await this.assertPodeVer(o, requester);
    const lista = await this.prisma.ocorrenciaMensagens.findMany({
      where: { id_ocorrencia: idOcorrencia },
      include: INCLUDE_AUTOR_MENSAGEM,
      orderBy: { created_at: 'asc' },
    });
    return lista.map(mensagemParaResposta);
  }

  async createMessage(idOcorrencia: number, idUsuario: number | null, mensagem: string, requester?: JwtPayload) {
    const oc = await this.prisma.ocorrencias.findUnique({
      where: { id: idOcorrencia },
      select: { id_condominio: true, user: true, publica: true },
    });
    if (!oc) throw new NotFoundException(`Ocorrência ${idOcorrencia} não encontrada`);
    await this.tenant.assertEntidade(oc.id_condominio, requester, `ocorrência #${idOcorrencia}`);
    // Escrever no chat é da equipe ou de quem abriu — ocorrência pública se
    // lê, mas a conversa é entre o autor e o condomínio.
    if (!this.ehAutor(oc, requester)) {
      if (!this.ehEquipe(requester)) {
        throw new ForbiddenException('Acesso negado: ocorrência não pertence a você');
      }
      // Falar no chat de ocorrência alheia — pública ou privada — é da equipe
      // com a flag `ocorrencias`: sem ela o funcionário tem o recorte do
      // morador, que lê a pública mas não conversa nela.
      await this.exigirFlagOcorrencias(oc.id_condominio, requester);
    }
    // Autor da mensagem: Users.id ou, para o porteiro do console (sem conta
    // em Users), o Funcionarios_Portaria.id do token — gravar o `sub` dele
    // como Users.id atribuía a mensagem a outra pessoa. Sem nenhum dos dois
    // (token antigo da portaria, sem tipo_sub), recusa.
    const idFuncPortaria = idUsuario ? null : idFuncionarioPortariaDoToken(requester);
    if (!idUsuario && !idFuncPortaria) {
      throw new BadRequestException('Envie a mensagem com um login de síndico, morador ou da portaria.');
    }
    const nomePorteiro = idFuncPortaria ? (requester?.nome ?? '').toString().trim().slice(0, 120) || null : null;
    // "[Suporte Prestare]" no início marca a mensagem que vem do
    // createMessageDoSistema ("[Kabania]" segue reservado: há mensagens antigas
    // da integração removida); ninguém imita o suporte por aqui.
    if (typeof mensagem === 'string' && PREFIXO_RESERVADO.test(mensagem)) {
      mensagem = mensagem.replace(PREFIXO_RESERVADO, '');
      if (!mensagem.trim()) throw new BadRequestException('Mensagem inválida.');
    }
    const msg = await this.prisma.ocorrenciaMensagens.create({
      data: {
        id_ocorrencia: idOcorrencia,
        id_usuario: idUsuario ?? null,
        ...(idFuncPortaria ? { id_funcionario_portaria: idFuncPortaria, nome_autor: nomePorteiro } : {}),
        mensagem,
      },
      include: INCLUDE_AUTOR_MENSAGEM,
    });

    try {
      await this.sendChatNotification(
        idOcorrencia,
        idFuncPortaria
          ? { idFuncionarioPortaria: idFuncPortaria, nome: rotuloPortaria(nomePorteiro) }
          : { idUsuario },
        mensagem,
      );
    } catch (e) {
      console.error('Error sending chat notification:', e);
    }

    return mensagemParaResposta(msg);
  }

  /**
   * Mensagem escrita por um serviço interno — o CRM (suporte da Prestare) —,
   * que não tem token de usuário. NÃO é rota: só o CrmService chama, depois do
   * CrmAdminGuard. A `createMessage` pública segue exigindo autor ou equipe.
   *
   * Não há conta de sistema em Users (`id_usuario` NULL é reservado à
   * mensagem do porteiro do console). Fica o critério que esses serviços já usavam:
   * o síndico do condomínio e, sem síndico, o autor da ocorrência — sem o
   * antigo `1` fixo, que gravava em nome de quem tivesse esse id. A origem
   * vai no início do texto (`[Suporte Prestare] ...`), para o chat não
   * atribuir ao síndico o que veio da Prestare.
   */
  async createMessageDoSistema(params: {
    idOcorrencia: number;
    mensagem: string;
    autorRotulo: string;
    origem: 'crm';
  }) {
    const mensagem = typeof params.mensagem === 'string' ? params.mensagem.trim() : '';
    if (!mensagem) throw new BadRequestException('Escreva a mensagem.');
    const rotulo = (params.autorRotulo ?? '').replace(/[[\]]/g, '').trim().slice(0, 60) || 'Suporte Prestare';

    const oc = await this.prisma.ocorrencias.findUnique({
      where: { id: params.idOcorrencia },
      select: { id_condominio: true, user: true },
    });
    if (!oc) throw new NotFoundException(`Ocorrência ${params.idOcorrencia} não encontrada`);

    const sindico = await this.prisma.users.findFirst({
      where: { is_sindico: 1, sindicosCondominios: { some: { id_condominio: oc.id_condominio } } },
      select: { id: true },
    });
    const idUsuario = sindico?.id ?? oc.user ?? null;
    if (!idUsuario) {
      throw new UnprocessableEntityException(
        'Esta ocorrência não tem síndico nem autor para registrar a mensagem no chat.',
      );
    }

    const msg = await this.prisma.ocorrenciaMensagens.create({
      data: { id_ocorrencia: params.idOcorrencia, id_usuario: idUsuario, mensagem: `[${rotulo}] ${mensagem}` },
      include: INCLUDE_AUTOR_MENSAGEM,
    });
    this.logger.log(`[ocorrencias] mensagem de ${params.origem} na ocorrência #${params.idOcorrencia}`);

    try {
      // Gravada em nome do síndico (ou do autor), mas não escrita por ele.
      await this.sendChatNotification(params.idOcorrencia, { nome: rotulo }, mensagem);
    } catch (e: any) {
      this.logger.error(`[ocorrencias.createMessageDoSistema] push falhou: ${e?.message ?? e}`);
    }

    return mensagemParaResposta(msg);
  }

  /**
   * O push do chat leva o texto da mensagem: o responsável atribuído só o
   * recebe se ainda está na equipe atribuível do condomínio (porteiro ativo,
   * ligado a uma conta) e, na ocorrência privada, se tem a flag `ocorrencias`
   * — a mesma regra que o deixa abrir a ocorrência no app. Sem isso, quem
   * toma 403 ao abrir lia o conteúdo pela notificação. Na dúvida, não envia.
   */
  private async responsavelPodeLer(
    o: { id_condominio: number; publica: boolean },
    idResponsavel: number,
  ): Promise<boolean> {
    try {
      const equipe = await this.listFuncionariosAtribuiveis(o.id_condominio);
      if (!equipe.some((f) => f.id_user === idResponsavel)) return false;
      if (o.publica) return true;
      await this.tenant.assertPermissaoFuncionario(o.id_condominio, 'ocorrencias', {
        sub: idResponsavel,
        nome: '',
        typeAccess: 'Funcionario',
        user: { id: idResponsavel },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Quem é avisado decide-se por QUEM escreveu em relação ao AUTOR, não pelo
   * `is_sindico` do remetente (assim o funcionário que respondia no chat
   * avisava os síndicos e o morador nunca sabia):
   *  - quem escreve não é o autor (equipe ou suporte) → avisa o autor;
   *  - quem escreve é o autor → avisa os síndicos e o responsável atribuído;
   *  - ocorrência sem autor em Users (portaria, CRM, monitor) → avisa os
   *    síndicos e o responsável, como se a equipe fosse o autor (antes não
   *    avisava ninguém).
   * Ninguém recebe push da própria mensagem — nem o porteiro pela conta em
   * Users ligada ao login dele (a que o faz responsável).
   *
   * `remetente`: `idUsuario` é o Users.id de quem escreveu de fato; a
   * mensagem do sistema (CRM) vem só com `nome` — gravada em nome do síndico
   * ou do autor, mas não escrita por eles; o porteiro vem com
   * `idFuncionarioPortaria` e o rótulo "Portaria · <nome>".
   */
  private async sendChatNotification(
    idOcorrencia: number,
    remetente: { idUsuario?: number | null; idFuncionarioPortaria?: number | null; nome?: string },
    mensagem: string,
  ) {
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id: idOcorrencia },
      include: {
        criadoPor: { select: { id: true, name: true, fcm_token: true } },
      },
    });
    if (!o) return;

    const idSender = remetente.idUsuario ?? null;
    const sender = idSender
      ? await this.prisma.users.findUnique({ where: { id: idSender }, select: { name: true, is_sindico: true } })
      : null;
    const senderName = remetente.nome || sender?.name || 'Sistema';
    const remetenteEhAutor = idSender != null && o.user != null && o.user === idSender;
    const dados = { id: idOcorrencia.toString(), type: 'ocorrencia_chat' };

    if (o.user != null && !remetenteEhAutor) {
      if (o.criadoPor?.fcm_token && o.criadoPor.id !== idSender) {
        await this.notifications.sendPushNotification(
          o.criadoPor.fcm_token,
          'Nova mensagem na sua Ocorrência',
          `${senderName}: ${mensagem}`,
          dados,
        );
      }
      return;
    }

    // Contas em Users de quem escreveu: a dele e, para o porteiro, a ligada
    // ao login (mesma ligação de listFuncionariosAtribuiveis).
    const proprios = new Set<number>(idSender != null ? [idSender] : []);
    if (remetente.idFuncionarioPortaria) {
      try {
        const equipe = await this.listFuncionariosAtribuiveis(o.id_condominio);
        for (const f of equipe) {
          if (f.id_funcionario_portaria === remetente.idFuncionarioPortaria && f.id_user != null) proprios.add(f.id_user);
        }
      } catch (e: any) {
        this.logger.error(`[ocorrencias.push] conta do porteiro: ${e?.message ?? e}`);
      }
    }

    const sindicos = await this.prisma.users.findMany({
      where: {
        is_sindico: 1,
        sindicosCondominios: {
          some: { id_condominio: o.id_condominio },
        },
        fcm_token: { not: null },
      },
      select: { id: true, fcm_token: true },
    });
    const tokens = new Set<string>();
    for (const s of sindicos) {
      if (s.fcm_token && !proprios.has(s.id)) tokens.add(s.fcm_token);
    }
    // Responsável é Users.id (a conta do porteiro, ligada pelo login — ver
    // listFuncionariosAtribuiveis); recebe se usa o app, tem token de push e
    // ainda pode ler a ocorrência (responsavelPodeLer).
    if (
      o.id_responsavel &&
      !proprios.has(o.id_responsavel) &&
      (await this.responsavelPodeLer(o, o.id_responsavel))
    ) {
      const resp = await this.prisma.users.findUnique({
        where: { id: o.id_responsavel },
        select: { fcm_token: true },
      });
      if (resp?.fcm_token) tokens.add(resp.fcm_token);
    }
    for (const token of tokens) {
      await this.notifications.sendPushNotification(
        token,
        `Nova mensagem na Ocorrência #${idOcorrencia}`,
        `${senderName}: ${mensagem}`,
        dados,
      );
    }
  }
}
