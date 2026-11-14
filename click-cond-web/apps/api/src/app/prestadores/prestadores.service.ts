import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type Gravados, StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import * as bcrypt from 'bcrypt';
import { assertOperador, assertSindicoEstrito, isOperador } from '../auth/tenant.util';
import { momentoTrocaSenha } from '../auth/senha-alterada.util';
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
      where: { id_condominio: Number(idCondominio), ativo: 1 },
      select: { login: true },
    });
    const loginSet = new Set(portariaLogins.map((f) => f.login.toLowerCase().trim()));

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
        hasPortariaAccess: p.email ? loginSet.has(p.email.toLowerCase().trim()) : false,
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
    const existente = await this.prisma.users.findFirst({
      where: { OR: [{ login: email }, { email }] },
      select: { id: true },
    });
    if (!existente) return;
    const daEquipe = await this.prisma.funcionarios.findFirst({
      where: { id_user: existente.id, id_condominio: Number(idCondominio) },
      select: { id: true },
    });
    if (!daEquipe) {
      throw new BadRequestException('Já existe uma conta com este e-mail. Use outro e-mail para o acesso à portaria.');
    }
  }

  /**
   * O e-mail do prestador é a chave do login de portaria dele (não há FK). Por isso ele nunca pode passar a
   * ser um login de portaria que já existe e não é o dele — com ou sem acesso pedido. `idLoginProprio`: o
   * login que já pertence a este prestador (loginPortariaDoPrestador), que não conta como colisão.
   */
  private async assertEmailLivreNaPortaria(email: string | null | undefined, idLoginProprio?: number) {
    const login = (email ?? '').trim();
    if (!login) return;
    // login é único no banco inteiro: uma linha no máximo, comparada pelo id aqui.
    const existente = await this.prisma.funcionarios_Portaria.findFirst({ where: { login }, select: { id: true } });
    if (existente && existente.id !== idLoginProprio) {
      throw new BadRequestException('Já existe um funcionário com este e-mail.');
    }
  }

  /**
   * Login de portaria que ESTE prestador recebeu: login = e-mail gravado nele, mesmo condomínio e turno
   * 'Geral' (só o acesso concedido pelo cadastro de prestador grava esse turno). Linha com o mesmo login e
   * outro turno é de outra pessoa da equipe — nunca é re-credenciada nem apagada a partir do prestador.
   */
  private loginPortariaDoPrestador(p: { email: string | null; id_condominio: number }) {
    const login = (p.email ?? '').trim();
    if (!login) return Promise.resolve(null);
    return this.prisma.funcionarios_Portaria.findFirst({
      where: { login, id_condominio: p.id_condominio, turno: 'Geral' },
    });
  }

  /**
   * Tira de fato o acesso que o cadastro de prestador concedeu. Apagar só o Funcionarios_Portaria deixava a conta
   * do app e o vínculo Funcionarios criados na concessão: a pessoa seguia entrando no app como Funcionário e voltava
   * ao console pelo QR Code. Aqui sai também o vínculo de equipe DESTE condomínio (o JwtStrategy e o tenant do app
   * conferem por ele) e senha_alterada_em derruba os tokens já emitidos para a conta.
   *
   * A conta Users NUNCA é apagada: o mesmo e-mail pode ser de um síndico ou morador e a exclusão cascatearia.
   * O login de portaria sai por último: se algo falhar antes, ele continua achável e a revogação pode ser refeita.
   */
  private async revogarLoginDoPrestador(login: { id: number; login: string; id_condominio: number }, idPrestador: number) {
    try {
      const conta = await this.prisma.users.findFirst({
        where: { OR: [{ login: login.login }, { email: login.login }] },
        select: { id: true },
      });
      if (conta) {
        await this.prisma.funcionarios.deleteMany({ where: { id_user: conta.id, id_condominio: login.id_condominio } });
        await this.prisma.users.update({ where: { id: conta.id }, data: { senha_alterada_em: momentoTrocaSenha() } });
      }
      await this.prisma.funcionarios_Portaria.deleteMany({ where: { id: login.id } });
    } catch (err: any) {
      this.logger.error(`Falha ao revogar o acesso à portaria do prestador ${idPrestador}: ${err?.message ?? err}`);
      throw new BadRequestException('Não foi possível revogar o acesso à portaria. Tente novamente.');
    }
  }

  async create(dto: CreatePrestadorDto, user?: JwtPayload) {
    // Interface, não DTO: um objeto no e-mail estourava em .trim() e virava erro 500 em vez de 400.
    if (dto.email != null && typeof dto.email !== 'string') throw new BadRequestException('E-mail inválido.');
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
      await this.assertEmailLivreNaPortaria(dto.email);
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

    // Sem acesso pedido, o e-mail também não pode passar a ser um login de portaria existente: o login do
    // prestador é achado por esse e-mail (remove, revogação). Repetir o e-mail que o cadastro já tem não é troca.
    if (!dto.hasPortariaAccess && typeof dto.email === 'string') {
      const mesmoEmail = !!existing && (existing.email ?? '').trim().toLowerCase() === dto.email.trim().toLowerCase();
      if (!mesmoEmail) await this.assertEmailLivreNaPortaria(dto.email);
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

    let criado;
    if (existing) {
      criado = await this.prisma.prestadores_servico.update({
        where: { id: existing.id },
        data: {
          telefone: dto.telefone ?? existing.telefone,
          email: dto.email !== undefined ? (dto.email ? dto.email.trim() : null) : existing.email,
          categorias: dto.categorias ?? existing.categorias,
          id_apartamento: idApartamento,
          foto_pessoa: fotoPes ?? existing.foto_pessoa,
          foto_documento: fotoDoc ?? existing.foto_documento,
          dias_semana: dto.dias_semana !== undefined ? dto.dias_semana : existing.dias_semana,
        },
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
        let user = await this.prisma.users.findFirst({
          where: { OR: [{ login: emailClean }, { email: emailClean }] },
        });
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
          // Conta já existente (da equipe deste condomínio): nunca troca a senha dela.
          await this.prisma.users.update({
            where: { id: user.id },
            data: { is_funcionario: 1 },
          });
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
              funcao: 'Porteiro',
              ch: 'Geral',
              id_user: user.id,
              id_condominio: dto.id_condominio,
              areas_sociais: 1,
              comunicados: 1,
              ocorrencias: 1,
              manutencoes_programadas: 1,
              prestadores_servico: 1,
              agendar_mudanca: 1,
              cadastrar_visitante: 1,
              apartamentos: 1,
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

    if (dto.hasPortariaAccess) {
      const emailAcesso = (dto.email ?? atual.email ?? '').trim();
      if (emailAcesso) await this.assertContaLivreParaPortaria(emailAcesso, atual.id_condominio);
    }
    // E o e-mail resultante nunca pode ser login de outra pessoa: em TODA troca de e-mail (com ou sem a flag)
    // e em todo acesso pedido (antes só quando e-mail e flag vinham juntos, e o e-mail atual era isento).
    if (emailMuda || dto.hasPortariaAccess) {
      await this.assertEmailLivreNaPortaria(emailParaLogin, loginProprio?.id);
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
    if (revoga && loginProprio) await this.revogarLoginDoPrestador(loginProprio, Number(id));

    try {
      const atualizado = await this.prisma.prestadores_servico.update({
        where: { id: Number(id) },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.telefone !== undefined && { telefone: dto.telefone }),
          ...(dto.email !== undefined && { email: dto.email ? dto.email.trim() : null }),
          ...(dto.categorias !== undefined && { categorias: dto.categorias }),
          ...(dto.id_apartamento !== undefined && { id_apartamento: normalizarIdApartamento(dto.id_apartamento) }),
          ...(fotoPes !== undefined && { foto_pessoa: fotoPes }),
          ...(fotoDoc !== undefined && { foto_documento: fotoDoc }),
          ...(dto.dias_semana !== undefined && { dias_semana: dto.dias_semana }),
        },
      });

      if (dto.hasPortariaAccess && emailParaLogin) {
        const hash = senhaInformada ? await bcrypt.hash(senhaInformada, 12) : undefined;

        if (atualPortaria) {
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
          let user = await this.prisma.users.findFirst({
            where: { OR: [{ login: emailParaLogin }, { email: emailParaLogin }] },
          });
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
            await this.prisma.users.update({
              where: { id: user.id },
              // Conta já existente (da equipe deste condomínio): não troca senha nem dados pessoais dela.
              data: { is_funcionario: 1 },
            });
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
                funcao: 'Porteiro',
                ch: 'Geral',
                id_user: user.id,
                id_condominio: atualizado.id_condominio,
                areas_sociais: 1,
                comunicados: 1,
                ocorrencias: 1,
                manutencoes_programadas: 1,
                prestadores_servico: 1,
                agendar_mudanca: 1,
                cadastrar_visitante: 1,
                apartamentos: 1,
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
      } else if (!revoga && emailMuda && emailParaLogin && loginProprio) {
        // Troca de e-mail sem a flag: o login do prestador acompanha (já conferido livre acima). Sem isto ele
        // ficava com o e-mail antigo, fora do alcance de re-credenciar, revogar e remover.
        await this.prisma.funcionarios_Portaria.update({
          where: { id: loginProprio.id },
          data: { login: emailParaLogin },
        });
      }

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

    // Só o login de portaria que ESTE prestador recebeu (e-mail dele + condomínio + turno 'Geral'). Antes:
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