import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { TenantAccessService } from '../auth/tenant-access.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
import * as bcrypt from 'bcrypt';

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

  private async resolveFoto(value: string | undefined | null): Promise<string | null> {
    if (!value) return value ?? null;
    if (this.storage.isDataUrl(value)) {
      return (await this.storage.uploadDataUrl(value, 'prestadores')) ?? null;
    }
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

    return prestadores.map((p) => ({
      ...p,
      hasPortariaAccess: p.email ? loginSet.has(p.email.toLowerCase().trim()) : false,
    }));
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

    return { ...p, hasPortariaAccess };
  }

  async create(dto: CreatePrestadorDto, user?: JwtPayload) {
    await this.tenant.assertCondominio(dto.id_condominio, user);
    await this.tenant.assertPermissaoFuncionario(dto.id_condominio, 'prestadores_servico', user);
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
      const conflito = await this.prisma.funcionarios_Portaria.findFirst({
        where: { login: dto.email.trim() },
        select: { id: true },
      });
      if (conflito) {
        throw new BadRequestException('Já existe um funcionário com este e-mail.');
      }
    }

    const fotoPes = await this.resolveFoto(dto.foto_pessoa);
    const fotoDoc = await this.resolveFoto(dto.foto_documento);

    const existing = await this.prisma.prestadores_servico.findFirst({
      where: {
        id_condominio: Number(dto.id_condominio),
        nome: dto.nome.trim(),
      },
    });

    let criado;
    if (existing) {
      criado = await this.prisma.prestadores_servico.update({
        where: { id: existing.id },
        data: {
          telefone: dto.telefone ?? existing.telefone,
          email: dto.email !== undefined ? (dto.email ? dto.email.trim() : null) : existing.email,
          categorias: dto.categorias ?? existing.categorias,
          id_apartamento: dto.id_apartamento ?? existing.id_apartamento,
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
          id_apartamento: dto.id_apartamento ?? null,
          foto_pessoa: fotoPes,
          foto_documento: fotoDoc,
          dias_semana: dto.dias_semana ?? null,
        },
      });
    }

    if (dto.hasPortariaAccess && dto.email) {
      const senhaInicial = dto.senha || '123456';
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
          await this.prisma.users.update({
            where: { id: user.id },
            data: { is_funcionario: 1, password: hash },
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
    if (!this.prisma.isConnected) {
      return { success: true, id };
    }

    // Carrega e valida tenant antes de qualquer escrita (IDOR).
    const atual = await this.prisma.prestadores_servico.findUnique({
      where: { id: Number(id) },
      select: { id: true, id_condominio: true, id_apartamento: true, email: true, nome: true, telefone: true },
    });
    if (!atual) throw new NotFoundException(`Prestador ${id} não encontrado`);
    await this.tenant.assertEntidade(atual.id_condominio, user, `prestador #${id}`);
    await this.assertPodeGerenciarPrestador(atual, user);
    await this.tenant.assertPermissaoFuncionario(atual.id_condominio, 'prestadores_servico', user);

    if (dto.email && dto.hasPortariaAccess) {
      const conflito = await this.prisma.funcionarios_Portaria.findFirst({
        where: { login: dto.email.trim(), NOT: { login: atual.email || '' } },
        select: { id: true },
      });
      if (conflito) {
        throw new BadRequestException('Já existe outro funcionário com este e-mail.');
      }
    }

    const fotoPes = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa) : undefined;
    const fotoDoc = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento) : undefined;

    try {
      const atualizado = await this.prisma.prestadores_servico.update({
        where: { id: Number(id) },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.telefone !== undefined && { telefone: dto.telefone }),
          ...(dto.email !== undefined && { email: dto.email ? dto.email.trim() : null }),
          ...(dto.categorias !== undefined && { categorias: dto.categorias }),
          ...(dto.id_apartamento !== undefined && { id_apartamento: dto.id_apartamento }),
          ...(fotoPes !== undefined && { foto_pessoa: fotoPes }),
          ...(fotoDoc !== undefined && { foto_documento: fotoDoc }),
          ...(dto.dias_semana !== undefined && { dias_semana: dto.dias_semana }),
        },
      });

      const emailParaLogin = dto.email ? dto.email.trim() : (atualizado.email ?? '');

      if (dto.hasPortariaAccess && emailParaLogin) {
        const loginsParaBuscar = [atual.email, emailParaLogin].filter(Boolean) as string[];
        const atualPortaria = await this.prisma.funcionarios_Portaria.findFirst({
          where: { login: { in: loginsParaBuscar }, id_condominio: atualizado.id_condominio },
        });

        const hash = dto.senha ? await bcrypt.hash(dto.senha, 12) : undefined;

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
          const senhaInicial = dto.senha || '123456';
          const newHash = await bcrypt.hash(senhaInicial, 12);
          await this.prisma.funcionarios_Portaria.create({
            data: {
              nome: dto.nome ?? atualizado.nome,
              login: emailParaLogin,
              password: newHash,
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
            const senhaInicial = dto.senha || '123456';
            const userHash = hash || (await bcrypt.hash(senhaInicial, 12));
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
              data: {
                is_funcionario: 1,
                ...(hash && { password: hash }),
                name: dto.nome ?? atualizado.nome,
                phone: dto.telefone ?? atualizado.telefone,
                ...(fotoPes && { photo: fotoPes, profile_image: fotoPes }),
              },
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
      } else {
        if (dto.hasPortariaAccess === false || (dto.email === null && atual.email)) {
          const emailParaRemover = atual.email || emailParaLogin;
          if (emailParaRemover) {
            await this.prisma.funcionarios_Portaria.deleteMany({
              where: { login: emailParaRemover, id_condominio: atual.id_condominio },
            });
          }
        }
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

    if (atual.email) {
      await this.prisma.funcionarios_Portaria.deleteMany({
        where: { login: atual.email, id_condominio: atual.id_condominio },
      }).catch((err) =>
        this.logger.warn(`Falha ao remover acesso portaria do prestador ${id}: ${err.message}`),
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