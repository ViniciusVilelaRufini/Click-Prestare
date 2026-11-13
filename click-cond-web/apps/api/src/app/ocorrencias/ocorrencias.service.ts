import {
  BadRequestException,
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
import { assertOperador, assertStaff, isOperador, isSindicoEstrito } from '../auth/tenant.util';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import { idUsuarioDoToken } from '../auth/usuario-do-token.util';
import { autorOcorrencia } from './autor-ocorrencia.util';
import { subirAnexosOcorrencia } from './anexos-ocorrencia.util';

export type OcorrenciaStatus = 'Pendente' | 'Ciente' | 'Solucionado';

/**
 * Status que a tela de resposta do app envia ('ciente' | 'solucionado') para o
 * vocabulário gravado no banco e lido pela portaria. 'Pendente' não é resposta.
 */
const STATUS_DA_RESPOSTA_APP: Record<string, OcorrenciaStatus> = {
  ciente: 'Ciente',
  solucionado: 'Solucionado',
};

/** Pendente = ninguém da equipe deu ciência ainda (status nulo conta como Pendente). */
function estaPendente(status: string | null | undefined): boolean {
  return (status ?? 'Pendente').trim().toLowerCase() === 'pendente';
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
   * e que o operador é síndico/funcionário. Use antes das mutações
   * administrativas (remoção, visibilidade, resposta pelo app; o atendimento
   * do console usa loadParaAtendimento) — sem isso, um
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
      select: { id_condominio: true, tipo: true, status: true },
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
   *  - conversar: escrever no chat — exige Users.id, que o porteiro do
   *    console não tem (OcorrenciaMensagens.id_usuario é FK para Users).
   */
  async acesso(idCondominio: number, user?: JwtPayload) {
    const operar = isOperador(user) && !(await this.semFlagOcorrencias(idCondominio, user));
    return {
      operar,
      administrar: operar && isSindicoEstrito(user),
      conversar: operar && idUsuarioDoToken(user) != null,
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
      criadoPorNome: autorOcorrencia(o.criadoPor?.name, o.categoria?.nome),
      created_at: o.created_at,
      publica: o.publica,
    }));
  }

  async findOne(id: number, requester?: JwtPayload) {
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id },
      include: {
        categoria: { select: { nome: true, sla_horas: true } },
        criadoPor: { select: { name: true } },
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
      criadoPorNome: autorOcorrencia(o.criadoPor?.name, o.categoria?.nome),
    };
  }

  async create(dto: CreateOcorrenciaDto) {
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

  /** SLA: prazo = agora + sla_horas da categoria; sem categoria ou sem SLA, nulo. */
  private async prazoDaCategoria(tipo: number | null): Promise<Date | null> {
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

  async updateStatus(id: number, status: OcorrenciaStatus, user?: JwtPayload) {
    const atual = await this.loadParaAtendimento(id, user, 'alterar status da ocorrência');
    // Reabrir: o prazo recomeça de agora pelo SLA da categoria (a mesma conta
    // do cadastro). Com o prazo original a ocorrência voltava já "Atrasada".
    const reabrindo = status === 'Pendente' && (atual.status ?? '').trim().toLowerCase() === 'solucionado';
    const data = reabrindo ? { status, prazo: await this.prazoDaCategoria(atual.tipo ?? null) } : { status };
    let atualizado;
    try {
      atualizado = await this.prisma.ocorrencias.update({
        where: { id },
        data,
      });
    } catch {
      throw new NotFoundException(`Ocorrência ${id} não encontrada`);
    }
    await this.notificarAutor(id, atualizado.user, 'Ocorrência atualizada', `Sua ocorrência #${id} agora está: ${status}.`);
    return atualizado;
  }

  async updatePublica(id: number, publica: boolean, user?: JwtPayload) {
    await this.loadParaMutacaoStaff(id, user, 'alterar visibilidade da ocorrência');
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
    await this.loadParaMutacaoStaff(id, user, 'remover ocorrência');
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
      select: { id_condominio: true, user: true, status: true, tipo: true },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${idOc} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${idOc}`);
    if (!this.ehAutor(o, user)) {
      throw new ForbiddenException('Acesso negado: só quem abriu a ocorrência pode editá-la.');
    }
    if (!estaPendente(o.status)) {
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
        where: { id: idOc, user: idUsuarioDoToken(user) as number, status: 'Pendente' },
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
      select: { id_condominio: true, user: true, status: true },
    });
    if (!o) throw new NotFoundException(`Ocorrência ${idOc} não encontrada`);
    await this.tenant.assertEntidade(o.id_condominio, user, `ocorrência #${idOc}`);

    const autor = this.ehAutor(o, user);
    if (autor && estaPendente(o.status)) {
      // Exclusão condicionada a autor + Pendente: se a equipe deu ciência no
      // meio do caminho, nada é apagado.
      const r = await this.prisma.ocorrencias.deleteMany({
        where: { id: idOc, user: idUsuarioDoToken(user) as number, status: 'Pendente' },
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
    return this.prisma.ocorrenciaMensagens.findMany({
      where: { id_ocorrencia: idOcorrencia },
      include: {
        usuario: { select: { id: true, name: true, login_type: true, is_sindico: true } },
      },
      orderBy: { created_at: 'asc' },
    });
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
    // Autor da mensagem é FK para Users. O token da portaria-web não tem
    // Users.id — gravar o `sub` dele atribuía a mensagem a outra pessoa.
    if (!idUsuario) {
      throw new BadRequestException('Envie a mensagem com um login de síndico ou morador.');
    }
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
        id_usuario: idUsuario,
        mensagem,
      },
      include: {
        usuario: { select: { id: true, name: true, login_type: true, is_sindico: true } },
      },
    });

    try {
      await this.sendChatNotification(idOcorrencia, idUsuario, mensagem);
    } catch (e) {
      console.error('Error sending chat notification:', e);
    }

    return msg;
  }

  /**
   * Mensagem escrita por um serviço interno — o CRM (suporte da Prestare) —,
   * que não tem token de usuário. NÃO é rota: só o CrmService chama, depois do
   * CrmAdminGuard. A `createMessage` pública segue exigindo autor ou equipe.
   *
   * `OcorrenciaMensagens.id_usuario` é FK obrigatória para Users e não há
   * conta de sistema no banco. Fica o critério que esses serviços já usavam:
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
      include: {
        usuario: { select: { id: true, name: true, login_type: true, is_sindico: true } },
      },
    });
    this.logger.log(`[ocorrencias] mensagem de ${params.origem} na ocorrência #${params.idOcorrencia}`);

    try {
      await this.sendChatNotification(params.idOcorrencia, idUsuario, mensagem, rotulo);
    } catch (e: any) {
      this.logger.error(`[ocorrencias.createMessageDoSistema] push falhou: ${e?.message ?? e}`);
    }

    return msg;
  }

  private async sendChatNotification(
    idOcorrencia: number,
    idUsuarioSender: number,
    mensagem: string,
    nomeRemetente?: string,
  ) {
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id: idOcorrencia },
      include: {
        criadoPor: { select: { id: true, name: true, fcm_token: true } },
      },
    });
    if (!o) return;

    const sender = await this.prisma.users.findUnique({
      where: { id: idUsuarioSender },
      select: { name: true, is_sindico: true },
    });
    const senderName = nomeRemetente || sender?.name || 'Sistema';

    if (sender?.is_sindico === 1) {
      if (o.criadoPor?.fcm_token) {
        await this.notifications.sendPushNotification(
          o.criadoPor.fcm_token,
          'Nova mensagem na sua Ocorrência',
          `${senderName}: ${mensagem}`,
          { id: idOcorrencia.toString(), type: 'ocorrencia_chat' },
        );
      }
    } else {
      const sindicos = await this.prisma.users.findMany({
        where: {
          is_sindico: 1,
          sindicosCondominios: {
            some: { id_condominio: o.id_condominio },
          },
          fcm_token: { not: null },
        },
        select: { fcm_token: true },
      });

      for (const s of sindicos) {
        if (s.fcm_token) {
          await this.notifications.sendPushNotification(
            s.fcm_token,
            `Nova mensagem na Ocorrência #${idOcorrencia}`,
            `${senderName}: ${mensagem}`,
            { id: idOcorrencia.toString(), type: 'ocorrencia_chat' },
          );
        }
      }
    }
  }
}