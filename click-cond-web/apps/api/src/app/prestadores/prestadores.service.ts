import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type Gravados, StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { assertEmailNaoReservado, DOMINIO_CONTA_REVOGADA } from '../common/email-reservado.util';
import { assertOperador, assertSindicoEstrito, isOperador, isSindicoEstrito } from '../auth/tenant.util';
import { momentoTrocaSenha } from '../auth/senha-alterada.util';
import { contaSoDaEquipeDoCondominio } from '../auth/conta-so-de-equipe.util';
import { assertApartamentoGravavel } from '../common/apartamento-gravavel.util';

export interface CreatePrestadorDto {
  nome: string;
  telefone?: string;
  email?: string | null;
  senha?: string | null;
  hasPortariaAccess?: boolean;
  categorias?: string;
  id_condominio: number;
  id_apartamento?: number;
  foto_pessoa?: string | null;
  foto_documento?: string | null;
  dias_semana?: string;
}

/** Turno 'Síndico' (com ou sem acento, qualquer caixa): é o login de portaria do síndico, nunca de um prestador. */
function ehTurnoSindico(turno: string | null | undefined): boolean {
  return (turno ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'sindico';
}

/**
 * Unidade do prestador. Sem unidade (null) = funcionário/prestador do
 * condomínio, visível para todos os moradores. O console manda 0 quando
 * nenhuma unidade é escolhida; `undefined` = campo não enviado (update não mexe).
 */
export function normalizarIdApartamento(v: number | string | null | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return v === null || v === '' || !Number.isFinite(n) || n <= 0 ? null : n;
}

@Injectable()
export class PrestadoresService {
  private readonly logger = new Logger(PrestadoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly facial: FacialService,
    private readonly tenant: TenantAccessService,
  ) {}

  /** Empurra (ou remove) o rosto do prestador nos terminais faciais, sem bloquear a resposta. */
  private fireFacialSync(idPrestador: number) {
    this.facial
      .syncPrestadorServico(idPrestador)
      .catch((err) =>
        this.logger.warn(
          `Sync facial prestador ${idPrestador} falhou: ${err?.message ?? err}`,
        ),
      );
  }

  /**
   * `gravados`: fotos que o cadastro já tem. URL do bucket fora disso é
   * recusada — a API assina toda URL do bucket que devolve
   * (StorageService.exigirArquivoDoRegistro).
   */
  private async resolveFoto(value: string | undefined | null, gravados: Gravados): Promise<string | null> {
    if (!value) return value ?? null;
    if (this.storage.isDataUrl(value)) {
      return (await this.storage.uploadDataUrl(value, 'prestadores')) ?? null;
    }
    await this.storage.exigirArquivoDoRegistro(value, gravados);
    return value;
  }

  /**
   * Recorte de LEITURA da lista para morador: diretório do prédio
   * (`id_apartamento` nulo) + os prestadores dos apartamentos dele.
   *
   * Para portaria/síndico devolve `{}` — enxergam tudo, como hoje.
   */
  private async escopoDeLeitura(idCondominio: number, payload?: JwtPayload) {
    if (!payload) return {};

    const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
    const ehMoradorMobile = !payload.id_condominio && tipo !== 'sindico' && tipo !== 'funcionario';
    if (!ehMoradorMobile) return {};

    const userId = Number(payload.user?.id ?? payload.sub);
    if (!userId) return { id_apartamento: null };

    const vinculos = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: userId, apartamento: { id_condominio: Number(idCondominio) } },
      select: { id_apto: true },
    });
    const meusAptos = [...new Set(vinculos.map((v) => v.id_apto))];
    if (meusAptos.length === 0) return { id_apartamento: null };

    return { OR: [{ id_apartamento: null }, { id_apartamento: { in: meusAptos } }] };
  }

  /** Versão por id do `escopoDeLeitura` — usada no findOne. */
  private async assertPodeLerPrestador(
    prestador: { id_apartamento: number | null },
    payload?: JwtPayload,
  ) {
    if (!payload) return;

    const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
    const ehMoradorMobile = !payload.id_condominio && tipo !== 'sindico' && tipo !== 'funcionario';
    if (!ehMoradorMobile) return;

    // Prestador do prédio é do diretório: todo mundo vê.
    if (!prestador.id_apartamento) return;

    const userId = Number(payload.user?.id ?? payload.sub);
    if (!userId) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');

    const vinculo = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: userId, id_apto: prestador.id_apartamento },
      select: { id_apto: true },
    });
    if (!vinculo) {
      throw new ForbiddenException(
        'Acesso negado: este prestador não pertence a um apartamento seu.',
      );
    }
  }

  /**
   * Quem pode ALTERAR este prestador.
   *
   * O tenant sozinho não separa nada aqui: morador pertence ao condomínio, e
   * as rotas do app (`/prestadores/update` e `/prestadores/remove`) só
   * conferiam isso. Na prática, qualquer morador editava ou apagava o
   * prestador cadastrado pelo vizinho — e também o eletricista do prédio,
   * que é cadastro da administração.
   *
   * A regra espelha a de visitantes (`assertPodeAcessarVisitante`): morador
   * mobile só mexe no que está vinculado a um apartamento dele. Prestador do
   * condomínio (`id_apartamento` nulo) é da portaria/síndico.
   */
  private async assertPodeGerenciarPrestador(
    prestador: { id: number; id_apartamento: number | null },
    payload?: JwtPayload,
  ) {
    if (!payload) return;

    const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
    // Porteiro/console tem id_condominio no token; síndico é reconhecido pelo
    // typeAccess. Os dois já passaram pelo assertEntidade de tenant.
    const ehMoradorMobile = !payload.id_condominio && tipo !== 'sindico' && tipo !== 'funcionario';
    if (!ehMoradorMobile) return;

    if (!prestador.id_apartamento) {
      throw new ForbiddenException(
        'Acesso negado: este prestador é do condomínio e só a administração pode alterá-lo.',
      );
    }

    const userId = Number(payload.user?.id ?? payload.sub);
    if (!userId) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');

    const vinculo = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: userId, id_apto: prestador.id_apartamento },
      select: { id_apto: true },
    });
    if (!vinculo) {
      throw new ForbiddenException(
        'Acesso negado: este prestador não pertence a um apartamento seu.',
      );
    }
  }

  async findAll(idCondominio: number, search?: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) {
      const mocks = [
        { id: 601, nome: 'Eletricista 24h - João da Silva', telefone: '(11) 95555-4444', categorias: 'Elétrica, Instalações', id_condominio: Number(idCondominio), created_at: new Date(), updated_at: new Date() },
        { id: 602, nome: 'Desentupidora e Encanador Rápido', telefone: '(11) 94444-3333', categorias: 'Hidráulica, Esgoto', id_condominio: Number(idCondominio), created_at: new Date(), updated_at: new Date() },
        { id: 603, nome: 'Refrigeração Ar Condicionado (Marcos)', telefone: '(11) 93333-2222', categorias: 'Climatização, Limpeza', id_condominio: Number(idCondominio), created_at: new Date(), updated_at: new Date() },
      ];

      if (search) {
        const s = search.toLowerCase();
        return mocks.filter((p) => p.nome.toLowerCase().includes(s) || (p.categorias && p.categorias.toLowerCase().includes(s)));
      }
      return mocks;
    }

    // Morador enxerga o DIRETÓRIO do prédio (prestador sem apartamento — o
    // eletricista, o jardineiro) mais os prestadores dos apartamentos dele.
    // Não os dos vizinhos: quando um morador cadastra o próprio prestador, o
    // app grava o apartamento dele no registro, e a lista devolvia isso para o
    // condomínio inteiro — nome, telefone, foto e a unidade a que atende.
    // Mesmo recorte que já vale para editar/apagar, e o mesmo princípio do
    // findAllMobile de visitantes.
    const escopoMorador = await this.escopoDeLeitura(Number(idCondominio), user);

    // Escopo e busca vão dentro de AND: os dois usam `OR`, e espalhados no
    // mesmo objeto um sobrescreveria o outro — a busca apagaria o recorte de
    // privacidade e devolveria os prestadores dos vizinhos de novo.
    const filtros: any[] = [];
    // `{}` (staff, sem recorte) é truthy — sem olhar as chaves, entraria um
    // filtro vazio no AND.
    if (Object.keys(escopoMorador).length > 0) filtros.push(escopoMorador);
    if (search) {
      filtros.push({
        OR: [
          { nome: { contains: search } },
          { telefone: { contains: search } },
          { categorias: { contains: search } },
        ],
      });
    }

    const prestadores = await this.prisma.prestadores_servico.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(filtros.length ? { AND: filtros } : {}),
      },
      include: { apartamento: { select: { bloco: true, apto: true } } },
      orderBy: { nome: 'asc' },
    });

    const portariaLogins = await this.prisma.funcionarios_Portaria.findMany({
      where: { id_condominio: Number(idCondominio) },
      select: { login: true, ativo: true, turno: true },
    });
    const chave = (login: string) => login.toLowerCase().trim();
    const loginSet = new Set(portariaLogins.filter((f) => f.ativo === 1).map((f) => chave(f.login)));
    // Login que o próprio cadastro recebeu (ativo ou não, qualquer turno menos 'Síndico') — o mesmo critério de
    // loginPortariaDoPrestador, que decide quando remover/revogar exige síndico. Campo novo na resposta.
    const loginProprioSet = new Set(portariaLogins.filter((f) => !ehTurnoSindico(f.turno)).map((f) => chave(f.login)));

    // Morador (resposta recortada): sem foto do documento nem biometria, que
    // são da portaria. Quem recebe `{}` de escopo é staff e vê tudo.
    const recortar = !!user && !isOperador(user);
    return prestadores.map((p) => {
      const {
        foto_documento: _fd,
        face_id: _fi,
        face_enrolled_at: _fe,
        face_sync_status: _fs,
        face_sync_error: _fx,
        ...publico
      } = p;
      return {
        ...(recortar ? publico : p),
        hasPortariaAccess: p.email ? loginSet.has(chave(p.email)) : false,
        loginPortariaProprio: p.email ? loginProprioSet.has(chave(p.email)) : false,
      };
    });
  }

  async findOne(id: number, idCondominio?: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      return { id, nome: 'Prestador Exemplo', telefone: '(11) 99999-9999', categorias: 'Geral', id_condominio: 1, hasPortariaAccess: false };
    }

    const p = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      include: { apartamento: { select: { bloco: true, apto: true } } },
    });
    if (!p) throw new NotFoundException(`Prestador ${id} não encontrado`);
    // TenantAccessService cobre tanto o caso web (idCondominio da URL, no
    // JWT) quanto o mobile (token sem id_condominio, resolve via banco) —
    // sem isso, o app conseguia ler/editar/apagar prestador de outro condomínio.
    await this.tenant.assertEntidade(p.id_condominio, user, `prestador #${id}`);
    // E o mesmo recorte da lista, por id: sem isto, tirar o prestador do
    // vizinho da listagem não adiantaria nada — bastaria pedir pelo id.
    // Prestador do prédio (sem apartamento) segue visível para todos.
    await this.assertPodeLerPrestador(p, user);

    const hasPortariaAccess = p.email
      ? await this.prisma.funcionarios_Portaria.findFirst({
          where: { login: p.email, id_condominio: p.id_condominio, ativo: 1 },
          select: { id: true },
        }).then((res) => !!res)
      : false;

    const { foto_documento: _fd, face_id: _fi, face_enrolled_at: _fe, face_sync_status: _fs, face_sync_error: _fx, ...publico } = p;
    return { ...(user && !isOperador(user) ? publico : p), hasPortariaAccess };
  }

  /**
   * Dar acesso à portaria cria/liga uma conta de login. O e-mail NÃO pode ser de uma conta
   * já existente que não seja da equipe deste condomínio: antes o fluxo sobrescrevia a senha
   * do Users dessa pessoa (de qualquer condomínio) e dava ao chamador a conta dela.
   */
  private async assertContaLivreParaPortaria(email: string, idCondominio: number) {
    const existente = await this.contaDoLogin(email, idCondominio);
    if (!existente) return;
    const daEquipe = await this.prisma.funcionarios.findFirst({
      where: { id_user: existente.id, id_condominio: Number(idCondominio) },
      select: { id: true },
    });
    // Conta existente só é aceita se JÁ é da equipe deste condomínio. Conta "órfã" (revogada em outro prédio, de
    // signup público, de morador ou síndico) nunca: nada a liga a este condomínio além do e-mail que quem concede
    // digitou, e o fallback do app adotaria a senha da portaria assim que existisse o vínculo. A reconcessão no
    // mesmo prédio funciona porque a revogação libera o e-mail da conta que era só daqui (revogarLoginDoPrestador).
    if (!daEquipe) {
      throw new BadRequestException('Este e-mail já pertence a outra conta do sistema. Use outro e-mail para o acesso à portaria.');
    }
  }

  /**
   * Valor-lápide de login/e-mail para uma conta revogada que era só da equipe deste condomínio. Inalcançável: o
   * domínio `.invalid` é reservado (RFC 2606) e nenhum cadastro o aceita (common/email-reservado.util). Com sufixo
   * aleatório: a versão só com o id era previsível (o login do app devolve o id) e o prestador ocupava a lápide de
   * antemão pelo signup, travando a própria revogação. ~70 caracteres, dentro do VarChar(255) das duas colunas.
   * Método (não função solta) para o spec simular uma lápide já ocupada.
   */
  protected novaLapide(idUser: number): string {
    return `revogado-${idUser}-${randomBytes(16).toString('hex')}@${DOMINIO_CONTA_REVOGADA}`;
  }

  /**
   * Hash inutilizável: não começa com `$2` (não é bcrypt) e tem caracteres fora do hexadecimal, então nunca
   * coincide com o md5 que o verifyPassword do app compara para senhas legadas.
   */
  private static senhaInutilizavel(idUser: number) {
    return `!revogado:${idUser}`;
  }

  /**
   * A conta do app ligada a um login de portaria. Users.login e Users.email são únicos cada um, então "login OU
   * e-mail" pode achar duas contas: vale a que é da equipe deste condomínio e, sem ela, a mais antiga — antes era
   * a que o banco devolvesse primeiro, e a revogação podia cair na conta errada.
   */
  private async contaDoLogin(login: string, idCondominio: number, db: any = this.prisma) {
    const porLogin = { OR: [{ login }, { email: login }] };
    return (
      (await db.users.findFirst({
        where: { ...porLogin, funcionarios: { some: { id_condominio: Number(idCondominio) } } },
        orderBy: { id: 'asc' },
      })) ?? (await db.users.findFirst({ where: porLogin, orderBy: { id: 'asc' } }))
    );
  }

  /**
   * A conta não tem papel nenhum além de equipe deste condomínio: nenhum perfil ou vínculo de síndico, nenhum
   * cadastro de morador ou unidade e nenhuma equipe em outro prédio. O critério do app
   * (auth/conta-so-de-equipe.util), com as flags como trava extra.
   */
  private async contaSoDeEquipe(
    conta: { id: number; is_sindico?: number | null; is_morador?: number | null },
    idCondominio: number,
    db: any = this.prisma,
  ): Promise<boolean> {
    if (conta.is_sindico || conta.is_morador) return false;
    return contaSoDaEquipeDoCondominio(db, conta.id, idCondominio);
  }

  /**
   * A conta já é da equipe deste condomínio E exclusivamente dela: só então quem gerencia a equipe daqui
   * administra a conta inteira (lápide na revogação, senha nova no re-credenciamento). É a regra que o app aplica
   * ao adotar a senha da portaria (mobile-auth, loginFuncionario).
   */
  private async contaSoDestaEquipe(conta: { id: number; is_sindico?: number | null; is_morador?: number | null }, idCondominio: number, db: any = this.prisma) {
    const daqui = await db.funcionarios.findFirst({
      where: { id_user: conta.id, id_condominio: Number(idCondominio) },
      select: { id: true },
    });
    return { daqui: !!daqui, soDaqui: !!daqui && (await this.contaSoDeEquipe(conta, idCondominio, db)) };
  }

  /**
   * Conta existente que recebe o acesso (já é da equipe daqui: assertContaLivreParaPortaria). Com senha nova e
   * conta exclusivamente desta equipe, a senha do app passa a ser a nova e os tokens caem — sem isto, re-credenciar
   * por senha vazada mudava só o login de portaria e a senha antiga seguia entrando no app. Conta compartilhada
   * (ou de qualquer outro jeito) não tem nada tocado além da flag.
   */
  private async ligarContaDaEquipe(conta: { id: number; is_sindico?: number | null; is_morador?: number | null }, hash: string | undefined, idCondominio: number) {
    const { soDaqui } = hash ? await this.contaSoDestaEquipe(conta, idCondominio) : { soDaqui: false };
    await this.prisma.users.update({
      where: { id: conta.id },
      data: soDaqui
        ? { is_funcionario: 1, password: hash, senha_alterada_em: momentoTrocaSenha() }
        : { is_funcionario: 1 },
    });
  }

  /**
   * Inutiliza, dentro da transação da revogação, a conta que era só desta equipe: lápide em login e e-mail, CPF
   * liberado (coluna @unique anulável), senha inutilizável e senha_alterada_em. A lápide nunca derruba a revogação:
   * já ocupada (de antemão ou por corrida no @unique), tenta outra; depois de 3, segue sem ela — a conta fica com
   * o e-mail ocupado, mas sem senha que entre e sem tokens.
   */
  private async inutilizarConta(tx: any, idUser: number) {
    const base = {
      password: PrestadoresService.senhaInutilizavel(idUser),
      senha_alterada_em: momentoTrocaSenha(),
      cpf: null,
    };
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const lapide = this.novaLapide(idUser);
      const ocupada = await tx.users.findFirst({
        where: { OR: [{ login: lapide }, { email: lapide }], NOT: { id: idUser } },
        select: { id: true },
      });
      if (ocupada) continue;
      try {
        await tx.users.update({ where: { id: idUser }, data: { ...base, login: lapide, email: lapide } });
        return;
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
      }
    }
    this.logger.warn(`Lápide indisponível para a conta ${idUser}: revogada sem liberar o e-mail.`);
    await tx.users.update({ where: { id: idUser }, data: base });
  }

  /**
   * O e-mail do prestador é a chave do login de portaria dele (não há FK). Por isso ele nunca pode passar a
   * ser um login de portaria que já existe e não é o dele — com ou sem acesso pedido. `idLoginProprio`: o
   * login que já pertence a este prestador (loginPortariaDoPrestador), que não conta como colisão.
   * Também não pode ser o `email` de outro login de portaria deste condomínio: re-credenciar pelo e-mail
   * trocaria a senha de um colega (o app acha o login por login OU e-mail).
   */
  private async assertEmailLivreNaPortaria(email: string | null | undefined, idCondominio: number, idLoginProprio?: number) {
    const login = (email ?? '').trim();
    if (!login) return;
    // login é único no banco inteiro: uma linha no máximo, comparada pelo id aqui.
    const existente = await this.prisma.funcionarios_Portaria.findFirst({ where: { login }, select: { id: true } });
    if (existente && existente.id !== idLoginProprio) {
      throw new BadRequestException('Já existe um funcionário com este e-mail.');
    }
    const colega = await this.prisma.funcionarios_Portaria.findFirst({
      where: {
        email: login,
        id_condominio: Number(idCondominio),
        ...(idLoginProprio ? { NOT: { id: idLoginProprio } } : {}),
      },
      select: { id: true },
    });
    if (colega && colega.id !== idLoginProprio) {
      throw new BadRequestException('Já existe um funcionário com este e-mail.');
    }
  }

  /**
   * Login de portaria que ESTE prestador recebeu: login = e-mail gravado nele e mesmo condomínio. O acesso nasce
   * com turno 'Geral', mas o síndico pode mudar o turno pelo app (saveFuncionario) — exigir 'Geral' travava o
   * cadastro: toda edição achava o próprio login como de outra pessoa e desligar a chave não revogava nada.
   * O login de outra pessoa não chega aqui: o prestador não grava como e-mail um login existente
   * (assertEmailLivreNaPortaria) e o app não cria nem renomeia login para o e-mail de um prestador daqui. A linha
   * com turno 'Síndico' (o login de portaria do próprio síndico) nunca é tratada como do prestador.
   */
  private async loginPortariaDoPrestador(p: { email: string | null; id_condominio: number }) {
    const login = (p.email ?? '').trim();
    if (!login) return null;
    const fp = await this.prisma.funcionarios_Portaria.findFirst({
      where: { login, id_condominio: p.id_condominio },
    });
    return fp && !ehTurnoSindico(fp.turno) ? fp : null;
  }

  /**
   * Tira de fato o acesso que o cadastro de prestador concedeu. Apagar só o Funcionarios_Portaria deixava a conta
   * do app e o vínculo Funcionarios criados na concessão: a pessoa seguia entrando no app como Funcionário e voltava
   * ao console pelo QR Code. Aqui sai também o vínculo de equipe DESTE condomínio (o JwtStrategy e o tenant do app
   * conferem por ele) e senha_alterada_em derruba os tokens já emitidos para a conta.
   *
   * A conta Users NUNCA é apagada: o mesmo e-mail pode ser de um síndico ou morador e a exclusão cascatearia.
   * O removeFuncionario do app apaga a conta quando ela é só da equipe do condomínio — é isso que libera o e-mail
   * para um cadastro novo. Aqui o equivalente sem apagar a linha: a conta que era EXCLUSIVAMENTE da equipe deste
   * condomínio (conferido ANTES de tirar o vínculo — é a prova de origem) tem login e e-mail trocados por uma
   * lápide e a senha inutilizada. Ela não autentica mais, e religar a chave cai no caminho normal de "e-mail livre
   * → conta nova". Conta compartilhada (síndico, morador, equipe de outro prédio) perde só o vínculo daqui e os
   * tokens; religar o acesso para ela continua recusado (assertContaLivreParaPortaria).
   * Tudo numa transação: sem ela, uma falha no meio (a lápide batendo no @unique) deixava o vínculo apagado, o
   * login de portaria de pé e sem senha_alterada_em — e o fallback do app recriava o vínculo. A conta é relida e
   * a checagem "exclusivamente desta equipe" refeita dentro da transação.
   *
   * `noMesmoAto`: gravações que precisam cair junto com a revogação (troca de e-mail: o prestador com o e-mail
   * novo e o login de portaria com login, e-mail e senha novos). Antes eram gravadas depois, fora da transação: se
   * o prestador falhasse, a conta antiga já tinha saído e o login seguia com o e-mail e a senha ANTIGOS.
   * Devolve o vínculo de equipe tirado da conta (para a conta nova herdar as permissões) e o que `noMesmoAto` devolveu.
   */
  private async revogarLoginDoPrestador<T = undefined>(
    login: { id: number; login: string; id_condominio: number },
    idPrestador: number,
    opcoes: { manterLogin?: boolean; noMesmoAto?: (tx: any) => Promise<T>; mensagemErro?: string } = {},
  ): Promise<{ vinculoRemovido: Record<string, any> | null; resultado?: T }> {
    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const conta = await this.contaDoLogin(login.login, login.id_condominio, tx);
        // contaDoLogin cai na conta mais antiga com aquele login/e-mail quando nenhuma é da equipe daqui: essa não
        // é nossa, e nunca recebe lápide nem perde os tokens.
        const { daqui, soDaqui } = conta
          ? await this.contaSoDestaEquipe(conta, login.id_condominio, tx)
          : { daqui: false, soDaqui: false };
        let vinculoRemovido: Record<string, any> | null = null;
        if (conta && daqui) {
          vinculoRemovido = await tx.funcionarios.findFirst({ where: { id_user: conta.id, id_condominio: login.id_condominio } });
          await tx.funcionarios.deleteMany({ where: { id_user: conta.id, id_condominio: login.id_condominio } });
          if (soDaqui) await this.inutilizarConta(tx, conta.id);
          else await tx.users.update({ where: { id: conta.id }, data: { senha_alterada_em: momentoTrocaSenha() } });
        }
        // manterLogin: troca de e-mail — só a conta antiga sai; o login de portaria acompanha o e-mail novo.
        if (!opcoes.manterLogin) await tx.funcionarios_Portaria.deleteMany({ where: { id: login.id } });
        const resultado = opcoes.noMesmoAto ? await opcoes.noMesmoAto(tx) : undefined;
        return { vinculoRemovido, resultado };
      });
    } catch (err: any) {
      this.logger.error(`Falha ao revogar o acesso à portaria do prestador ${idPrestador}: ${err?.message ?? err}`);
      throw new BadRequestException(opcoes.mensagemErro ?? 'Não foi possível revogar o acesso à portaria. Tente novamente.');
    }
  }

  /**
   * Permissões do vínculo de equipe criado na concessão. Na troca de e-mail com a chave, a conta nova herda as do
   * vínculo que a conta antiga tinha (o síndico pode tê-las restringido no app); sem ele, todas ligadas, como sempre.
   */
  private static permissoesDoVinculo(herdado?: Record<string, any> | null) {
    const flag = (k: string) => (herdado && herdado[k] != null ? Number(herdado[k]) : 1);
    return {
      funcao: herdado?.funcao ?? 'Porteiro',
      ch: herdado?.ch ?? 'Geral',
      areas_sociais: flag('areas_sociais'),
      comunicados: flag('comunicados'),
      ocorrencias: flag('ocorrencias'),
      manutencoes_programadas: flag('manutencoes_programadas'),
      prestadores_servico: flag('prestadores_servico'),
      agendar_mudanca: flag('agendar_mudanca'),
      cadastrar_visitante: flag('cadastrar_visitante'),
      apartamentos: flag('apartamentos'),
    };
  }

  async create(dto: CreatePrestadorDto, user?: JwtPayload) {
    // Interface, não DTO: um objeto no e-mail estourava em .trim() e virava erro 500 em vez de 400.
    if (dto.email != null && typeof dto.email !== 'string') throw new BadRequestException('E-mail inválido.');
    // O e-mail do prestador vira login e conta do app: nunca no domínio das lápides da revogação.
    assertEmailNaoReservado(dto.email);
    // E-mail só com espaços = sem e-mail: nunca vira login de portaria ''.
    if (typeof dto.email === 'string' && dto.email.trim() === '') dto = { ...dto, email: null };
    await this.tenant.assertCondominio(dto.id_condominio, user);
    await this.tenant.assertPermissaoFuncionario(dto.id_condominio, 'prestadores_servico', user);
    // Conceder login de portaria é do síndico, como no app (mobile-auth: gerenciar funcionários). Pelo papel do
    // token, não pelo `turno`, que é texto livre do cadastro do porteiro.
    if (dto.hasPortariaAccess) assertSindicoEstrito(user, 'conceder acesso à portaria a um prestador');
    // Sem senha padrão: '123456' era a senha do login de portaria (e da conta do app) do prestador.
    if (dto.hasPortariaAccess && dto.email && !(typeof dto.senha === 'string' && dto.senha.trim() !== '')) {
      throw new BadRequestException('Informe uma senha para o acesso à portaria.');
    }
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        nome: dto.nome,
        telefone: dto.telefone ?? null,
        email: dto.email ?? null,
        categorias: dto.categorias ?? null,
        id_condominio: dto.id_condominio,
        foto_pessoa: dto.foto_pessoa ?? null,
        foto_documento: dto.foto_documento ?? null,
        dias_semana: dto.dias_semana ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    if (dto.email && dto.hasPortariaAccess) {
      // Com acesso pedido nem o login do próprio cadastro vale: o create abaixo criaria um login duplicado.
      await this.assertEmailLivreNaPortaria(dto.email, dto.id_condominio);
      await this.assertContaLivreParaPortaria(dto.email.trim(), dto.id_condominio);
    }

    const existing = await this.prisma.prestadores_servico.findFirst({
      where: {
        id_condominio: Number(dto.id_condominio),
        nome: dto.nome.trim(),
      },
    });
    // Mesmo nome = ATUALIZAÇÃO do cadastro existente (foto facial, unidade,
    // dias). Vale a mesma regra do update: sem isto, um morador repetia o nome
    // do eletricista do prédio — que todo morador vê na lista — ou do
    // prestador do vizinho e trocava a foto que o terminal facial reconhece.
    // Antes do upload, para a foto recusada nem chegar ao storage.
    if (existing) await this.assertPodeGerenciarPrestador(existing, user);

    // Mesmo nome de quem tem login de portaria: o e-mail do cadastro É o login (não há FK). O console manda
    // email '' no "Novo", e o upsert gravava null sem checar alçada — login, conta e vínculo ficavam vivos, a lista
    // mostrava "sem acesso" e o síndico perdia o caminho para revogar. Quem não é síndico não mexe nesse e-mail
    // (os demais campos seguem como sempre). O upsert NUNCA revoga: e-mail vazio/ausente preserva o e-mail e o
    // acesso também para o síndico — a tela nem mostra o campo com a chave desligada, e revogar por acidente ao
    // recadastrar um nome é armadilha. Revogar é só pelo caminho explícito (update com a chave desligada, remover).
    // O síndico com e-mail NÃO vazio segue a regra do update: desliga a conta antiga e leva o login (ou, com a
    // chave, concede de novo para o e-mail novo).
    const loginDoExistente = existing ? await this.loginPortariaDoPrestador(existing) : null;
    let revogarExistente: 'tudo' | 'conta' | null = null;
    if (loginDoExistente && dto.email !== undefined) {
      const emailNovo = (dto.email ?? '').trim();
      const muda = emailNovo.toLowerCase() !== (existing!.email ?? '').trim().toLowerCase();
      if (muda && (!emailNovo || !isSindicoEstrito(user))) {
        dto = { ...dto, email: undefined };
      } else if (muda) {
        revogarExistente = dto.hasPortariaAccess ? 'tudo' : 'conta';
      }
    }
    // Trocar o e-mail de acesso troca a credencial: com a senha antiga, o dono do e-mail antigo achava o login
    // pelo app (login OU e-mail) e recriava o vínculo — a revogação se desfazia sozinha.
    const senhaDoPedido = typeof dto.senha === 'string' && dto.senha.trim() !== '' ? dto.senha : undefined;
    if (revogarExistente && !senhaDoPedido) {
      throw new BadRequestException('Defina uma nova senha ao trocar o e-mail de acesso.');
    }

    // Sem acesso pedido, o e-mail também não pode passar a ser um login de portaria existente: o login do
    // prestador é achado por esse e-mail (remove, revogação). Repetir o e-mail que o cadastro já tem não é troca.
    if (!dto.hasPortariaAccess && typeof dto.email === 'string') {
      const mesmoEmail = !!existing && (existing.email ?? '').trim().toLowerCase() === dto.email.trim().toLowerCase();
      if (!mesmoEmail) await this.assertEmailLivreNaPortaria(dto.email, dto.id_condominio);
    }

    // Unidade que de fato vai para o banco (no upsert, a ausente mantém a atual):
    // tem de ser do condomínio e, para morador, um apartamento dele.
    const idApartamento = existing
      ? (normalizarIdApartamento(dto.id_apartamento) ?? existing.id_apartamento)
      : (normalizarIdApartamento(dto.id_apartamento) ?? null);
    await assertApartamentoGravavel(this.prisma as any, idApartamento, Number(dto.id_condominio), user);

    // Mesmo nome = o mesmo cadastro: a foto dele pode voltar; outra URL do bucket, não.
    const fotosDoCadastro = existing ? [existing.foto_pessoa, existing.foto_documento] : [];
    const fotoPes = await this.resolveFoto(dto.foto_pessoa, fotosDoCadastro);
    const fotoDoc = await this.resolveFoto(dto.foto_documento, fotosDoCadastro);

    const dadosDoExistente = existing
      ? {
          telefone: dto.telefone ?? existing.telefone,
          email: dto.email !== undefined ? (dto.email ? dto.email.trim() : null) : existing.email,
          categorias: dto.categorias ?? existing.categorias,
          id_apartamento: idApartamento,
          foto_pessoa: fotoPes ?? existing.foto_pessoa,
          foto_documento: fotoDoc ?? existing.foto_documento,
          dias_semana: dto.dias_semana !== undefined ? dto.dias_semana : existing.dias_semana,
        }
      : null;

    // Antes de gravar o cadastro, como no update: a conta antiga sai antes de qualquer concessão ao e-mail novo.
    let criado: any;
    let vinculoHerdado: Record<string, any> | null = null;
    if (revogarExistente === 'conta' && loginDoExistente) {
      // Troca de e-mail sem a chave: revogação, cadastro e login de portaria (login, e-mail e senha nova) num ato.
      const hashTroca = await bcrypt.hash(senhaDoPedido as string, 12);
      const r = await this.revogarLoginDoPrestador(loginDoExistente, existing!.id, {
        manterLogin: true,
        mensagemErro: 'Não foi possível trocar o e-mail de acesso. Tente novamente.',
        noMesmoAto: async (tx) => {
          const p = await tx.prestadores_servico.update({ where: { id: existing!.id }, data: dadosDoExistente });
          // O login do cadastro acompanha o e-mail novo (já conferido livre acima), como no update: login E e-mail
          // (o app acha o login por qualquer dos dois) e a senha nova.
          if (p.email) {
            await tx.funcionarios_Portaria.update({
              where: { id: loginDoExistente.id },
              data: { login: p.email, email: p.email, password: hashTroca },
            });
          }
          return p;
        },
      });
      criado = r.resultado;
    } else if (revogarExistente && loginDoExistente) {
      vinculoHerdado = (await this.revogarLoginDoPrestador(loginDoExistente, existing!.id)).vinculoRemovido;
    }

    if (criado) {
      // Já gravado na transação da troca de e-mail.
    } else if (existing) {
      criado = await this.prisma.prestadores_servico.update({
        where: { id: existing.id },
        data: dadosDoExistente!,
      });
    } else {
      criado = await this.prisma.prestadores_servico.create({
        data: {
          nome: dto.nome,
          telefone: dto.telefone ?? null,
          email: dto.email ? dto.email.trim() : null,
          categorias: dto.categorias ?? null,
          id_condominio: dto.id_condominio,
          id_apartamento: idApartamento,
          foto_pessoa: fotoPes,
          foto_documento: fotoDoc,
          dias_semana: dto.dias_semana ?? null,
        },
      });
    }

    if (dto.hasPortariaAccess && dto.email) {
      const senhaInicial = dto.senha as string;
      const hash = await bcrypt.hash(senhaInicial, 12);
      const emailClean = dto.email.trim();

      await this.prisma.funcionarios_Portaria.create({
        data: {
          nome: dto.nome,
          login: emailClean,
          password: hash,
          email: emailClean,
          telefone: dto.telefone ?? null,
          turno: 'Geral',
          ativo: 1,
          id_condominio: dto.id_condominio,
        },
      });

      try {
        let user = await this.contaDoLogin(emailClean, dto.id_condominio);
        if (!user) {
          user = await this.prisma.users.create({
            data: {
              login: emailClean,
              email: emailClean,
              password: hash,
              name: dto.nome,
              phone: dto.telefone ?? null,
              is_funcionario: 1,
              is_sindico: 0,
              is_morador: 0,
              photo: fotoPes,
              profile_image: fotoPes,
            },
          });
        } else {
          // Conta já existente (da equipe deste condomínio, conferido em assertContaLivreParaPortaria).
          await this.ligarContaDaEquipe(user, hash, dto.id_condominio);
        }

        const f = await this.prisma.funcionarios.findFirst({
          where: { id_user: user.id, id_condominio: dto.id_condominio },
        });
        if (!f) {
          await this.prisma.funcionarios.create({
            data: {
              nome: dto.nome,
              email: emailClean,
              telefone: dto.telefone ?? null,
              id_user: user.id,
              id_condominio: dto.id_condominio,
              ...PrestadoresService.permissoesDoVinculo(vinculoHerdado),
            },
          });
        }
      } catch (err) {
        this.logger.error('Erro ao sincronizar funcionario web com Users/Funcionarios', err);
      }
    }

    this.fireFacialSync(criado.id);
    return criado;
  }

  async update(id: number, dto: Partial<CreatePrestadorDto>, idCondominio?: number, user?: JwtPayload) {
    // Interface, não DTO: um objeto no e-mail estourava em .trim() e virava erro 500 em vez de 400.
    if (dto.email != null && typeof dto.email !== 'string') throw new BadRequestException('E-mail inválido.');
    assertEmailNaoReservado(dto.email);
    // E-mail só com espaços = limpar o e-mail: revoga o login do prestador exatamente como email: null.
    if (typeof dto.email === 'string' && dto.email.trim() === '') dto = { ...dto, email: null };
    if (!this.prisma.isConnected) {
      return { success: true, id };
    }

    // Carrega e valida tenant antes de qualquer escrita (IDOR).
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: {
        id: true, id_condominio: true, id_apartamento: true, email: true, nome: true, telefone: true,
        foto_pessoa: true, foto_documento: true,
      },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `prestador #${id}`);
    await this.assertPodeGerenciarPrestador(atual, user);
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'prestadores_servico', user);
    // assertPodeGerenciarPrestador olha a unidade ATUAL; a nova também tem de ser válida.
    if (dto.id_apartamento !== undefined) {
      await assertApartamentoGravavel(
        this.prisma as any,
        normalizarIdApartamento(dto.id_apartamento) ?? null,
        atual.id_condominio,
        user,
      );
    }

    if (dto.hasPortariaAccess) assertOperador(user, 'conceder acesso à portaria a um prestador');
    // Login de portaria que esta edição cria ou re-credencia, resolvido ANTES de gravar: criar um login
    // novo sem senha é recusado (antes virava '123456') sem deixar o cadastro meio salvo.
    const emailParaLogin = dto.email ? dto.email.trim() : dto.email === undefined ? (atual.email ?? '').trim() : '';
    const senhaInformada = typeof dto.senha === 'string' && dto.senha.trim() !== '' ? dto.senha : undefined;
    // Só o login que ESTE prestador recebeu é re-credenciado. Antes era qualquer linha do condomínio com o
    // e-mail antigo ou o novo: gravar como e-mail o login de um colega e pedir o acesso com senha
    // sobrescrevia a senha dele (e o turno dele, até 'Síndico', continuava valendo).
    const emailMuda =
      typeof dto.email === 'string' && dto.email.trim().toLowerCase() !== (atual.email ?? '').trim().toLowerCase();
    const loginProprio =
      dto.hasPortariaAccess !== undefined || dto.email !== undefined ? await this.loginPortariaDoPrestador(atual) : null;
    // Revogar: desligar a chave ou limpar o e-mail (que é o login). Pedir o acesso com e-mail vence.
    const revoga =
      !(dto.hasPortariaAccess && emailParaLogin) && (dto.hasPortariaAccess === false || (dto.email === null && !!atual.email));

    // Conceder, mudar (senha, e-mail = login, reativar) ou revogar o login de portaria é do síndico, como no app.
    // Editar o prestador com a chave como está (o console manda o estado atual) continua com a portaria.
    const concedeOuMuda =
      !!dto.hasPortariaAccess &&
      !!emailParaLogin &&
      (!loginProprio || loginProprio.ativo !== 1 || !!senhaInformada || emailMuda);
    const tiraOuMove = !!loginProprio && (revoga || emailMuda);
    if (concedeOuMuda || tiraOuMove) assertSindicoEstrito(user, 'conceder, alterar ou revogar o acesso à portaria');
    // Trocar o e-mail de acesso troca a credencial. Só o login ia para o e-mail novo, com o `email` antigo e a
    // mesma senha: o dono do e-mail antigo entrava no app (que acha o login por login OU e-mail) com a senha de
    // sempre e o vínculo Funcionarios era RECRIADO — a revogação se desfazia sozinha.
    const trocaEmailDeAcesso = !!loginProprio && emailMuda && !!emailParaLogin && !revoga;
    if (trocaEmailDeAcesso && !senhaInformada) {
      throw new BadRequestException('Defina uma nova senha ao trocar o e-mail de acesso.');
    }

    if (dto.hasPortariaAccess) {
      const emailAcesso = (dto.email ?? atual.email ?? '').trim();
      if (emailAcesso) await this.assertContaLivreParaPortaria(emailAcesso, atual.id_condominio);
    }
    // E o e-mail resultante nunca pode ser login de outra pessoa: em TODA troca de e-mail (com ou sem a flag)
    // e em todo acesso pedido (antes só quando e-mail e flag vinham juntos, e o e-mail atual era isento).
    if (emailMuda || dto.hasPortariaAccess) {
      await this.assertEmailLivreNaPortaria(emailParaLogin, atual.id_condominio, loginProprio?.id);
    }
    const atualPortaria = dto.hasPortariaAccess && emailParaLogin ? loginProprio : null;
    if (dto.hasPortariaAccess && emailParaLogin && !atualPortaria && !senhaInformada) {
      throw new BadRequestException('Informe uma senha para o acesso à portaria.');
    }

    const fotosDoCadastro = [atual.foto_pessoa, atual.foto_documento];
    const fotoPes = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa, fotosDoCadastro) : undefined;
    const fotoDoc = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento, fotosDoCadastro) : undefined;

    // Antes de gravar o prestador: limpar o e-mail tira o login do alcance de loginPortariaDoPrestador, e uma
    // revogação que falhasse depois disso deixaria o acesso de pé sem caminho para refazê-la.
    // Só o login que ESTE prestador recebeu. Antes: deleteMany pelo e-mail (atual ou o novo), que levava
    // o login de qualquer pessoa da equipe gravado como e-mail do prestador.
    const dadosPrestador = {
      ...(dto.nome !== undefined && { nome: dto.nome }),
      ...(dto.telefone !== undefined && { telefone: dto.telefone }),
      ...(dto.email !== undefined && { email: dto.email ? dto.email.trim() : null }),
      ...(dto.categorias !== undefined && { categorias: dto.categorias }),
      ...(dto.id_apartamento !== undefined && { id_apartamento: normalizarIdApartamento(dto.id_apartamento) }),
      ...(fotoPes !== undefined && { foto_pessoa: fotoPes }),
      ...(fotoDoc !== undefined && { foto_documento: fotoDoc }),
      ...(dto.dias_semana !== undefined && { dias_semana: dto.dias_semana }),
    };
    const hash = senhaInformada ? await bcrypt.hash(senhaInformada, 12) : undefined;

    let atualizado: any;
    let vinculoHerdado: Record<string, any> | null = null;
    if (revoga && loginProprio) {
      await this.revogarLoginDoPrestador(loginProprio, Number(id));
    } else if (trocaEmailDeAcesso && loginProprio) {
      // Troca do e-mail (= login) de quem tem acesso: o login acompanha o e-mail novo, mas a conta do e-mail
      // ANTIGO sai da equipe no mesmo ato e os tokens dela caem. Antes ela seguia com o próprio Funcionarios e a
      // mesma senha — e a revogação, depois, só achava a conta do e-mail novo.
      // Revogação, cadastro e login de portaria (login E e-mail, que o app acha por qualquer dos dois, e a senha
      // nova, obrigatória nesta troca) numa transação só: antes, uma falha ao gravar o prestador deixava o login
      // com o e-mail e a senha antigos depois de a conta antiga já ter saído.
      const r = await this.revogarLoginDoPrestador(loginProprio, Number(id), {
        manterLogin: true,
        mensagemErro: 'Não foi possível trocar o e-mail de acesso. Tente novamente.',
        noMesmoAto: async (tx) => {
          const p = await tx.prestadores_servico.update({ where: { id: Number(id) }, data: dadosPrestador });
          await tx.funcionarios_Portaria.update({
            where: { id: loginProprio.id },
            data: dto.hasPortariaAccess
              ? {
                  nome: dto.nome ?? loginProprio.nome,
                  login: emailParaLogin,
                  email: emailParaLogin,
                  telefone: dto.telefone ?? loginProprio.telefone,
                  ativo: 1,
                  password: hash as string,
                }
              : { login: emailParaLogin, email: emailParaLogin, password: hash as string },
          });
          return p;
        },
      });
      atualizado = r.resultado;
      vinculoHerdado = r.vinculoRemovido;
    }

    try {
      if (!atualizado) {
        atualizado = await this.prisma.prestadores_servico.update({ where: { id: Number(id) }, data: dadosPrestador });
      }

      if (dto.hasPortariaAccess && emailParaLogin) {
        if (atualPortaria && trocaEmailDeAcesso) {
          // Já gravado na transação da troca de e-mail.
        } else if (atualPortaria) {
          await this.prisma.funcionarios_Portaria.update({
            where: { id: atualPortaria.id },
            data: {
              nome: dto.nome ?? atualPortaria.nome,
              login: emailParaLogin,
              email: emailParaLogin,
              telefone: dto.telefone ?? atualPortaria.telefone,
              ativo: 1,
              ...(hash && { password: hash }),
            },
          });
        } else {
          await this.prisma.funcionarios_Portaria.create({
            data: {
              nome: dto.nome ?? atualizado.nome,
              login: emailParaLogin,
              // Garantida pela checagem antes do try: sem login próprio, a senha é obrigatória.
              password: hash as string,
              email: emailParaLogin,
              telefone: dto.telefone ?? atualizado.telefone ?? null,
              turno: 'Geral',
              ativo: 1,
              id_condominio: atualizado.id_condominio,
            },
          });
        }

        try {
          let user = await this.contaDoLogin(emailParaLogin, atualizado.id_condominio);
          if (!user) {
            // Sem senha nova, a conta do app nasce com a senha que o login de portaria já tem.
            const userHash = hash ?? atualPortaria!.password;
            user = await this.prisma.users.create({
              data: {
                login: emailParaLogin,
                email: emailParaLogin,
                password: userHash,
                name: dto.nome ?? atualizado.nome,
                phone: dto.telefone ?? atualizado.telefone ?? null,
                is_funcionario: 1,
                is_sindico: 0,
                is_morador: 0,
                photo: fotoPes,
                profile_image: fotoPes,
              },
            });
          } else {
            // Conta já existente (da equipe deste condomínio, conferido em assertContaLivreParaPortaria): dados
            // pessoais ficam; a senha só acompanha a nova se a conta é exclusivamente desta equipe.
            await this.ligarContaDaEquipe(user, hash, atualizado.id_condominio);
          }

          const f = await this.prisma.funcionarios.findFirst({
            where: { id_user: user.id, id_condominio: atualizado.id_condominio },
          });
          if (!f) {
            await this.prisma.funcionarios.create({
              data: {
                nome: dto.nome ?? atualizado.nome,
                email: emailParaLogin,
                telefone: dto.telefone ?? atualizado.telefone ?? null,
                id_user: user.id,
                id_condominio: atualizado.id_condominio,
                ...PrestadoresService.permissoesDoVinculo(vinculoHerdado),
              },
            });
          } else {
            await this.prisma.funcionarios.update({
              where: { id: f.id },
              data: {
                nome: dto.nome ?? atualizado.nome,
                email: emailParaLogin,
                telefone: dto.telefone ?? atualizado.telefone ?? null,
              },
            });
          }
        } catch (err) {
          this.logger.error('Erro ao sincronizar funcionario web com Users/Funcionarios no update', err);
        }
      }
      // Troca de e-mail sem a flag: o login do prestador acompanhou na transação acima. Sem isto ele ficava com o
      // e-mail antigo, fora do alcance de re-credenciar, revogar e remover.

      this.fireFacialSync(atualizado.id);
      return atualizado;
    } catch (e) {
      throw e instanceof BadRequestException ? e : new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }

  async clearFoto(id: number, campo: 'pessoa' | 'documento', idCondominio?: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id: true, id_condominio: true, id_apartamento: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `prestador #${id}`);
    await this.assertPodeGerenciarPrestador(atual, user);
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'prestadores_servico', user);
    return this.prisma.prestadores_servico.update({
      where: { id: Number(id) },
      data: campo === 'pessoa' ? { foto_pessoa: null } : { foto_documento: null },
      include: { apartamento: { select: { bloco: true, apto: true } } },
    });
  }

  async remove(id: number, idCondominio?: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) return { success: true };

    // Valida tenant antes de deletar (IDOR).
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id: true, id_condominio: true, id_apartamento: true, face_id: true, email: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `prestador #${id}`);
    await this.assertPodeGerenciarPrestador(atual, user);
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'prestadores_servico', user);

    // Só o login de portaria que ESTE prestador recebeu (e-mail dele + condomínio). Antes:
    // deleteMany por e-mail — gravar o login de um porteiro como e-mail do prestador e removê-lo apagava a
    // conta do porteiro. Remover quem tem login é revogar esse login: do síndico, e antes de apagar o cadastro
    // (sem o prestador, o login fica sem caminho para ser revogado). Falha na revogação = nada é apagado.
    const loginProprio = await this.loginPortariaDoPrestador(atual);
    if (loginProprio) {
      assertSindicoEstrito(user, 'remover um prestador com acesso à portaria');
      await this.revogarLoginDoPrestador(loginProprio, Number(id));
    }

    // Remove o rosto dos terminais faciais antes de apagar o cadastro, senão
    // ficaria um rosto órfão abrindo a porta sem dono no banco.
    if (atual.face_id) {
      await this.facial
        .unsyncPrestadorServico(Number(id), atual.face_id, atual.id_condominio)
        .catch((err) =>
          this.logger.warn(
            `Unsync facial prestador ${id} falhou: ${err?.message ?? err}`,
          ),
        );
    }

    try {
      await this.prisma.prestadores_servico.delete({ where: { id: Number(id) } });
      return { success: true };
    } catch {
      throw new NotFoundException(`Prestador ${id} não encontrado`);
    }
  }
}