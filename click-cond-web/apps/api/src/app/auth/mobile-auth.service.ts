import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from './jwt-payload.interface';
import { StorageService } from '../common/storage/storage.service';
import { somenteDigitos } from '../common/documento.util';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { FacialService } from '../facial/facial.service';
import { TenantAccessService } from './tenant-access.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertStaff, assertSindico, assertOperador } from './tenant.util';
import { ApartamentosService } from '../apartamentos/apartamentos.service';

@Injectable()
export class MobileAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly facial: FacialService,
    private readonly tenant: TenantAccessService,
    private readonly financeiro: FinanceiroService,
    private readonly apartamentos: ApartamentosService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Normaliza o vínculo (tipo) do morador para o vocabulário canônico:
   * 'proprietario' | 'inquilino' | 'membro'. Trata dados legados/sujos:
   * 'Proprietário'/'morador'/null/'' → 'proprietario'; 'dependente' → 'membro'.
   * Usado para comparar tipos de forma robusta a acento/caixa.
   */
  private normalizeTipo(raw: string | null | undefined): 'proprietario' | 'inquilino' | 'membro' {
    const t = (raw ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
    if (t === 'inquilino') return 'inquilino';
    if (t === 'membro' || t === 'dependente') return 'membro';
    // 'proprietario', 'morador', '', null e variantes corrompidas → proprietario
    return 'proprietario';
  }

  private parseDate(dateStr: string | Date | null | undefined): Date | null {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    const s = String(dateStr).trim();
    if (!s || s === 'null' || s === 'undefined') return null;

    if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
      const parts = s.split(' ')[0].split('/');
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      const parsed = new Date(year, month, day);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  private async verifyPassword(senhaRaw: string, stored: string | null | undefined, userId: number): Promise<boolean> {
    if (!stored) return false;

    if (stored.startsWith('$2')) {
      return bcrypt.compare(senhaRaw, stored);
    }

    const md5Password = createHash('md5').update(senhaRaw).digest('hex');
    const isMatch = stored === md5Password;

    if (isMatch) {
      try {
        const newHash = await bcrypt.hash(senhaRaw, 10);
        await this.prisma.users.update({
          where: { id: userId },
          data: { password: newHash },
        });
      } catch (e) {
        // Falha na migração não deve bloquear o login
      }
    }

    return isMatch;
  }

  // ==========================================
  // SÍNDICO
  // ==========================================
  async loginSindico(login: string, senhaRaw: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const user = await this.prisma.users.findFirst({
      where: { login },
      include: { sindicos: true },
    });

    if (!user || !user.sindicos || user.sindicos.length === 0) {
      throw new UnauthorizedException('Login ou Senha incorretos');
    }

    const isMatch = await this.verifyPassword(senhaRaw, user.password, user.id);

    if (!isMatch) {
      throw new UnauthorizedException('Login ou Senha incorretos');
    }

    const sindico = user.sindicos[0];
    const userObj = { id: user.id, name: sindico.name, photo: user.photo ?? '' };
    const payload = { sub: user.id, nome: sindico.name, typeAccess: 'Sindico', user: userObj };

    return { token: this.jwt.sign(payload, { expiresIn: '365d' }), user: userObj };
  }

  /**
   * Converte a foto recebida do app em algo que caiba na coluna.
   *
   * `Users.photo` é VarChar(500) e guarda URL — o app manda a imagem como
   * data URL base64, que tem dezenas de milhares de caracteres. Gravar direto
   * estourava o banco e a tela "Editar Dados" mostrava o erro cru do Prisma
   * ("value too long for the column's type. Column: photo"), sem salvar nada.
   *
   * Devolve `undefined` quando não há nada a alterar, para o chamador manter a
   * foto atual em vez de apagá-la.
   */
  private async normalizarFoto(
    photo: string | undefined,
    prefix: string,
  ): Promise<string | undefined> {
    if (photo === undefined) return undefined;
    if (photo === null || photo === '') return '';
    if (!this.storage.isDataUrl(photo)) return photo; // já é URL

    const url = await this.storage.uploadDataUrl(photo, prefix, 'profile');

    // Storage desligado devolve o próprio data URL. Preferimos manter a foto
    // anterior a derrubar o salvamento inteiro do perfil por causa da imagem.
    if (!url || this.storage.isDataUrl(url)) {
      console.warn('[perfil] foto não enviada ao storage; mantendo a anterior.');
      return undefined;
    }
    return url;
  }

  async signupSindico(body: {
    nome: string;
    email: string;
    password?: string;
    senha?: string;
    date_birth?: string;
    phone?: string;
    doc_identification?: string;
    photo?: string;
  }) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const emailNormalized = body.email.toLowerCase().trim();

    // Verificar se login já existe
    const existing = await this.prisma.users.findFirst({
      where: { login: emailNormalized }
    });

    if (existing) {
      throw new BadRequestException('Este e-mail já está sendo utilizado por outro usuário.');
    }

    const pwdRaw = body.password ?? body.senha ?? '';
    if (!pwdRaw) {
      throw new BadRequestException('A senha é obrigatória.');
    }
    const hashedPassword = await bcrypt.hash(pwdRaw, 10);

    // Evitar conflitos em campos @unique com valores vazios/nulos
    const docId = body.doc_identification?.trim() || null;
    const phone = body.phone?.trim() || null;

    if (docId) {
      const existingCpf = await this.prisma.users.findFirst({
        where: { cpf: docId }
      });
      if (existingCpf) {
        throw new BadRequestException('Este CPF já está cadastrado no sistema.');
      }
    }

    let parsedBirth: Date | null = null;
    if (body.date_birth) {
      try {
        const parts = body.date_birth.split('/');
        if (parts.length === 3) {
          parsedBirth = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        } else {
          parsedBirth = new Date(body.date_birth);
        }
      } catch (e) {}
    }

    const fotoUrl = await this.normalizarFoto(body.photo, 'sindicos');

    // 1. Criar Usuário
    const user = await this.prisma.users.create({
      data: {
        login: emailNormalized,
        email: emailNormalized,
        password: hashedPassword,
        is_sindico: 1,
        name: body.nome,
        phone: phone,
        photo: fotoUrl || null,
        cpf: docId,
      }
    });

    // 2. Criar Perfil de Síndico
    const sindico = await this.prisma.sindicos.create({
      data: {
        id_user: user.id,
        name: body.nome,
        email: emailNormalized,
        phone: phone,
        doc_identification: docId,
        date_birth: parsedBirth,
      }
    });

    const userObj = { id: user.id, name: sindico.name, photo: user.photo ?? '' };
    const payload = { sub: user.id, nome: sindico.name, typeAccess: 'Sindico', user: userObj };

    return { token: this.jwt.sign(payload, { expiresIn: '365d' }), user: userObj };
  }

  async getSindicoByIdUser(idUser: number) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const user = await this.prisma.users.findUnique({
      where: { id: idUser },
      include: { sindicos: true },
    });
    if (!user || !user.sindicos || user.sindicos.length === 0) {
      throw new NotFoundException('Perfil de síndico não encontrado.');
    }
    const s = user.sindicos[0];
    
    // Formatar data_birth para DD/MM/YYYY
    let dobString = '';
    if (s.date_birth) {
      const d = new Date(s.date_birth);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      dobString = `${day}/${month}/${year}`;
    }

    return {
      id: s.id,
      name: s.name ?? '',
      email: s.email ?? '',
      date_birth: dobString,
      phone: s.phone ?? '',
      doc_identification: s.doc_identification ?? '',
      photo: user.photo ?? '',
    };
  }

  async updateSindico(idUser: number, body: {
    nome?: string;
    email?: string;
    date_birth?: string;
    phone?: string;
    doc_identification?: string;
    photo?: string;
  }) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }

    const user = await this.prisma.users.findUnique({
      where: { id: idUser },
      include: { sindicos: true },
    });
    if (!user || !user.sindicos || user.sindicos.length === 0) {
      throw new NotFoundException('Síndico não encontrado.');
    }
    const s = user.sindicos[0];

    const emailNormalized = body.email?.toLowerCase().trim();
    if (emailNormalized && emailNormalized !== user.email) {
      const existing = await this.prisma.users.findFirst({
        where: {
          OR: [{ email: emailNormalized }, { login: emailNormalized }],
          NOT: { id: idUser },
        }
      });
      if (existing) {
        throw new BadRequestException('Este e-mail já está sendo utilizado por outro usuário.');
      }
    }

    let parsedBirth: Date | null = s.date_birth;
    if (body.date_birth) {
      try {
        const parts = body.date_birth.split('/');
        if (parts.length === 3) {
          parsedBirth = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        } else {
          parsedBirth = new Date(body.date_birth);
        }
      } catch (e) {}
    }

    const docId = body.doc_identification?.trim() || null;
    const phone = body.phone?.trim() || null;

    // Fora da transação: o upload é rede, e segurá-lo dentro prenderia a
    // transação do banco pelo tempo da subida da imagem.
    const fotoUrl = await this.normalizarFoto(body.photo, 'sindicos');

    await this.prisma.$transaction(async (tx) => {
      // 1. Atualizar tabela users
      await tx.users.update({
        where: { id: idUser },
        data: {
          name: body.nome || user.name,
          email: emailNormalized || user.email,
          login: emailNormalized || user.login,
          phone: phone,
          cpf: docId,
          photo: fotoUrl !== undefined ? fotoUrl : user.photo,
        }
      });

      // 2. Atualizar tabela sindicos
      await tx.sindicos.update({
        where: { id: s.id },
        data: {
          name: body.nome || s.name,
          email: emailNormalized || s.email,
          phone: phone,
          doc_identification: docId,
          date_birth: parsedBirth,
        }
      });
    });

    return { success: true };
  }


  async listCondominiosSindico(idUser: number) {
    if (!this.prisma.isConnected) {
      return [{
        id: 1, nome: 'Condomínio Premium', num_blocos: 2, num_aptos: 40, moeda: 'R$',
        updatedAt: '14/05/2026 às 12:00', photo: '', saldo: '15.500,00',
        data_financeiro: '14/05/2026', vencimento_condominio: '30/12/2026',
        dias_restantes_condominio: 200,
        apto_id: null, apto: '', apto_bloco: '', apto_tipo: null,
        vencimento_morador: '', dias_restantes_morador: 0,
      }];
    }

    try {
      const rels = await this.prisma.sindicos_Condominios.findMany({
        where: { id_user: idUser },
        include: {
          condominio: {
            include: {
              financeiro: { where: { pago: 1 }, select: { valor: true, created_at: true } },
              // Conta os apartamentos sem carregar todas as linhas (antes: apartamentos:true
              // trazia os 200+ aptos só para contar/num_aptos).
              _count: { select: { apartamentos: true } },
            },
          },
        },
      });

      // Vínculos de morador do síndico (caso ele também more em algum condomínio).
      // Mapeia por id_condominio → vínculo mais recente, para devolver os campos de
      // apartamento e ligar as funções de morador no app daquele condomínio.
      const aptoLinks = await this.prisma.apartamentos_Users.findMany({
        where: { id_user: idUser },
        include: { apartamento: { select: { id: true, apto: true, bloco: true, id_condominio: true } } },
        orderBy: { created_at: 'desc' },
      });
      const linkByCond = new Map<number, typeof aptoLinks[number]>();
      for (const l of aptoLinks) {
        const cid = l.apartamento?.id_condominio;
        if (cid != null && !linkByCond.has(cid)) linkByCond.set(cid, l);
      }

      const resultList = rels.map(r => {
        const c = r.condominio;
        if (!c || c.ativo === 0) return null;

        // Garante que financeiro seja tratado como array mesmo se vier nulo/indefinido
        const financeiro = c.financeiro ?? [];
        const totalAptos = (c as any)._count?.apartamentos ?? 0;

        const saldoNum = financeiro.reduce((acc, f) => acc + (Number(f.valor) || 0), 0);
        const saldoStr = saldoNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const link = linkByCond.get(c.id);

        return {
          id: c.id,
          nome: c.nome,
          num_blocos: c.num_blocos ?? 1,
          num_aptos: totalAptos > 0 ? totalAptos : (c.num_aptos ?? 0),
          moeda: c.moeda ?? 'R$',
          updatedAt: c.updated_at ? c.updated_at.toLocaleDateString('pt-BR') : '',
          photo: c.photo ?? '',
          saldo: saldoStr,
          data_financeiro: financeiro.length > 0 ? financeiro[financeiro.length - 1].created_at.toLocaleDateString('pt-BR') : '-',
          vencimento_condominio: c.vencimento ? c.vencimento.toLocaleDateString('pt-BR') : '',
          dias_restantes_condominio: c.vencimento ? Math.ceil((c.vencimento.getTime() - Date.now()) / 86400000) : 100,
          // Campos de morador (quando o síndico está vinculado a um apto deste condomínio).
          apto_id: link?.apartamento?.id ?? null,
          apto: link?.apartamento?.apto ?? '',
          apto_bloco: link?.apartamento?.bloco ?? '',
          apto_tipo: link?.tipo ?? null,
          vencimento_morador: link?.vencimento ? link.vencimento.toLocaleDateString('pt-BR') : '',
          dias_restantes_morador: link?.vencimento ? Math.ceil((link.vencimento.getTime() - Date.now()) / 86400000) : 0,
        };
      }).filter(Boolean);

      if (resultList.length > 0) return resultList;
    } catch (e) {
      console.error('[listCondominiosSindico] Erro ao buscar condomínios do síndico:', e);
    }

    return [];
  }

  /**
   * Vincula um usuário JÁ EXISTENTE (ex.: o próprio síndico) a um apartamento como
   * morador, sem criar conta nova: cria Apartamentos_Users + Moradores e marca
   * is_morador=1. Idempotente (bloqueia vínculo duplicado no mesmo apto).
   */
  async linkUserAsMorador(idUser: number, idApto: number, tipoRaw?: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível. Tente novamente em instantes.');
    }
    if (!idApto) throw new BadRequestException('Apartamento não informado.');

    const tipo = String(tipoRaw || 'proprietario')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim() || 'proprietario';

    const apto = await this.prisma.apartamentos.findUnique({ where: { id: Number(idApto) } });
    if (!apto) throw new NotFoundException('Apartamento não encontrado.');

    const user = await this.prisma.users.findUnique({ where: { id: Number(idUser) } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    // Idempotência: já vinculado a este apto?
    const already = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: Number(idUser), id_apto: Number(idApto) },
    });
    if (already) throw new BadRequestException('Você já está vinculado a este apartamento.');

    const venc = new Date();
    venc.setDate(venc.getDate() + 45);

    await this.prisma.$transaction(async (tx) => {
      await tx.apartamentos_Users.create({
        data: { id_apto: apto.id, id_user: Number(idUser), tipo, vencimento: venc },
      });
      await tx.moradores.create({
        data: {
          nome: user.name ?? 'Síndico',
          documento: user.cpf ?? null,
          email: user.email ?? null,
          telefone: user.phone ?? null,
          tipo,
          id_user: Number(idUser),
          id_condominio: apto.id_condominio,
          bloco: apto.bloco || null,
          apartamento: apto.apto || null,
        },
      });
      await tx.users.update({ where: { id: Number(idUser) }, data: { is_morador: 1 } });
    });

    return {
      success: true,
      id_condominio: apto.id_condominio,
      apto_id: apto.id,
      apto: apto.apto ?? '',
      apto_bloco: apto.bloco ?? '',
      apto_tipo: tipo,
    };
  }

  /** Lista os síndicos de um condomínio (para o web escolher quem vincular). */
  async listSindicosCondominio(idCond: number) {
    if (!this.prisma.isConnected) return [];
    const rels = await this.prisma.sindicos_Condominios.findMany({
      where: { id_condominio: Number(idCond) },
      include: { user: { include: { sindicos: true } } },
    });
    return rels.map((r) => ({
      id_user: r.id_user,
      nome: r.user?.sindicos?.[0]?.name ?? r.user?.name ?? '',
      email: r.user?.email ?? null,
    }));
  }

  // ==========================================
  // MORADOR
  // ==========================================
  async loginMorador(login: string, senhaRaw: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const user = await this.prisma.users.findFirst({
      where: { OR: [{ login }, { email: login }] },
      include: { moradores: true },
    });

    if (!user || !user.moradores || user.moradores.length === 0) {
      throw new UnauthorizedException('Login ou Senha incorretos');
    }

    const isMatch = await this.verifyPassword(senhaRaw, user.password, user.id);

    if (!isMatch) {
      throw new UnauthorizedException('Login ou Senha incorretos');
    }

    const morador = user.moradores[0];
    const userObj = { id: user.id, nome: morador.nome, photo: user.photo ?? '' };
    const payload = { sub: user.id, nome: morador.nome, typeAccess: 'Morador', user: userObj };

    return { token: this.jwt.sign(payload, { expiresIn: '365d' }), user: userObj };
  }

  async listCondominiosMorador(idUser: number) {
    if (!this.prisma.isConnected) {
      return [{
        id: 1, nome: 'Condomínio Premium', num_blocos: 2, num_aptos: 40, moeda: 'R$',
        updatedAt: '14/05/2026 às 12:00', photo: '', saldo: '15.500,00',
        data_financeiro: '14/05/2026', vencimento_condominio: '30/12/2026',
        dias_restantes_condominio: 200, apto_id: 1, apto: '101', apto_bloco: 'A',
        vencimento_morador: '30/12/2026', dias_restantes_morador: 200
      }];
    }

    try {
      const rels = await this.prisma.apartamentos_Users.findMany({
        where: { id_user: idUser },
        include: {
          apartamento: {
            include: {
              condominio: {
                include: { financeiro: { where: { pago: 1 }, select: { valor: true, created_at: true } } },
              },
            },
          },
        },
      });

      const resultList = rels.map(r => {
        const apto = r.apartamento;
        if (!apto) return null;
        const c = apto.condominio;
        if (!c || c.ativo === 0) return null;
        const saldoNum = c.financeiro?.reduce((acc, f) => acc + (Number(f.valor) || 0), 0) ?? 0;
        const saldoStr = saldoNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return {
          id: c.id,
          nome: c.nome,
          num_blocos: c.num_blocos,
          num_aptos: c.num_aptos,
          moeda: c.moeda ?? 'R$',
          updatedAt: c.updated_at ? c.updated_at.toLocaleDateString('pt-BR') : '',
          photo: c.photo ?? '',
          saldo: saldoStr,
          data_financeiro: c.financeiro && c.financeiro.length > 0 ? c.financeiro[c.financeiro.length - 1].created_at.toLocaleDateString('pt-BR') : '-',
          vencimento_condominio: c.vencimento ? c.vencimento.toLocaleDateString('pt-BR') : '',
          dias_restantes_condominio: c.vencimento ? Math.ceil((c.vencimento.getTime() - Date.now()) / 86400000) : 100,
          apto_id: apto.id,
          apto: apto.apto,
          apto_bloco: apto.bloco ?? '',
          vencimento_morador: r.vencimento ? r.vencimento.toLocaleDateString('pt-BR') : '',
          dias_restantes_morador: r.vencimento ? Math.ceil((r.vencimento.getTime() - Date.now()) / 86400000) : 100,
        };
      }).filter(Boolean);

      // Remove duplicados de relacionamento com o mesmo apartamento
      const uniqueResult = [];
      const seenAptoIds = new Set();
      for (const item of resultList) {
        if (item && !seenAptoIds.has(item.apto_id)) {
          seenAptoIds.add(item.apto_id);
          uniqueResult.push(item);
        }
      }

      if (uniqueResult.length > 0) return uniqueResult;
    } catch (e) {
      // Ignora falhas e retorna mock
    }

    return [];
  }

  // ==========================================
  // FUNCIONÁRIO
  // ==========================================
  async loginFuncionario(login: string, senhaRaw: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }

    const cleanLogin = login.trim();
    let user = await this.prisma.users.findFirst({
      where: {
        OR: [
          { login: cleanLogin },
          { email: cleanLogin },
        ],
      },
      include: { funcionarios: true },
    });

    // Se o usuário não existe em Users ou não tem o vínculo na tabela Funcionarios,
    // busca na tabela Funcionarios_Portaria (criada pelo painel Web).
    if (!user || !user.funcionarios || user.funcionarios.length === 0) {
      const portaria = await this.prisma.funcionarios_Portaria.findFirst({
        where: {
          OR: [
            { login: cleanLogin },
            { email: cleanLogin },
          ],
        },
      });

      if (!portaria) {
        throw new UnauthorizedException('Login ou Senha incorretos');
      }

      const isMatch = await this.verifyPassword(senhaRaw, portaria.password, portaria.id);
      if (!isMatch) {
        throw new UnauthorizedException('Login ou Senha incorretos');
      }

      const senhaHash = portaria.password.startsWith('$2')
        ? portaria.password
        : await bcrypt.hash(senhaRaw, 10);

      // Sincroniza / cria o registro em Users e Funcionarios para o mobile
      if (!user) {
        user = await this.prisma.users.create({
          data: {
            login: portaria.login,
            email: portaria.email || portaria.login,
            password: senhaHash,
            name: portaria.nome,
            phone: portaria.telefone,
            is_funcionario: 1,
            is_sindico: 0,
            is_morador: 0,
          },
          include: { funcionarios: true },
        });
      } else {
        await this.prisma.users.update({
          where: { id: user.id },
          data: {
            is_funcionario: 1,
            password: user.password || senhaHash,
          },
        });
      }

      let func = await this.prisma.funcionarios.findFirst({ where: { id_user: user.id } });
      if (!func) {
        func = await this.prisma.funcionarios.create({
          data: {
            nome: portaria.nome,
            email: portaria.email || portaria.login,
            telefone: portaria.telefone,
            funcao: 'Porteiro',
            ch: portaria.turno || '',
            id_user: user.id,
            id_condominio: portaria.id_condominio,
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

      const userObj = {
        id: user.id,
        nome: func.nome,
        photo: user.photo ?? '',
        areas_sociais: func.areas_sociais ?? 1,
        comunicados: func.comunicados ?? 1,
        ocorrencias: func.ocorrencias ?? 1,
        manutencoes_programadas: func.manutencoes_programadas ?? 1,
        prestadores_servico: func.prestadores_servico ?? 1,
        agendar_mudanca: func.agendar_mudanca ?? 1,
        cadastrar_visitante: func.cadastrar_visitante ?? 1,
        apartamentos: func.apartamentos ?? 1,
      };
      const payload = { sub: user.id, nome: func.nome, typeAccess: 'Funcionario', user: userObj };
      return { token: this.jwt.sign(payload, { expiresIn: '365d' }), user: userObj };
    }

    let isMatch = await this.verifyPassword(senhaRaw, user.password, user.id);

    if (!isMatch) {
      // Se a senha falhar no Users, pode ser que tenha sido cadastrada/atualizada em Funcionarios_Portaria
      const portaria = await this.prisma.funcionarios_Portaria.findFirst({
        where: {
          OR: [
            { login: cleanLogin },
            { email: cleanLogin },
          ],
        },
      });

      if (portaria) {
        const isPortariaMatch = await this.verifyPassword(senhaRaw, portaria.password, portaria.id);
        if (isPortariaMatch) {
          const newHash = portaria.password.startsWith('$2')
            ? portaria.password
            : await bcrypt.hash(senhaRaw, 10);
          await this.prisma.users.update({
            where: { id: user.id },
            data: { password: newHash },
          });
          isMatch = true;
        }
      }
    }

    if (!isMatch) {
      throw new UnauthorizedException('Login ou Senha incorretos');
    }

    const func = user.funcionarios[0];
    const userObj = {
      id: user.id,
      nome: func.nome,
      photo: user.photo ?? '',
      areas_sociais: func.areas_sociais ?? 1,
      comunicados: func.comunicados ?? 1,
      ocorrencias: func.ocorrencias ?? 1,
      manutencoes_programadas: func.manutencoes_programadas ?? 1,
      prestadores_servico: func.prestadores_servico ?? 1,
      agendar_mudanca: func.agendar_mudanca ?? 1,
      cadastrar_visitante: func.cadastrar_visitante ?? 1,
      apartamentos: func.apartamentos ?? 1,
    };
    const payload = { sub: user.id, nome: func.nome, typeAccess: 'Funcionario', user: userObj };

    return { token: this.jwt.sign(payload, { expiresIn: '365d' }), user: userObj };
  }

  async listCondominiosFuncionario(idUser: number) {
    if (!this.prisma.isConnected) {
      return [{
        id: 1, nome: 'Condomínio Premium', num_blocos: 2, num_aptos: 40, moeda: 'R$',
        updatedAt: '14/05/2026 às 12:00', photo: '', saldo: '15.500,00',
        vencimento_condominio: '30/12/2026', dias_restantes_condominio: 200
      }];
    }

    try {
      const funcs = await this.prisma.funcionarios.findMany({
        where: { id_user: idUser },
        include: {
          condominio: {
            include: { financeiro: { where: { pago: 1 }, select: { valor: true, created_at: true } }, apartamentos: true },
          },
        },
      });

      const resultList = funcs.map(f => {
        const c = f.condominio;
        if (!c || c.ativo === 0) return null;
        const saldoNum = c.financeiro?.reduce((acc, fin) => acc + (Number(fin.valor) || 0), 0) ?? 0;
        const saldoStr = saldoNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return {
          id: c.id,
          nome: c.nome,
          num_blocos: c.num_blocos,
          num_aptos: c.apartamentos?.length ?? c.num_aptos,
          moeda: c.moeda ?? 'R$',
          updatedAt: c.updated_at ? c.updated_at.toLocaleDateString('pt-BR') : '',
          photo: c.photo ?? '',
          saldo: saldoStr,
          vencimento_condominio: c.vencimento ? c.vencimento.toLocaleDateString('pt-BR') : '',
          dias_restantes_condominio: c.vencimento ? Math.ceil((c.vencimento.getTime() - Date.now()) / 86400000) : 100,
        };
      }).filter(Boolean);

      if (resultList.length > 0) return resultList;
    } catch (e) {
      // Ignora erro interno do cliente do Prisma e retorna mock
    }

    return [];
  }

  // ==========================================
  // DASHBOARD SUMMARY
  // ==========================================
  async getSummary(idUser: number, typeAccess: string) {
    if (!this.prisma.isConnected) {
      return typeAccess === 'Sindico'
        ? { debts: { count: 2, total: 450.0 }, occurrences: 1 }
        : { visits: 1, packages: 2 };
    }

    if (typeAccess === 'Sindico') {
      try {
        const rels = await this.prisma.sindicos_Condominios.findMany({
          where: { id_user: idUser },
          select: { id_condominio: true },
        });
        const ids = rels.map(r => r.id_condominio);
        if (ids.length === 0) return { debts: { count: 0, total: 0.0 }, occurrences: 0 };

        // O card na home do síndico se chama "Inadimplência" e abre a lista de
        // inadimplentes — então precisa contar a mesma coisa que ela: cobrança
        // de apartamento em aberto.
        //
        // Sem estes filtros, a soma era de TODO lançamento não pago do
        // condomínio, e o número não queria dizer nada: as despesas do prédio
        // a pagar entram negativas no banco e SUBTRAÍAM do total, enquanto as
        // contas pessoais dos moradores (água, luz, internet que eles mesmos
        // lançam) entram positivas e inflavam — além de ser dado privado deles
        // aparecendo agregado na tela do síndico. Dívida já renegociada em
        // acordo também contava, junto com as parcelas que a substituíram.
        const fins = await this.prisma.financeiro.findMany({
          where: {
            id_condominio: { in: ids },
            pago: 0,
            tipo: 'C',
            valor: { gt: 0 },
            status: { not: '3' },
          },
          select: { valor: true },
        });
        const debtsTotal = fins.reduce((acc, f) => acc + (Number(f.valor) || 0), 0);

        const occurrencesCount = await this.prisma.ocorrencias.count({
          where: {
            id_condominio: { in: ids },
            status: { notIn: ['Solucionado', 'solucionado', 'Resolvida', 'resolvida'] },
          },
        });

        return {
          debts: { count: fins.length, total: debtsTotal },
          occurrences: occurrencesCount,
        };
      } catch (e) {
        return { debts: { count: 0, total: 0.0 }, occurrences: 0 };
      }
    } else {
      // Morador
      const hojeIni = new Date();
      hojeIni.setHours(0, 0, 0, 0);
      const hojeFim = new Date();
      hojeFim.setHours(23, 59, 59, 999);

      const aptoUsers = await this.prisma.apartamentos_Users.findMany({
        where: { id_user: idUser },
        select: { id_apto: true },
      });
      const aptoIds = aptoUsers.map(a => a.id_apto);

      const visitsCount = await this.prisma.visitantes.count({
        where: {
          id_apartamento: { in: aptoIds },
          is_prestador: { not: 1 },
          OR: [
            {
              data_entrada: { not: null },
              data_saida: null,
            },
            {
              data_entrada: { gte: hojeIni, lte: hojeFim },
            },
            {
              data_hora_inicio: { gte: hojeIni, lte: hojeFim },
            },
          ],
        },
      });

      const moras = await this.prisma.moradores.findMany({
        where: { id_user: idUser },
      });

      let packagesCount = 0;
      for (const m of moras) {
        if (
          m.id_condominio === null ||
          m.id_condominio === undefined ||
          m.apartamento === null ||
          m.apartamento === undefined
        ) {
          continue;
        }
        const countWhere: any = {
          id_condominio: m.id_condominio,
          destinatario_apto: m.apartamento,
          status: 'Aguardando',
        };

        if (m.bloco === null || m.bloco === undefined || m.bloco.trim() === '') {
          countWhere.OR = [
            { destinatario_bloco: null },
            { destinatario_bloco: '' }
          ];
        } else {
          countWhere.destinatario_bloco = m.bloco;
        }

        const cnt = await this.prisma.encomendas.count({
          where: countWhere,
        });
        packagesCount += cnt;
      }

      return {
        visits: visitsCount,
        packages: packagesCount,
      };
    }
  }

  // "Meus eventos" da home: acessos (entrada/saída) do próprio usuário como
  // morador + acessos dos visitantes/prestadores que ele cadastrou ou do seu
  // apartamento. Últimos 30 dias, do mais recente para o mais antigo.
  async getMeusEventos(idUser: number, limit = 15) {
    if (!this.prisma.isConnected) return [];
    const lim = Math.min(Math.max(Number(limit) || 15, 1), 50);

    const [moras, aptoUsers] = await Promise.all([
      this.prisma.moradores.findMany({ where: { id_user: idUser }, select: { id: true } }),
      this.prisma.apartamentos_Users.findMany({ where: { id_user: idUser }, select: { id_apto: true } }),
    ]);
    const moradorIds = moras.map((m) => m.id);
    const aptoIds = aptoUsers.map((a) => a.id_apto);

    const visitors = await this.prisma.visitantes.findMany({
      where: {
        OR: [
          { user: idUser },
          ...(aptoIds.length ? [{ id_apartamento: { in: aptoIds } }] : []),
        ],
      },
      select: { id: true },
    });
    const visitorIds = visitors.map((v) => v.id);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const [morEv, visEv] = await Promise.all([
      moradorIds.length
        ? this.prisma.acessos_Facial.findMany({
            where: {
              tipo_pessoa: 'morador',
              id_pessoa: { in: moradorIds },
              evento: { in: ['entrada', 'saida'] },
              timestamp: { gte: cutoff },
            },
            orderBy: { timestamp: 'desc' },
            take: 40,
          })
        : Promise.resolve([]),
      visitorIds.length
        ? this.prisma.acessos_Facial.findMany({
            where: {
              tipo_pessoa: { in: ['visitante', 'prestador'] },
              id_pessoa: { in: visitorIds },
              evento: { in: ['entrada', 'saida'] },
              timestamp: { gte: cutoff },
            },
            orderBy: { timestamp: 'desc' },
            take: 40,
          })
        : Promise.resolve([]),
    ]);

    const condIds = [...new Set([...morEv, ...visEv].map((e) => e.id_condominio))];
    const conds = condIds.length
      ? await this.prisma.condominios.findMany({
          where: { id: { in: condIds } },
          select: { id: true, nome: true },
        })
      : [];
    const condMap = new Map(conds.map((c) => [c.id, c.nome]));

    const merged = [
      ...morEv.map((e) => ({ e, categoria: 'voce' })),
      ...visEv.map((e) => ({ e, categoria: 'visitante' })),
    ];
    merged.sort((a, b) => b.e.timestamp.getTime() - a.e.timestamp.getTime());

    return merged.slice(0, lim).map(({ e, categoria }) => ({
      id: e.id,
      id_pessoa: e.id_pessoa,
      nome: (e.nome_pessoa || '').replace(/\s*\([^)]*\)\s*$/, '').trim(),
      evento: e.evento,
      tipo_pessoa: e.tipo_pessoa,
      categoria,
      condominio: condMap.get(e.id_condominio) || '',
      timestamp: e.timestamp,
    }));
  }

  /**
   * Central de notificações do app: junta num feed único tudo que interessa ao
   * usuário — encomendas, comunicados, respostas de ocorrência, contas a pagar,
   * reservas e entradas/saídas.
   *
   * É montado por agregação das tabelas de origem, sem tabela própria de
   * notificações: evita migração e mantém o feed sempre coerente com o dado
   * real (nada de aviso órfão de algo que foi apagado). O "lido" fica no app.
   */
  async getNotificacoes(idUser: number, limit = 50) {
    if (!this.prisma.isConnected) return [];
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);

    const [user, moras] = await Promise.all([
      this.prisma.users.findUnique({
        where: { id: idUser },
        select: {
          notif_encomendas: true,
          notif_comunicados: true,
          notif_ocorrencias: true,
          notif_visitantes: true,
        },
      }),
      this.prisma.moradores.findMany({ where: { id_user: idUser } }),
    ]);

    const quer = (flag: number | undefined | null) => flag !== 0;
    const condIds = [
      ...new Set(moras.map((m) => m.id_condominio).filter((v): v is number => v != null)),
    ];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    type Item = {
      id: string;
      tipo: string;
      titulo: string;
      descricao: string;
      timestamp: Date;
    };
    const itens: Item[] = [];

    // --- Solicitações de autorização pendentes (Portaria Remota) ---
    //
    // O id do apartamento vem de Apartamentos_Users, não de Moradores: lá o
    // campo `apartamento` é texto ("101"), não a chave. É por Apartamentos_Users
    // que o resto do sistema resolve esse vínculo.
    const vinculosApto = await this.prisma.apartamentos_Users.findMany({
      where: { id_user: idUser },
      select: { id_apto: true },
    });
    const aptoIds = [
      ...new Set(vinculosApto.map((v) => v.id_apto).filter((id): id is number => id != null)),
    ];
    if (aptoIds.length) {
      const pendentes = await this.prisma.visitantes.findMany({
        where: {
          id_apartamento: { in: aptoIds },
          auth_status: 'pendente',
        },
        take: 10,
      });
      for (const p of pendentes) {
        itens.push({
          id: `solicitacao-${p.id}`,
          tipo: 'solicitacao',
          titulo: 'Solicitação de Entrada na Portaria',
          descricao: `${p.nome} aguarda sua autorização na portaria para entrar.`,
          // `data_visita` não existe em Visitantes; a janela da visita começa
          // em data_hora_inicio.
          timestamp: p.auth_solicitado_em || p.data_hora_inicio || new Date(),
        });
      }
    }

    // --- Encomendas endereçadas ao apto/bloco do morador ---
    if (quer(user?.notif_encomendas)) {
      const wheres = moras
        .filter((m) => m.id_condominio != null && m.apartamento != null)
        .map((m) => {
          const w: any = {
            id_condominio: m.id_condominio,
            destinatario_apto: m.apartamento,
          };
          if (!m.bloco || m.bloco.trim() === '') {
            w.OR = [{ destinatario_bloco: null }, { destinatario_bloco: '' }];
          } else {
            w.destinatario_bloco = m.bloco;
          }
          return w;
        });

      if (wheres.length) {
        const encomendas = await this.prisma.encomendas.findMany({
          where: { OR: wheres, created_at: { gte: cutoff } },
          orderBy: { created_at: 'desc' },
          take: 20,
        });
        for (const e of encomendas) {
          const retirada = (e.status || '').toLowerCase() === 'retirada';
          itens.push({
            id: `encomenda-${e.id}`,
            tipo: 'encomenda',
            titulo: retirada ? 'Encomenda retirada' : 'Encomenda recebida',
            descricao: retirada
              ? `${e.descricao} foi retirada.`
              : `${e.descricao} chegou e está aguardando retirada.`,
            timestamp: e.created_at,
          });
        }
      }
    }

    // --- Comunicados do(s) condomínio(s) ---
    if (quer(user?.notif_comunicados) && condIds.length) {
      const comunicados = await this.prisma.comunicados.findMany({
        where: { id_condominio: { in: condIds }, created_at: { gte: cutoff } },
        orderBy: { created_at: 'desc' },
        take: 20,
      });
      for (const c of comunicados) {
        itens.push({
          id: `comunicado-${c.id}`,
          tipo: 'comunicado',
          titulo: c.titulo,
          descricao: (c.descricao || '').replace(/<[^>]*>/g, '').trim(),
          timestamp: c.created_at,
        });
      }
    }

    // --- Ocorrências do usuário que já foram respondidas ---
    if (quer(user?.notif_ocorrencias)) {
      const ocorrencias = await this.prisma.ocorrencias.findMany({
        where: { user: idUser, resposta_at: { not: null, gte: cutoff } },
        orderBy: { resposta_at: 'desc' },
        take: 20,
      });
      for (const o of ocorrencias) {
        itens.push({
          id: `ocorrencia-${o.id}`,
          tipo: 'ocorrencia',
          titulo: 'Ocorrência respondida',
          descricao: (o.resposta || '').trim(),
          timestamp: o.resposta_at as Date,
        });
      }
    }

    // --- Contas em aberto: vencidas e a vencer nos próximos 7 dias ---
    const limiteVencimento = new Date();
    limiteVencimento.setDate(limiteVencimento.getDate() + 7);
    const contas = await this.prisma.financeiro.findMany({
      where: {
        id_usuario: idUser,
        pago: 0,
        data_vencimento: { not: null, lte: limiteVencimento },
      },
      orderBy: { data_vencimento: 'asc' },
      take: 20,
    });
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    for (const f of contas) {
      const venc = f.data_vencimento as Date;
      const vencida = venc < hoje;
      const valor = Number(f.valor ?? 0).toFixed(2).replace('.', ',');
      itens.push({
        id: `financeiro-${f.id}`,
        tipo: 'financeiro',
        titulo: vencida ? 'Conta vencida' : 'Conta a vencer',
        descricao: `${f.nome ?? 'Cobrança'} — R$ ${valor}`,
        timestamp: venc,
      });
    }

    // --- Reservas de áreas comuns ---
    const reservas = await this.prisma.areas_Sociais_Agendamentos.findMany({
      where: { id_user: idUser, updated_at: { gte: cutoff } },
      orderBy: { updated_at: 'desc' },
      include: { area: { select: { nome: true } } },
      take: 20,
    });
    for (const r of reservas) {
      const st = (r.status || '').toLowerCase();
      const rotulo =
        st === 'aprovado' || st === 'aprovada'
          ? 'Reserva aprovada'
          : st === 'recusado' || st === 'recusada'
            ? 'Reserva recusada'
            : 'Reserva registrada';
      const dia = r.data ? new Date(r.data).toLocaleDateString('pt-BR') : '';
      itens.push({
        id: `reserva-${r.id}`,
        tipo: 'reserva',
        titulo: rotulo,
        descricao: `${r.area?.nome ?? 'Área comum'}${dia ? ` — ${dia}` : ''}`,
        timestamp: r.updated_at,
      });
    }

    // --- Entradas e saídas (reaproveita o feed de acessos já existente) ---
    if (quer(user?.notif_visitantes)) {
      const eventos = await this.getMeusEventos(idUser, 20);
      for (const e of eventos as any[]) {
        const entrou = e.evento === 'entrada';
        const souEu = e.categoria === 'voce';
        itens.push({
          id: `acesso-${e.id}`,
          tipo: 'acesso',
          titulo: entrou ? 'Entrada registrada' : 'Saída registrada',
          descricao: souEu
            ? `Você ${entrou ? 'entrou' : 'saiu'} no condomínio.`
            : `${e.nome} ${entrou ? 'entrou' : 'saiu'}.`,
          timestamp: e.timestamp,
        });
      }
    }

    itens.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return itens.slice(0, lim);
  }

  // Exclusão de conta (LGPD / requisito Play Store): apaga o usuário logado e,
  // por cascata de FK no banco, seus dados vinculados (morador/síndico, veículos,
  // vagas, etc.). Escopo estrito por id do JWT — remove apenas a própria conta.
  async deleteAccount(idUser: number) {
    if (!this.prisma.isConnected) return { success: true };
    if (!idUser || Number.isNaN(idUser)) {
      return { success: false, message: 'Usuário inválido' };
    }
    // Login web de funcionário (Funcionarios_Portaria) não tem FK para Users;
    // remove pelo e-mail do usuário para não deixar acesso órfão.
    const user = await this.prisma.users.findUnique({
      where: { id: idUser },
      select: { login: true, email: true },
    });
    const emails = [user?.login, user?.email].filter((e): e is string => !!e);
    if (emails.length > 0) {
      await this.prisma.funcionarios_Portaria.deleteMany({
        where: { login: { in: emails } },
      });
    }
    await this.prisma.$executeRaw`DELETE FROM Users WHERE id = ${idUser}`;
    return { success: true };
  }

  // ==========================================
  // PUSH / FCM
  // ==========================================

  /**
   * Registra o aparelho do usuário logado para receber push.
   *
   * Chamado pelo app na abertura e após qualquer login. Sem isso o usuário
   * não recebe nada — inclusive a autorização de portaria remota, que depende
   * da notificação chegar no morador para ele liberar ou negar a entrada.
   *
   * Um usuário pode ter VÁRIOS aparelhos (`Users_Devices`), e é isso que faz
   * celular e tablet — ou Android e iPhone — receberem os dois. Antes havia só
   * `Users.fcm_token`, um por usuário, e o último aparelho a abrir o app
   * silenciava o outro.
   *
   * Um token, porém, pertence a um aparelho só: se o celular troca de dono
   * (o porteiro sai, o morador entra), o registro MIGRA para o novo usuário,
   * senão a notificação do novo continuaria caindo na conta antiga.
   */
  async updateFcmToken(idUser: number, fcmToken: string, plataforma?: string) {
    if (!this.prisma.isConnected) return { success: true };
    if (!idUser || Number.isNaN(idUser)) {
      throw new BadRequestException('Usuário inválido');
    }
    const token = (fcmToken ?? '').trim();
    if (!token) {
      throw new BadRequestException('FCM Token é obrigatório');
    }

    // O token é único na tabela: o upsert é o que migra o aparelho de dono.
    await this.prisma.users_Devices.upsert({
      where: { fcm_token: token },
      create: { id_user: idUser, fcm_token: token, plataforma: plataforma ?? null },
      update: { id_user: idUser, plataforma: plataforma ?? undefined },
    });

    // Remove tokens antigos/desconectados deste usuário
    if (this.prisma.users_Devices?.deleteMany) {
      await this.prisma.users_Devices.deleteMany({
        where: { id_user: idUser, fcm_token: { not: token } },
      }).catch(() => {});
    }

    // `Users.fcm_token` continua recebendo o token mais recente porque é o que
    // os pontos de envio leem; o alcance aos demais aparelhos vem do fan-out
    // no NotificationsService, a partir de Users_Devices.
    await this.prisma.users.updateMany({
      where: { fcm_token: token, id: { not: idUser } },
      data: { fcm_token: null },
    });
    await this.prisma.users.update({
      where: { id: idUser },
      data: { fcm_token: token },
    });
    return { success: true };
  }

  /**
   * Remove o registro do aparelho (logout / encerramento de sessão).
   * Impede que notificações continuem chegando após o logout.
   */
  async removeFcmToken(idUser: number, fcmToken?: string) {
    if (!this.prisma.isConnected) return { success: true };
    const token = (fcmToken ?? '').trim();
    if (token) {
      await this.prisma.users_Devices.deleteMany({
        where: { fcm_token: token },
      });
      await this.prisma.users.updateMany({
        where: { fcm_token: token },
        data: { fcm_token: null },
      });
    }
    if (idUser && !Number.isNaN(idUser)) {
      if (!token) {
        await this.prisma.users_Devices.deleteMany({
          where: { id_user: idUser },
        });
      }
      await this.prisma.users.update({
        where: { id: idUser },
        data: { fcm_token: null },
      });
    }
    return { success: true };
  }

  /**
   * Testa o push do usuário logado e devolve o que o FCM respondeu por
   * aparelho, sem esconder erro. Usado para separar "não registrou o token"
   * de "registrou mas a entrega falha".
   */
  async diagnosticarPush(idUser: number) {
    if (!this.prisma.isConnected) return { erro: 'Banco indisponível' };

    const user = await this.prisma.users.findUnique({
      where: { id: idUser },
      select: { id: true, login: true, fcm_token: true },
    });
    const devices = await this.prisma.users_Devices.findMany({
      where: { id_user: idUser },
      select: { fcm_token: true, plataforma: true, updated_at: true },
    });

    // Une o token da coluna antiga com os da tabela: um aparelho que registrou
    // antes do deploy novo só existe na coluna.
    const tokens = new Map<string, string | null>();
    for (const d of devices) tokens.set(d.fcm_token, d.plataforma);
    if (user?.fcm_token) if (!tokens.has(user.fcm_token)) tokens.set(user.fcm_token, '(coluna Users)');

    if (tokens.size === 0) {
      return {
        usuario: user?.login,
        aparelhos: 0,
        aviso: 'Nenhum token registrado: o app não chegou a se registrar neste usuário.',
      };
    }

    const resultados = [];
    for (const [token, plataforma] of tokens) {
      const r = await this.notifications.enviarDiagnostico(
        token,
        'Teste do Click',
        'Se você está vendo isto, o push chegou.',
      );
      resultados.push({ plataforma, token: `...${token.slice(-12)}`, ...r });
    }
    return { usuario: user?.login, aparelhos: tokens.size, resultados };
  }

  /**
   * Preferências de notificação do usuário logado.
   *
   * Devolve 1/0 (não booleano) de propósito: a tela do app compara
   * `data['notif_encomendas'] == 1`, então booleano viria como desligado.
   */
  async getNotificationSettings(idUser: number) {
    const padrao = {
      notif_encomendas: 1,
      notif_comunicados: 1,
      notif_ocorrencias: 1,
      notif_visitantes: 1,
    };
    if (!this.prisma.isConnected) return padrao;
    if (!idUser || Number.isNaN(idUser)) {
      throw new BadRequestException('Usuário inválido');
    }
    const u = await this.prisma.users.findUnique({
      where: { id: idUser },
      select: {
        notif_encomendas: true,
        notif_comunicados: true,
        notif_ocorrencias: true,
        notif_visitantes: true,
      },
    });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    return {
      notif_encomendas: u.notif_encomendas ?? 1,
      notif_comunicados: u.notif_comunicados ?? 1,
      notif_ocorrencias: u.notif_ocorrencias ?? 1,
      notif_visitantes: u.notif_visitantes ?? 1,
    };
  }

  async updateNotificationSettings(
    idUser: number,
    prefs: {
      notif_encomendas?: boolean;
      notif_comunicados?: boolean;
      notif_ocorrencias?: boolean;
      notif_visitantes?: boolean;
    },
  ) {
    if (!this.prisma.isConnected) return { success: true };
    if (!idUser || Number.isNaN(idUser)) {
      throw new BadRequestException('Usuário inválido');
    }
    const flag = (v: unknown) => (v === true || v === 1 || v === '1' ? 1 : 0);
    await this.prisma.users.update({
      where: { id: idUser },
      data: {
        ...(prefs.notif_encomendas !== undefined && {
          notif_encomendas: flag(prefs.notif_encomendas),
        }),
        ...(prefs.notif_comunicados !== undefined && {
          notif_comunicados: flag(prefs.notif_comunicados),
        }),
        ...(prefs.notif_ocorrencias !== undefined && {
          notif_ocorrencias: flag(prefs.notif_ocorrencias),
        }),
        ...(prefs.notif_visitantes !== undefined && {
          notif_visitantes: flag(prefs.notif_visitantes),
        }),
      },
    });
    return { success: true };
  }

  // ==========================================
  // CONDOMÍNIO DETALHES GERAL
  // ==========================================
  async getCondominioById(id: number, user?: JwtPayload) {
    // FORA do try: o catch abaixo devolve mockCond em qualquer erro, e engoliria
    // o 403 — o chamador receberia 200 com dados fictícios em vez do bloqueio.
    await this.tenant.assertCondominio(Number(id), user);

    const mockCond = {
      id: id || 1,
      nome: 'Condomínio Demo - Click Prestare',
      saldo: '15.500,00',
      photo: '',
      num_aptos: 40,
      num_blocos: 2,
      moeda: 'R$',
      identificacao: '12.345.678/0001-90',
      subsindico_nome: 'Subsíndico Demo',
      liberado_exclusao: 0,
    };

    if (!this.prisma.isConnected) {
      return mockCond;
    }

    try {
      const c = await this.prisma.condominios.findUnique({
        where: { id: Number(id) },
        include: {
          apartamentos: true,
          enderecoRel: true,
        },
      });

      if (!c) return mockCond;

      // O saldo do card do dashboard é o MESMO que a tela de Financeiro do
      // condomínio mostra — por isso vem de getAll, e não de uma soma própria.
      //
      // A soma anterior pegava todo lançamento pago de todos os tempos,
      // inclusive taxa de morador e conta pessoal, então o card exibia um
      // numero que nao existia em tela nenhuma. Sem mês, getAll assume o
      // último com movimento, que é o mesmo padrão da tela.
      // Repassa o user: o getAll revalida o vínculo por conta própria, então o
      // saldo nunca sai daqui sem ter passado por uma checagem de tenant.
      const financeiro = await this.financeiro.getAll(Number(id), undefined, undefined, true, user);
      const saldoStr = (financeiro?.saldo ?? '')
        .toString()
        // getAll ja devolve formatado ("R$ 1.234,56"); o app remonta com a
        // moeda do condomínio, entao aqui vai so o numero.
        .replace(/[^\d.,-]/g, '')
        .trim();

      return {
        id: c.id,
        nome: c.nome,
        saldo: saldoStr,
        photo: c.photo ?? '',
        num_aptos: c.apartamentos?.length ?? c.num_aptos ?? 40,
        num_blocos: c.num_blocos ?? 2,
        moeda: c.moeda ?? 'R$',
        identificacao: c.identificacao ?? '',
        subsindico_nome: c.subsindico_nome ?? '',
        liberado_exclusao: c.liberado_exclusao ?? 0,
        cidade: c.enderecoRel?.cidade ?? 'São Paulo',
        uf: c.enderecoRel?.uf ?? 'SP',
      };
    } catch (e) {
      return mockCond;
    }
  }

  async registerCondominio(body: any, idUser: number) {
    const data = body.condominio || {};
    const addr = body.address || {};

    const nome = data.nome || 'Novo Condomínio';
    const identificacao = data.identificacao || '';

    try {
      if (this.prisma.isConnected) {
        // 1. Criar Endereço se houver dados
        let idEndereco = null;
        if (addr.cep || addr.rua) {
          const e = await this.prisma.endereco.create({
            data: {
              cep: addr.cep,
              rua: addr.rua,
              numero: String(addr.numero || ''),
              complemento: addr.complemento,
              bairro: addr.bairro,
              cidade: addr.cidade,
              uf: addr.uf,
              pais: addr.pais,
            }
          });
          idEndereco = e.id;
        }

        // 2. Criar Condomínio
        const c = await this.prisma.condominios.create({
          data: {
            nome: nome,
            identificacao: identificacao,
            subsindico_nome: data.subsindico_nome,
            num_blocos: Number(data.num_blocos) || 1,
            num_aptos: Number(data.num_aptos) || 0,
            moeda: 'BRL',
            ativo: 1,
            endereco: idEndereco,
          }
        });

        // 3. Vincular o usuário como síndico desse condomínio
        await this.prisma.sindicos_Condominios.create({
          data: {
            id_user: idUser,
            id_condominio: c.id,
          }
        });

        return { success: true, id: c.id, nome: c.nome };
      }
    } catch (e) {
      console.error('Erro ao registrar condomínio:', e);
    }

    return { success: true, id: Date.now(), nome: nome };
  }

  private parsePtBrDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const day = Number(parts[0]);
      const month = Number(parts[1]) - 1;
      const year = Number(parts[2]);
      return new Date(year, month, day);
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  async getInfosCondominio(id: number) {
    if (!this.prisma.isConnected) {
      return {
        nome: 'Condomínio Demo - Click Prestare',
        identificacao: '12.345.678/0001-90',
        subsindico_nome: 'Subsíndico Demo',
        photo: '',
        data_inicio_mandato: '01/01/2026',
        data_termino_mandato: '31/12/2027',
      };
    }
    const c = await this.prisma.condominios.findUnique({
      where: { id },
      select: {
        nome: true,
        identificacao: true,
        subsindico_nome: true,
        photo: true,
        data_inicio_mandato: true,
        data_termino_mandato: true,
      },
    });
    if (!c) return null;
    return {
      nome: c.nome,
      identificacao: c.identificacao ?? '',
      subsindico_nome: c.subsindico_nome ?? '',
      photo: c.photo ?? '',
      data_inicio_mandato: c.data_inicio_mandato ? c.data_inicio_mandato.toLocaleDateString('pt-BR') : '',
      data_termino_mandato: c.data_termino_mandato ? c.data_termino_mandato.toLocaleDateString('pt-BR') : '',
    };
  }

  async getAddressCondominio(idCondominio: number) {
    if (!this.prisma.isConnected) {
      return {
        cep: '01001-000',
        pais: 'Brasil',
        uf: 'SP',
        cidade: 'São Paulo',
        bairro: 'Sé',
        rua: 'Praça da Sé',
        numero: '100',
        complemento: 'Lado Par',
      };
    }
    const c = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: {
        enderecoRel: {
          select: {
            cep: true,
            pais: true,
            uf: true,
            cidade: true,
            bairro: true,
            rua: true,
            numero: true,
            complemento: true,
          },
        },
      },
    });
    return c?.enderecoRel ?? null;
  }

  async updateInfosCondominio(body: any, user?: JwtPayload) {
    const data = body.condominio || {};
    const id = Number(data.id);
    if (!id) throw new BadRequestException('ID do condomínio é obrigatório.');
    assertSindico(user, 'editar dados do condomínio');
    await this.tenant.assertCondominio(id, user);

    if (!this.prisma.isConnected) return { success: true };

    let photoUrl = data.photo;
    if (photoUrl && this.storage.isDataUrl(photoUrl)) {
      photoUrl = await this.storage.uploadDataUrl(photoUrl, `condominios/${id}`, 'profile');
    }

    const updateData: any = {};
    if (data.nome !== undefined) updateData.nome = data.nome;
    if (data.identificacao !== undefined) updateData.identificacao = data.identificacao;
    if (data.subsindico_nome !== undefined) updateData.subsindico_nome = data.subsindico_nome;
    if (data.inicio_mandato !== undefined) updateData.data_inicio_mandato = this.parsePtBrDate(data.inicio_mandato);
    if (data.termino_mandato !== undefined) updateData.data_termino_mandato = this.parsePtBrDate(data.termino_mandato);
    if (photoUrl !== undefined) updateData.photo = photoUrl;

    await this.prisma.condominios.update({
      where: { id },
      data: updateData,
    });

    return { success: true };
  }

  async updateAddressCondominio(body: any, user?: JwtPayload) {
    const addr = body.address || {};
    const idCondominio = Number(addr.idCondominio);
    if (!idCondominio) throw new BadRequestException('ID do condomínio é obrigatório.');
    assertSindico(user, 'editar endereço do condomínio');
    await this.tenant.assertCondominio(idCondominio, user);

    if (!this.prisma.isConnected) return { success: true };

    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { endereco: true },
    });

    if (!cond) throw new NotFoundException('Condomínio não encontrado.');

    const updateData = {
      cep: addr.cep,
      rua: addr.rua,
      numero: String(addr.numero ?? ''),
      complemento: addr.complemento,
      bairro: addr.bairro,
      cidade: addr.cidade,
      uf: addr.uf,
      pais: addr.pais,
    };

    if (cond.endereco) {
      await this.prisma.endereco.update({
        where: { id: cond.endereco },
        data: updateData,
      });
    } else {
      const e = await this.prisma.endereco.create({
        data: updateData,
      });
      await this.prisma.condominios.update({
        where: { id: idCondominio },
        data: { endereco: e.id },
      });
    }

    return { success: true };
  }

  async updateMoedaCondominio(body: any, user?: JwtPayload) {
    const data = body.condominio || {};
    const id = Number(data.id);
    if (!id) throw new BadRequestException('ID do condomínio é obrigatório.');
    assertSindico(user, 'editar moeda do condomínio');
    await this.tenant.assertCondominio(id, user);

    if (!this.prisma.isConnected) return { success: true };

    await this.prisma.condominios.update({
      where: { id },
      data: { moeda: data.moeda },
    });

    return { success: true };
  }

  async updateAssinaturaCondominio(body: any, idUser: number, requester?: JwtPayload) {
    const data = body.assinatura || {};
    const idCondominio = Number(data.id_condominio);
    const idPlano = data.id_plano;
    const codigo = data.codigo || '';
    const plataforma = data.plataforma || 'Mobile';

    if (!idCondominio) throw new BadRequestException('ID do condomínio é obrigatório.');
    if (!idPlano) throw new BadRequestException('ID/Nome do plano é obrigatório.');
    assertSindico(requester, 'editar assinatura do condomínio');
    await this.tenant.assertCondominio(idCondominio, requester);

    if (!this.prisma.isConnected) return { success: true };

    const cond = await this.prisma.condominios.findUnique({
      where: { id: idCondominio },
      select: { vencimento: true },
    });

    if (!cond) throw new NotFoundException('Condomínio não encontrado.');

    const plano = await this.prisma.planos.findFirst({
      where: { nome: idPlano },
    });
    if (!plano) throw new NotFoundException('Plano não encontrado.');

    const user = await this.prisma.users.findUnique({
      where: { id: idUser },
      select: { login: true },
    });

    const vencimento_atual = cond.vencimento;
    const dias_restantes = vencimento_atual ? Math.ceil((vencimento_atual.getTime() - Date.now()) / 86400000) : 0;

    let novoVencimento: Date;
    if (dias_restantes > 0 && vencimento_atual) {
      novoVencimento = new Date(vencimento_atual);
      novoVencimento.setDate(novoVencimento.getDate() + plano.dias);
    } else {
      novoVencimento = new Date();
      novoVencimento.setDate(novoVencimento.getDate() + plano.dias);
    }

    await this.prisma.condominios.update({
      where: { id: idCondominio },
      data: { vencimento: novoVencimento },
    });

    await this.prisma.assinaturas_Condominios.create({
      data: {
        id_condominio: idCondominio,
        email_user: user?.login ?? null,
        codigo: codigo,
        data_ini: dias_restantes > 0 && vencimento_atual ? new Date(vencimento_atual.getTime() + 86400000) : new Date(),
        data_fim: novoVencimento,
        dias: plano.dias,
        plano: plano.nome,
        plataforma: plataforma,
        valor: plano.valor,
      },
    });

    return { success: true };
  }


  // ==========================================
  // RECUPERAÇÃO DE SENHA
  // ==========================================
  private gerarNovaSenha(): string {
    return randomBytes(4).toString('hex'); // 8 chars alfanumérico
  }

  async recoveryPasswordSindico(email: string) {
    const user = await this.prisma.users.findFirst({
      where: { login: email },
      include: { sindicos: true },
    });
    if (!user || !user.sindicos || user.sindicos.length === 0) {
      throw new NotFoundException('E-mail não encontrado');
    }
    const novaSenha = this.gerarNovaSenha();
    const hash = await bcrypt.hash(novaSenha, 10);
    await this.prisma.users.update({ where: { id: user.id }, data: { password: hash } });
    await this.mail.sendForgotPassword(email, novaSenha, 'Síndico');
    return { success: true };
  }

  async recoveryPasswordMorador(email: string) {
    const morador = await this.prisma.moradores.findFirst({ where: { email } });
    if (!morador) throw new NotFoundException('E-mail não encontrado');
    const user = await this.prisma.users.findFirst({ where: { login: email } });
    if (!user) throw new NotFoundException('E-mail não encontrado');
    const novaSenha = this.gerarNovaSenha();
    const hash = await bcrypt.hash(novaSenha, 10);
    await this.prisma.users.update({ where: { id: user.id }, data: { password: hash } });
    await this.mail.sendForgotPassword(email, novaSenha, 'Morador');
    return { success: true };
  }

  async recoveryPasswordFuncionario(email: string) {
    const func = await this.prisma.funcionarios_Portaria.findFirst({ where: { login: email } });
    if (!func) throw new NotFoundException('E-mail não encontrado');
    const novaSenha = this.gerarNovaSenha();
    // bcrypt, nao MD5: o login ja aceita os dois (migra sozinho quando o hash
    // antigo bate), mas gravar MD5 aqui recriava o problema a cada
    // recuperacao de senha.
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await this.prisma.funcionarios_Portaria.update({ where: { id: func.id }, data: { password: senhaHash } });
    await this.mail.sendForgotPassword(email, novaSenha, 'Funcionário');
    return { success: true };
  }

  // ==========================================
  // FUNCIONÁRIOS DE PORTARIA (MOBILE) — persistência real
  // ==========================================

  async getAllFuncionarios(idCond: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCond, user);
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const reais = await this.prisma.funcionarios_Portaria.findMany({
      where: { id_condominio: Number(idCond), ativo: 1 },
      orderBy: { nome: 'asc' },
    });
    
    const logins = reais.map(f => f.login).filter(Boolean);
    const users = await this.prisma.users.findMany({
      where: { login: { in: logins } },
      select: { id: true, login: true, photo: true }
    });
    const userPhotoMap = new Map(users.map(u => [u.login, u.photo]));
    // id_user (Users.id) é usado como responsável de ocorrências (mini-helpdesk).
    const userIdMap = new Map(users.map(u => [u.login, u.id]));

    return reais.map(f => ({
      id: f.id,
      id_user: userIdMap.get(f.login) ?? null,
      nome: f.nome ?? '',
      documento: '',
      email: f.email ?? f.login ?? '',
      telefone: f.telefone ?? '',
      funcao: f.turno ? `Porteiro ${f.turno}` : 'Porteiro',
      cargo: f.turno ? `Porteiro ${f.turno}` : 'Porteiro',
      ch: f.turno ?? '',
      photo: userPhotoMap.get(f.login) ?? '',
      hasPortariaAccess: true,
    }));
  }

  async getFuncionarioById(id: number, requester?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }

    // Quando quem pergunta é o próprio funcionário, o `id` da query é ignorado
    // e devolvemos o cadastro dele. É o que a tela "Editar meus dados" do app
    // espera: ela chama /funcionarios/get?id=0 sem saber o próprio id.
    // (Sem isso, o findUnique com id=0 devolvia 404 e a tela não abria.)
    const tipo = requester?.typeAccess ?? requester?.user?.typeAccess;
    if (tipo === 'Funcionario') {
      return this.getMeuCadastroFuncionario(requester);
    }

    const f = await this.prisma.funcionarios_Portaria.findUnique({ where: { id: Number(id) } });
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    await this.tenant.assertEntidade(f.id_condominio, requester, `funcionário #${id}`);
    const user = await this.prisma.users.findFirst({
      where: { login: f.login },
      select: { photo: true }
    });
    return {
      id: f.id,
      nome: f.nome ?? '',
      documento: '',
      email: f.email ?? f.login ?? '',
      telefone: f.telefone ?? '',
      funcao: f.turno ? `Porteiro ${f.turno}` : 'Porteiro',
      ch: f.turno ?? '',
      photo: user?.photo ?? '',
      hasPortariaAccess: true,
    };
  }

  /** Cadastro do funcionário logado (tabela Funcionarios, do app). */
  private async getMeuCadastroFuncionario(requester?: JwtPayload) {
    const idUser = Number(requester?.user?.id ?? requester?.sub);
    if (!idUser || Number.isNaN(idUser)) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    const f = await this.prisma.funcionarios.findFirst({
      where: { id_user: idUser },
      include: { user: { select: { photo: true, email: true } } },
    });
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    return {
      id: f.id_user,
      nome: f.nome ?? '',
      documento: f.documento ?? '',
      email: f.email ?? f.user?.email ?? '',
      telefone: f.telefone ?? '',
      funcao: f.funcao ?? '',
      ch: f.ch ?? '',
      photo: f.user?.photo ?? '',
    };
  }

  /**
   * Funcionário editando o PRÓPRIO perfil (nome, documento, e-mail, telefone,
   * foto). Diferente de saveFuncionario, que é gestão de porteiros e exige
   * síndico — aqui o alvo é sempre quem está no JWT, nunca um id do corpo.
   *
   * Devolve token+user novos porque o login do app é o e-mail: se ele mudar,
   * o token antigo continuaria apontando para o login velho.
   */
  async updateInfosFuncionario(body: any, requester?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const idUser = Number(requester?.user?.id ?? requester?.sub);
    if (!idUser || Number.isNaN(idUser)) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const func = body?.funcionario ?? body?.funcionarios ?? {};
    const atual = await this.prisma.funcionarios.findFirst({
      where: { id_user: idUser },
    });
    if (!atual) throw new NotFoundException('Funcionário não encontrado.');

    const email = func.email ? String(func.email).trim() : null;
    if (email) {
      const conflito = await this.prisma.users.findFirst({
        where: { OR: [{ email }, { login: email }], NOT: { id: idUser } },
        select: { id: true },
      });
      if (conflito) throw new BadRequestException('Já existe outro usuário com este e-mail.');
    }

    let photoUrl: string | null = null;
    if (func.photo) {
      photoUrl = this.storage.isDataUrl(func.photo)
        ? await this.storage.uploadDataUrl(func.photo, 'funcionarios')
        : func.photo;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.funcionarios.update({
        where: { id: atual.id },
        data: {
          ...(func.nome !== undefined && { nome: func.nome }),
          ...(func.documento !== undefined && { documento: func.documento || null }),
          ...(email !== null && { email }),
          ...(func.telefone !== undefined && { telefone: func.telefone || null }),
        },
      });
      await tx.users.update({
        where: { id: idUser },
        data: {
          ...(func.nome !== undefined && { name: func.nome }),
          ...(func.documento !== undefined && { cpf: func.documento || null }),
          ...(email !== null && { email, login: email }),
          ...(func.telefone !== undefined && { phone: func.telefone || null }),
          ...(photoUrl !== null && { photo: photoUrl, profile_image: photoUrl }),
        },
      });
    });

    // Reemite a sessão com os dados atualizados (mesmo shape do loginFuncionario,
    // que é o que o storageFuncionario do app consome).
    const user = await this.prisma.users.findUnique({
      where: { id: idUser },
      include: { funcionarios: true },
    });
    const f = user?.funcionarios?.[0];
    const userObj = {
      id: idUser,
      nome: f?.nome ?? func.nome ?? '',
      photo: user?.photo ?? '',
      areas_sociais: f?.areas_sociais ?? 0,
      comunicados: f?.comunicados ?? 0,
      ocorrencias: f?.ocorrencias ?? 0,
      manutencoes_programadas: f?.manutencoes_programadas ?? 0,
      prestadores_servico: f?.prestadores_servico ?? 0,
      agendar_mudanca: f?.agendar_mudanca ?? 0,
      cadastrar_visitante: f?.cadastrar_visitante ?? 0,
      apartamentos: f?.apartamentos ?? 0,
    };
    const payload = {
      sub: idUser,
      nome: userObj.nome,
      typeAccess: 'Funcionario',
      user: userObj,
    };
    return { token: this.jwt.sign(payload, { expiresIn: '365d' }), user: userObj };
  }

  async saveFuncionario(body: any, isEdit: boolean, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    // Gerenciar porteiro/funcionário é exclusivo de síndico — um porteiro
    // não deveria conseguir criar/editar outro porteiro (nem de si mesmo).
    assertSindico(user, 'gerenciar funcionários');
    const func = body.funcionario || body.funcionarios || {};
    const idCondominio = Number(body.id_condominio);

    let photoUrl: string | null = null;
    if (func.photo) {
      if (this.storage.isDataUrl(func.photo)) {
        photoUrl = await this.storage.uploadDataUrl(func.photo, 'funcionarios');
      } else {
        photoUrl = func.photo;
      }
    }

    // Função auxiliar para sincronizar com as tabelas de Users e Funcionarios do app mobile
    const sincronizarUsuarioMobile = async (fp: any, senhaPlana?: string, uploadedPhotoUrl?: string | null) => {
      try {
        let user = await this.prisma.users.findFirst({ where: { login: fp.login } });
        // Se veio senha em texto, grava em bcrypt. Sem senha nova, reaproveita
        // o hash ja armazenado (que pode ser legado — o login migra no acesso).
        const senhaHash = senhaPlana ? await bcrypt.hash(senhaPlana, 10) : fp.password;

        if (!user) {
          user = await this.prisma.users.create({
            data: {
              login: fp.login,
              email: fp.email || fp.login,
              password: senhaHash,
              name: fp.nome,
              phone: fp.telefone,
              is_funcionario: 1,
              is_sindico: 0,
              is_morador: 0,
              photo: uploadedPhotoUrl ?? null,
              profile_image: uploadedPhotoUrl ?? null,
            }
          });
        } else {
          // Não sobrescreve a senha de um usuário que já possui credenciais próprias
          // (ex.: síndico ou morador com o mesmo e-mail). A senha do porteiro é
          // gerenciada pela tabela Funcionarios_Portaria; aqui só garantimos que o
          // vínculo mobile (is_funcionario + Funcionarios) existe.
          const patch: any = {
            name: fp.nome,
            phone: fp.telefone,
            email: fp.email || fp.login,
            is_funcionario: 1,
            ...(uploadedPhotoUrl !== undefined && { photo: uploadedPhotoUrl, profile_image: uploadedPhotoUrl }),
          };
          // Só atualiza a senha se o usuário ainda não tem uma definida
          if (!user.password) patch.password = senhaHash;
          await this.prisma.users.update({ where: { id: user.id }, data: patch });
        }

        const f = await this.prisma.funcionarios.findFirst({ where: { id_user: user.id } });
        if (!f) {
          await this.prisma.funcionarios.create({
            data: {
              nome: fp.nome,
              email: fp.email || fp.login,
              telefone: fp.telefone,
              funcao: 'Porteiro',
              ch: fp.turno || '',
              id_user: user.id,
              id_condominio: fp.id_condominio,
              areas_sociais: 1,
              comunicados: 1,
              ocorrencias: 1,
              manutencoes_programadas: 1,
              prestadores_servico: 1,
              agendar_mudanca: 1,
              cadastrar_visitante: 1,
              apartamentos: 1,
            }
          });
        } else {
          await this.prisma.funcionarios.update({
            where: { id: f.id },
            data: {
              nome: fp.nome,
              email: fp.email || fp.login,
              telefone: fp.telefone,
              ch: fp.turno || '',
              id_condominio: fp.id_condominio,
            }
          });
        }
      } catch (err) {
        console.error('Falha ao sincronizar funcionário com tabelas mobile:', err);
      }
    };

    if (isEdit) {
      const id = Number(func.id);
      if (!id) throw new BadRequestException('ID do funcionário é obrigatório para edição.');
      const atual = await this.prisma.funcionarios_Portaria.findUnique({ where: { id } });
      if (!atual) throw new NotFoundException('Funcionário não encontrado.');
      await this.tenant.assertEntidade(atual.id_condominio, user, `funcionário #${id}`);

      const data: any = {};
      if (func.nome !== undefined) data.nome = func.nome;
      if (func.email !== undefined) data.email = func.email;
      if (func.telefone !== undefined) data.telefone = func.telefone;
      if (func.ch !== undefined || func.turno !== undefined) data.turno = func.ch ?? func.turno;
      // Se mudou o login (email), atualiza também
      if (func.email && func.email !== atual.login) {
        const conflito = await this.prisma.funcionarios_Portaria.findFirst({
          where: { login: func.email, NOT: { id } },
          select: { id: true },
        });
        if (conflito) throw new BadRequestException('Já existe outro funcionário com este e-mail.');
        data.login = func.email;
      }

      const updated = await this.prisma.funcionarios_Portaria.update({ where: { id }, data });
      await sincronizarUsuarioMobile(updated, func.senha || func.password, photoUrl);
      return '';
    }

    // Criação
    if (!idCondominio) throw new BadRequestException('id_condominio é obrigatório.');
    await this.tenant.assertCondominio(idCondominio, user);
    if (!func.nome) throw new BadRequestException('Nome é obrigatório.');
    const loginFinal = func.email || func.login;
    if (!loginFinal) throw new BadRequestException('E-mail é obrigatório para login do porteiro.');

    const conflito = await this.prisma.funcionarios_Portaria.findUnique({ where: { login: loginFinal } });
    if (conflito) throw new BadRequestException('Já existe um funcionário com este e-mail.');

    // Senha inicial = senha recebida, documento (só dígitos) ou '123456'.
    // A senha escolhida no formulário passa intacta — normalizar ali
    // destruiria uma senha com letras ou símbolos.
    const senhaInicial =
      func.senha || func.password || somenteDigitos(func.documento) || '123456';
    // Senha inicial em bcrypt. Gravar MD5 aqui era o pior caso: como o valor
    // padrao sao os digitos do documento, um hash sem sal de um numero de 11
    // digitos e reversivel em segundos por forca bruta.
    const senhaHash = await bcrypt.hash(senhaInicial, 10);

    const created = await this.prisma.funcionarios_Portaria.create({
      data: {
        nome: func.nome,
        login: loginFinal,
        password: senhaHash,
        email: func.email ?? null,
        telefone: func.telefone ?? null,
        turno: func.ch ?? func.turno ?? null,
        ativo: 1,
        id_condominio: idCondominio,
      },
    });

    await sincronizarUsuarioMobile(created, senhaInicial, photoUrl);

    return { id: created.id };
  }

  async removeFuncionario(id: number, requester?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    assertSindico(requester, 'remover funcionário');
    const fp = await this.prisma.funcionarios_Portaria.findUnique({ where: { id: Number(id) } });
    if (!fp) throw new NotFoundException('Funcionário não encontrado.');
    await this.tenant.assertEntidade(fp.id_condominio, requester, `funcionário #${id}`);
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.findFirst({ where: { login: fp.login } });
        if (user) {
          // Escopo por condomínio: sem ele, tirar a pessoa da equipe de um
          // prédio apagava o vínculo dela em TODOS os outros onde trabalha.
          // O remove de moradores já fazia esse recorte; aqui faltava.
          await tx.funcionarios.deleteMany({
            where: { id_user: user.id, id_condominio: fp.id_condominio },
          });

          // Só deleta o Users se ele não for síndico nem morador — evita destruir
          // vínculos de condomínio de contas que compartilham o mesmo e-mail.
          // E só quando não sobrou vínculo de equipe em nenhum outro prédio.
          const aindaEhFuncionario = await tx.funcionarios.count({ where: { id_user: user.id } });
          if (!user.is_sindico && !user.is_morador && aindaEhFuncionario === 0) {
            await tx.users.delete({ where: { id: user.id } });
          }
        }
        await tx.funcionarios_Portaria.delete({ where: { id: Number(id) } });
      });
    } catch (err: any) {
      // Quinta ocorrência do padrão: o catch respondia sempre "não
      // encontrado" e escondia a causa real. A existência já foi conferida.
      console.error(
        `[removeFuncionario] Falha ao excluir ${id}: ${err?.message ?? err}`,
      );
      throw new BadRequestException(
        `Não foi possível remover o funcionário. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }
    return true;
  }

  /**
   * Morador mobile só alcança apartamento a que está vinculado. Porteiro
   * (id_condominio no token), síndico e funcionário seguem alcançando
   * qualquer unidade do condomínio deles — o tenant já foi conferido antes.
   *
   * Mesma definição usada nos módulos de visitante e prestador: funcionário é
   * equipe, não morador, e a maioria não tem apartamento.
   */
  private async assertAptoDoMorador(idApto: number, payload?: JwtPayload) {
    if (!payload) return;

    const tipo = (payload.typeAccess ?? payload.user?.typeAccess ?? '').toString().toLowerCase();
    const ehMoradorMobile = !payload.id_condominio && tipo !== 'sindico' && tipo !== 'funcionario';
    if (!ehMoradorMobile) return;

    const userId = Number(payload.user?.id ?? payload.sub);
    if (!userId) throw new ForbiddenException('Acesso negado: sessão sem usuário válido.');

    const vinculo = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: userId, id_apto: Number(idApto) },
      select: { id_apto: true },
    });
    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: este apartamento não pertence a você.');
    }
  }

  async getAllMoradores(idCond: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCond, user);
    // Devolve o cadastro do predio inteiro — nome, CPF, e-mail, telefone,
    // nascimento e unidade. A tela que consome (Moradores) so aparece para o
    // sindico, mas a restricao vivia so no app: qualquer morador chamava a
    // rota e levava a lista completa com os documentos.
    assertOperador(user, 'listar os moradores do condominio');
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const reais = await this.prisma.moradores.findMany({
      where: { id_condominio: Number(idCond) },
      include: {
        user: true,
      },
      orderBy: { nome: 'asc' },
    });
    return reais.map(m => ({
      id: m.id,
      nome: m.nome ?? '',
      documento: m.documento ?? '',
      email: m.email ?? '',
      telefone: m.telefone ?? '',
      data_nascimento: m.data_nascimento ?? null,
      bloco: m.bloco ?? '',
      apartamento: m.apartamento ?? '',
      photo: m.user?.photo || m.foto_pessoa || '',
      foto_pessoa: m.foto_pessoa || m.user?.photo || '',
      vinculo: m.tipo ?? 'proprietario',
      tipo: m.tipo ?? 'proprietario',
      extra1: m.extra1 ?? '',
      extra2: m.extra2 ?? '',
      extra3: m.extra3 ?? '',
      extra4: m.extra4 ?? '',
    }));
  }

  async getMoradorById(id: number, idUser: number, idCondominio?: number, requester?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    let m;
    if (id === 0) {
      // id===0 = "meu próprio perfil" — idUser vem do JWT, não do cliente, então
      // já é inerentemente seguro (não dá pra ler o perfil de outro morador aqui).
      if (idCondominio) {
        m = await this.prisma.moradores.findFirst({
          where: { id_user: idUser, id_condominio: idCondominio },
          include: { user: true },
        });
      }
      if (!m) {
        m = await this.prisma.moradores.findFirst({
          where: { id_user: idUser },
          include: { user: true },
        });
      }
    } else {
      m = await this.prisma.moradores.findUnique({
        where: { id: Number(id) },
        include: { user: true },
      });
    }

    if (!m) throw new NotFoundException('Morador não encontrado.');
    if (Number(id) !== 0) {
      await this.tenant.assertEntidade(m.id_condominio, requester, `morador #${id}`);
      // Só o próprio morador ou a equipe (síndico/funcionário) pode ver o perfil.
      if (m.id_user !== idUser) assertStaff(requester, 'ver dados de outro morador');
    }

    // Formatar data_nascimento para DD/MM/YYYY
    let dobString = '';
    if (m.data_nascimento) {
      const d = new Date(m.data_nascimento);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      dobString = `${day}/${month}/${year}`;
    }

    return {
      id: m.id,
      nome: m.nome ?? '',
      documento: m.documento ?? '',
      email: m.email ?? '',
      telefone: m.telefone ?? '',
      data_nascimento: dobString,
      bloco: m.bloco ?? '',
      apartamento: m.apartamento ?? '',
      photo: m.user?.photo || m.foto_pessoa || '',
      foto_pessoa: m.foto_pessoa || m.user?.photo || '',
      vinculo: m.tipo ?? 'proprietario',
      tipo: m.tipo ?? 'proprietario',
      extra1: m.extra1 ?? '',
      extra2: m.extra2 ?? '',
      extra3: m.extra3 ?? '',
      extra4: m.extra4 ?? '',
    };
  }

  async saveMorador(
    body: any,
    isEdit: boolean,
    user?: JwtPayload,
    opts: { permitirSemStaff?: boolean } = {},
  ) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível. Tente novamente em instantes.');
    }
    const mor = body.morador || body.moradores || {};
    const idAptoRaw = mor.id_apto ?? body.id_apto;
    const idApto = idAptoRaw ? Number(idAptoRaw) : null;
    const tipoRaw = String(mor.tipo || mor.vinculo || 'proprietario');
    // Normaliza: "Proprietário" -> "proprietario", "Inquilino" -> "inquilino"
    const tipo = tipoRaw
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();

    let photoUrl: string | null = null;
    if (mor.photo) {
      if (this.storage.isDataUrl(mor.photo)) {
        photoUrl = await this.storage.uploadDataUrl(mor.photo, 'moradores');
      } else {
        photoUrl = mor.photo;
      }
    }

    try {
      // ===== EDIÇÃO =====
      if (isEdit) {
        const idMorador = Number(mor.id);
        if (!idMorador) throw new BadRequestException('ID do morador é obrigatório para edição.');

        const atual = await this.prisma.moradores.findUnique({
          where: { id: idMorador },
          include: { user: true },
        });
        if (!atual) throw new NotFoundException('Morador não encontrado.');
        await this.tenant.assertEntidade(atual.id_condominio, user, `morador #${idMorador}`);
        // O próprio morador pode editar o próprio cadastro; editar o de outro é
        // ação de síndico/funcionário.
        const callerId = user?.user?.id ?? user?.sub;
        if (atual.id_user !== callerId) assertStaff(user, 'editar dados de outro morador');

        const emailMudou = mor.email !== undefined && mor.email !== atual.email;
        if (emailMudou && mor.email) {
          const conflito = await this.prisma.users.findFirst({
            where: {
              OR: [{ email: mor.email }, { login: mor.email }],
              NOT: { id: atual.id_user },
            },
            select: { id: true },
          });
          if (conflito) throw new BadRequestException('Já existe outro usuário com este e-mail.');
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.moradores.update({
            where: { id: idMorador },
            data: {
              ...(mor.nome !== undefined && { nome: mor.nome }),
              ...(mor.documento !== undefined && { documento: mor.documento }),
              ...(mor.email !== undefined && { email: mor.email }),
              ...(mor.telefone !== undefined && { telefone: mor.telefone }),
              ...(mor.data_nascimento && { data_nascimento: this.parseDate(mor.data_nascimento) }),
              ...(tipo && { tipo }),
              ...(photoUrl !== null && { foto_pessoa: photoUrl }),
            },
          });

           const userPatch: any = {};
          if (mor.nome !== undefined) userPatch.name = mor.nome;
          if (mor.telefone !== undefined) userPatch.phone = mor.telefone;
          if (mor.documento !== undefined) userPatch.cpf = mor.documento || null;
          if (emailMudou) {
            userPatch.email = mor.email || null;
            userPatch.login = mor.email || null;
          }
          if (photoUrl !== null) {
            userPatch.photo = photoUrl;
            userPatch.profile_image = photoUrl;
          }
          if (Object.keys(userPatch).length > 0 && atual.id_user) {
            await tx.users.update({ where: { id: atual.id_user }, data: userPatch });
          }
        });

        const updatedUser = await this.prisma.users.findUnique({
          where: { id: atual.id_user },
          include: { moradores: true },
        });

        if (updatedUser && updatedUser.moradores && updatedUser.moradores.length > 0) {
          const moradorObj = updatedUser.moradores[0];
          const userObj = { id: updatedUser.id, nome: moradorObj.nome, photo: updatedUser.photo ?? '' };
          const payload = { sub: updatedUser.id, nome: moradorObj.nome, typeAccess: 'Morador', user: userObj };
          return { token: this.jwt.sign(payload, { expiresIn: '365d' }), user: userObj };
        }

        return '';
      }

      // ===== CRIAÇÃO =====
      // Cadastrar um novo morador é ação de síndico/funcionário, não self-service.
      // A exceção é o cadastro de familiar (insertFamiliar), que já validou que
      // quem chama é o proprietário do apartamento antes de delegar para cá.
      if (!opts.permitirSemStaff) assertStaff(user, 'cadastrar morador');
      if (!idApto) throw new BadRequestException('Apartamento não informado.');

      const apto = await this.prisma.apartamentos.findUnique({ where: { id: idApto } });
      if (!apto) throw new NotFoundException('Apartamento não encontrado.');

      const idCondominio = Number(body.id_condominio) || apto.id_condominio;
      await this.tenant.assertCondominio(idCondominio, user);

      // Validar duplicidade de morador no condomínio
      const emailNorm = mor.email ? mor.email.toLowerCase().trim() : null;
      const docNorm = mor.documento ? String(mor.documento).trim() : null;
      const nomeNorm = mor.nome ? mor.nome.trim() : null;

      const duplicationCheck = await this.prisma.moradores.findFirst({
        where: {
          id_condominio: idCondominio,
          OR: [
            ...(emailNorm ? [{ email: emailNorm }] : []),
            ...(docNorm ? [{ documento: docNorm }] : []),
            ...(nomeNorm ? [{
              nome: nomeNorm,
              bloco: apto.bloco || null,
              apartamento: apto.apto || null
            }] : [])
          ]
        }
      });

      if (duplicationCheck) {
        throw new BadRequestException('Este morador já está cadastrado neste condomínio (e-mail, documento ou nome/apartamento duplicado).');
      }

      // Cria/reutiliza Users por email OU cpf — senha inicial = documento ou '123456'
      let userId: number;
      let passwordWasSet = false;
      const cpf = mor.documento ? String(mor.documento).trim() : null;
      // Só os dígitos: a senha vai por e-mail para a pessoa digitar, e com a
      // máscara ("453.466.488-53") ela erra o ponto ou o traço e não entra.
      // O mesmo valor é enviado no e-mail mais abaixo, então os dois seguem
      // iguais — mudar só a mensagem deixaria a senha exibida errada.
      const senhaInicial = somenteDigitos(cpf) || '123456';
      // bcrypt: a senha inicial sao os digitos do CPF, que nao e segredo. Em
      // MD5 sem sal, qualquer vazamento do banco entrega a senha na hora.
      const senhaHash = await bcrypt.hash(senhaInicial, 10);

      // Procura usuário existente: por email ou por CPF (campos UNIQUE)
      const existing = await this.prisma.users.findFirst({
        where: {
          OR: [
            ...(mor.email ? [{ email: mor.email }] : []),
            ...(cpf ? [{ cpf }] : []),
          ],
        },
      });

      if (existing) {
        // Se já existe Users, verifica se NÃO é morador deste mesmo apartamento ainda
        const jaVinculado = await this.prisma.apartamentos_Users.findFirst({
          where: { id_user: existing.id, id_apto: apto.id },
        });
        if (jaVinculado) {
          throw new BadRequestException(
            `${existing.name ?? 'Este usuário'} já está cadastrado neste apartamento.`,
          );
        }

        // Se o conflito é por CPF mas email é DIFERENTE → bloqueia (são pessoas distintas)
        if (cpf && existing.cpf === cpf && mor.email && existing.email && existing.email !== mor.email) {
          throw new BadRequestException(
            'Já existe um morador cadastrado com este CPF (com outro e-mail). Verifique o documento informado.',
          );
        }

        userId = existing.id;
        // Garante que o usuário tem login/senha para acessar o app
        const patch: any = {};
        if (!existing.login && mor.email) patch.login = mor.email;
        if (!existing.password) {
          patch.password = senhaHash;
          passwordWasSet = true;
        }
        if (!existing.email && mor.email) patch.email = mor.email;
        if (!existing.cpf && cpf) patch.cpf = cpf;
        if (!existing.phone && mor.telefone) patch.phone = mor.telefone;
        if (!existing.name && mor.nome) patch.name = mor.nome;
        if (photoUrl !== null) {
          patch.photo = photoUrl;
          patch.profile_image = photoUrl;
        }
        if (Object.keys(patch).length > 0) {
          await this.prisma.users.update({ where: { id: existing.id }, data: patch });
        }
      } else if (mor.email) {
        const u = await this.prisma.users.create({
          data: {
            name: mor.nome,
            email: mor.email,
            login: mor.email,
            password: senhaHash,
            phone: mor.telefone,
            cpf,
            is_morador: 1,
            login_type: 'morador',
            photo: photoUrl,
            profile_image: photoUrl,
          },
        });
        userId = u.id;
        passwordWasSet = true;
      } else {
        // Morador sem email — cria Users só para satisfazer FK, mas sem acesso ao app
        const u = await this.prisma.users.create({
          data: {
            name: mor.nome,
            phone: mor.telefone,
            cpf,
            is_morador: 1,
            login_type: 'morador',
            photo: photoUrl,
            profile_image: photoUrl,
          },
        });
        userId = u.id;
      }

      // Vincula em Apartamentos_Users (45 dias de vencimento padrão)
      const venc = new Date();
      venc.setDate(venc.getDate() + 45);
      try {
        await this.prisma.apartamentos_Users.create({
          data: { id_apto: apto.id, id_user: userId, tipo, vencimento: venc },
        });
      } catch {
        // Vínculo pode já existir (mesmo user em outro fluxo). Ignora.
      }

      // Cria Moradores
      const created = await this.prisma.moradores.create({
        data: {
          nome: mor.nome ?? '',
          documento: mor.documento ?? null,
          email: mor.email ?? null,
          telefone: mor.telefone ?? null,
          data_nascimento: mor.data_nascimento ? this.parseDate(mor.data_nascimento) : null,
          tipo,
          id_user: userId,
          id_condominio: idCondominio,
          bloco: apto.bloco || null,
          apartamento: apto.apto || null,
        },
      });

      // Dispara email de boas-vindas (assíncrono, não bloqueia resposta)
      if (mor.email && mor.sendCredentials !== false) {
        if (passwordWasSet) {
          this.mail
            .sendWelcomeMorador(mor.email, mor.nome ?? '', senhaInicial)
            .catch(() => {});
        } else {
          this.mail
            .sendWelcomeMoradorExisting(mor.email, mor.nome ?? '')
            .catch(() => {});
        }
      }

      return { id: created.id };
    } catch (e: any) {
      // Repassa exceptions Nest (BadRequest, NotFound, etc.)
      if (e?.response && e?.status) throw e;
      // Traduz erros conhecidos do Prisma para mensagens claras
      if (e?.code === 'P2002') {
        const target = (e?.meta?.target as string | undefined)?.toLowerCase() ?? '';
        if (target.includes('cpf')) throw new BadRequestException('Já existe um usuário com este CPF.');
        if (target.includes('email')) throw new BadRequestException('Já existe um usuário com este e-mail.');
        if (target.includes('login')) throw new BadRequestException('Já existe um usuário com este e-mail (login).');
        throw new BadRequestException('Já existe outro registro com esses dados únicos.');
      }
      throw new BadRequestException(e?.message ?? 'Erro ao salvar morador.');
    }
  }

  /**
   * Cadastro de familiar ("membro") feito pelo próprio morador.
   *
   * Diferente de saveMorador, que é ação de síndico/funcionário: aqui quem
   * chama é o morador, então a autorização não é "é staff?" e sim "é o
   * PROPRIETÁRIO deste apartamento?". Inquilino e membro não podem cadastrar
   * mais gente no apto — senão qualquer morador vinculado conseguiria criar
   * acessos no apartamento em que mora.
   *
   * O tipo é forçado para 'membro': o corpo vem do app e não pode escolher
   * virar proprietário.
   */
  async insertFamiliar(body: any, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível. Tente novamente em instantes.');
    }
    const mor = body?.morador ?? {};
    const idApto = Number(mor.id_apto ?? body?.id_apto);
    if (!idApto || Number.isNaN(idApto)) {
      throw new BadRequestException('Apartamento não informado.');
    }

    const callerId = Number(user?.user?.id ?? user?.sub);
    if (!callerId || Number.isNaN(callerId)) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    const vinculo = await this.prisma.apartamentos_Users.findFirst({
      where: { id_apto: idApto, id_user: callerId },
      select: { tipo: true },
    });
    if (!vinculo || this.normalizeTipo(vinculo.tipo) !== 'proprietario') {
      throw new ForbiddenException(
        'Apenas o proprietário do apartamento pode cadastrar familiares.',
      );
    }

    return this.saveMorador(
      { ...body, morador: { ...mor, id_apto: idApto, tipo: 'membro' } },
      false,
      user,
      { permitirSemStaff: true },
    );
  }

  async removeMorador(id: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    assertStaff(user, 'remover morador');
    const atual = await this.prisma.moradores.findUnique({ where: { id: Number(id) } });
    if (!atual) throw new NotFoundException('Morador não encontrado.');
    await this.tenant.assertEntidade(atual.id_condominio, user, `morador #${id}`);
    try {
      await this.prisma.moradores.delete({ where: { id: Number(id) } });
    } catch {
      throw new NotFoundException('Morador não encontrado.');
    }
    return true;
  }

  // ==========================================
  // APARTAMENTOS (MOBILE)
  // ==========================================

  async getAllApartamentos(idCond: number, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCond, user);
    // Devolve, junto de cada unidade, o campo `moradores` com os NOMES de quem
    // mora nela — na prática um diretório de "quem mora onde" do prédio
    // inteiro. É seletor de apartamento das telas de staff: no app, todo
    // chamador faz `if (morador) usa o próprio apto; else carrega a lista`.
    // A restrição existia em cinco telas do Flutter e em nenhum lugar aqui.
    assertOperador(user, 'listar os apartamentos do condomínio');
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const reais = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCond) },
      include: {
        users: { include: { user: true } },
      },
    });

    reais.sort((a, b) => {
      if (a.bloco === b.bloco) {
        return (a.apto ?? '').localeCompare(b.apto ?? '', 'pt', { numeric: true });
      }
      return (a.bloco ?? '').localeCompare(b.bloco ?? '');
    });

    return reais.map(a => {
      // Contagem canônica = vínculos distintos por usuário (não há unique em Apartamentos_Users).
      const idsUnicos = new Set(a.users.map(u => u.id_user));
      const nomes = Array.from(
        new Map(a.users.map(u => [u.id_user, u.user?.name ?? ''])).values()
      ).filter(Boolean);
      return {
        id: a.id,
        bloco: a.bloco ?? '',
        apto: a.apto ?? '',
        numero: a.apto ?? '',
        fracao: a.fracao ?? '',
        qtd_vagas: a.qtd_vagas ?? 0,
        id_condominio: a.id_condominio,
        qtdMoradores: idsUnicos.size,
        moradores: nomes.join(', '),
      };
    });
  }

  async getMoradoresApto(idApto: number, tipo?: string, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const apto = await this.prisma.apartamentos.findUnique({
      where: { id: Number(idApto) },
      select: { id_condominio: true },
    });
    if (!apto) throw new NotFoundException('Apartamento não encontrado.');
    await this.tenant.assertEntidade(apto.id_condominio, user, `apartamento #${idApto}`);
    // O tenant sozinho aceitava QUALQUER id_apto do condominio: bastava
    // enumerar os ids para listar os moradores de todo apartamento do predio.
    // A tela que usa isto e a "meu apartamento" — morador ve so a unidade
    // dele; portaria e sindico seguem vendo qualquer uma.
    await this.assertAptoDoMorador(Number(idApto), user);
    // Filtro de tipo opcional, comparado de forma robusta (normalizado x normalizado),
    // pois o banco tem valores legados/sujos ('Proprietário'/'morador'/null/'dependente').
    const tipoFiltro = tipo ? this.normalizeTipo(tipo) : undefined;

    // Sem `tipo` no WHERE: trazemos todos os vínculos do apto e filtramos em JS.
    const rels = await this.prisma.apartamentos_Users.findMany({
      where: { id_apto: Number(idApto) },
      include: {
        apartamento: true,
        user: { include: { moradores: true } },
      },
    });

    // De-dup por id_user (não há unique em Apartamentos_Users) e aplica o filtro de tipo.
    const seen = new Set<number>();
    const result: any[] = [];
    for (const r of rels) {
      if (seen.has(r.id_user)) continue;
      const tipoNorm = this.normalizeTipo(r.tipo);
      if (tipoFiltro && tipoNorm !== tipoFiltro) continue;
      seen.add(r.id_user);

      const condId = r.apartamento?.id_condominio;
      const m = (condId && r.user?.moradores)
        ? (r.user.moradores.find(mor => mor.id_condominio === condId) ?? r.user.moradores[0])
        : r.user?.moradores?.[0];
      result.push({
        id: m?.id ?? r.id_user, // Flutter usa esse id para abrir o detalhe
        id_user: r.id_user,
        nome: m?.nome ?? r.user?.name ?? '',
        documento: m?.documento ?? r.user?.cpf ?? '',
        email: m?.email ?? r.user?.email ?? '',
        telefone: m?.telefone ?? r.user?.phone ?? '',
        data_nascimento: m?.data_nascimento ?? null,
        bloco: m?.bloco ?? '',
        apartamento: m?.apartamento ?? '',
        photo: r.user?.photo || m?.foto_pessoa || '',
        foto_pessoa: m?.foto_pessoa || r.user?.photo || '',
        tipo: tipoNorm,
        extra1: m?.extra1 ?? '',
        extra2: m?.extra2 ?? '',
        extra3: m?.extra3 ?? '',
        extra4: m?.extra4 ?? '',
      });
    }
    return result;
  }

  async saveApto(body: any, isEdit: boolean, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    assertStaff(user, 'gerenciar apartamentos');
    const idCond = Number(body.id_condominio);
    const data = body.Apartamento ?? body.apartamento ?? {};

    if (!data.apto) throw new BadRequestException('Apto é obrigatório.');

    try {
      if (isEdit) {
        const id = Number(data.id);
        if (!id) throw new BadRequestException('ID do apartamento é obrigatório para edição.');
        const atual = await this.prisma.apartamentos.findUnique({ where: { id }, select: { id_condominio: true } });
        if (!atual) throw new NotFoundException('Apartamento não encontrado.');
        await this.tenant.assertEntidade(atual.id_condominio, user, `apartamento #${id}`);
        return await this.prisma.apartamentos.update({
          where: { id },
          data: {
            ...(data.bloco !== undefined && { bloco: data.bloco }),
            ...(data.apto !== undefined && { apto: data.apto }),
            ...(data.fracao !== undefined && { fracao: data.fracao }),
            ...(data.qtd_vagas !== undefined && { qtd_vagas: Number(data.qtd_vagas) || 0 }),
          },
        });
      }
      if (!idCond) throw new BadRequestException('id_condominio é obrigatório.');
      await this.tenant.assertCondominio(idCond, user);
      return await this.prisma.apartamentos.create({
        data: {
          id_condominio: idCond,
          bloco: data.bloco ?? null,
          apto: data.apto,
          fracao: data.fracao ?? null,
          qtd_vagas: Number(data.qtd_vagas) || 0,
        },
      });
    } catch (e: any) {
      if (e?.response && e?.status) throw e;
      // Erros conhecidos do Prisma (unique constraint, etc.)
      if (e?.code === 'P2002') {
        throw new BadRequestException('Já existe um apartamento com esse bloco/número neste condomínio.');
      }
      throw new BadRequestException(e?.message ?? 'Erro ao salvar apartamento.');
    }
  }

  /**
   * Excluir apartamento pelo app.
   *
   * Delega para o ApartamentosService em vez de repetir a exclusão aqui. Eram
   * duas implementações da MESMA operação destrutiva, e elas já tinham
   * divergido: a do console conta o que a cascata leva junto (vínculos de
   * morador, visitantes, vagas, reservas, mudanças), registra na auditoria e
   * devolve o erro real; esta apagava calada e respondia "não encontrado"
   * para qualquer falha. Uma cópia só — quem corrigir uma, corrige as duas.
   */
  async removeApto(id: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    return this.apartamentos.remove(Number(id), user);
  }

  // ==========================================
  // OCORRÊNCIAS (MOBILE)
  // ==========================================

  async listOcorrenciasCategorias() {
    if (!this.prisma.isConnected) return [];
    return this.prisma.ocorrencias_Categorias.findMany({
      orderBy: { prioridade: 'asc' },
    });
  }

  async saveOcorrencia(body: any, idUser: number, user?: JwtPayload) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const data = body.ocorrencia ?? body;
    const idCondominio = body.id_condominio ?? data.id_condominio;
    const descricao = data.descricao;
    const tipo = data.tipo;
    const publica = data.publica === true || data.publica === 1 || data.publica === 'true';

    if (!descricao) throw new BadRequestException('Descrição é obrigatória.');
    if (!idCondominio) throw new BadRequestException('id_condominio é obrigatório.');
    await this.tenant.assertCondominio(Number(idCondominio), user);

    // SLA: prazo = agora + sla_horas da categoria (se configurado).
    const tipoNum = tipo ? Number(tipo) : null;
    let prazo: Date | null = null;
    if (tipoNum != null) {
      const cat = await this.prisma.ocorrencias_Categorias.findUnique({
        where: { id: tipoNum },
        select: { sla_horas: true },
      });
      if (cat?.sla_horas != null) {
        prazo = new Date(Date.now() + cat.sla_horas * 3600 * 1000);
      }
    }

    try {
      return await this.prisma.ocorrencias.create({
        data: {
          id_condominio: Number(idCondominio),
          descricao: descricao,
          tipo: tipoNum,
          user: idUser,
          status: 'Pendente',
          publica: publica,
          prazo,
        },
      });
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Erro ao salvar ocorrência.');
    }
  }

  async listOcorrencias(idUser: number) {
    if (!this.prisma.isConnected) return [];
    
    // Buscar o morador para descobrir o id_condominio
    const morador = await this.prisma.moradores.findFirst({
      where: { id_user: idUser },
      select: { id_condominio: true },
    });

    const where: any = {
      OR: [
        { user: idUser },
      ]
    };

    if (morador?.id_condominio) {
      where.OR.push({
        id_condominio: morador.id_condominio,
        publica: true,
      });
    }

    const list = await this.prisma.ocorrencias.findMany({
      where,
      include: { categoria: true, criadoPor: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
    });

    return this.mapOcorrenciasComResp(list);
  }

  /**
   * Lista todas as ocorrências visíveis para o usuário logado.
   * - Síndico/Funcionário: vê todas do condomínio.
   * - Morador: vê só as próprias ou as públicas.
   */
  async listOcorrenciasTodos(idCondominio: number, idUser: number, typeAccess: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return [];
    const isPrivileged = typeAccess === 'Sindico' || typeAccess === 'Funcionario';
    const where: any = { id_condominio: Number(idCondominio) };
    if (!isPrivileged) {
      where.OR = [
        { user: Number(idUser) },
        { publica: true }
      ];
    }

    const list = await this.prisma.ocorrencias.findMany({
      where,
      include: { categoria: true, criadoPor: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
    });
    return this.mapOcorrenciasComResp(list);
  }

  /**
   * Lista somente as ocorrências NÃO solucionadas (Pendente, Ciente, etc.).
   */
  async listOcorrenciasPendentes(idCondominio: number, idUser: number, typeAccess: string, user?: JwtPayload) {
    await this.tenant.assertCondominio(idCondominio, user);
    if (!this.prisma.isConnected) return [];
    const isPrivileged = typeAccess === 'Sindico' || typeAccess === 'Funcionario';
    const where: any = {
      id_condominio: Number(idCondominio),
      status: { notIn: ['Solucionado', 'solucionado', 'Resolvida', 'resolvida'] },
    };
    if (!isPrivileged) {
      where.OR = [
        { user: Number(idUser) },
        { publica: true }
      ];
    }

    const list = await this.prisma.ocorrencias.findMany({
      where,
      include: { categoria: true, criadoPor: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
    });
    return this.mapOcorrenciasComResp(list);
  }

  /** Resolve os nomes dos responsáveis (Users.name) em lote e mapeia a lista. */
  private async mapOcorrenciasComResp(list: any[]) {
    const ids = [...new Set(list.map(o => o.id_responsavel).filter((v): v is number => v != null))];
    let nomes = new Map<number, string>();
    if (ids.length > 0) {
      const users = await this.prisma.users.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      nomes = new Map(users.map(u => [u.id, u.name ?? '']));
    }
    return list.map(o => this.mapOcorrencia(o, o.id_responsavel ? nomes.get(o.id_responsavel) ?? null : null));
  }

  private mapOcorrencia(o: any, responsavelNome: string | null = null) {
    return {
      id: o.id,
      descricao: o.descricao ?? '',
      tipo: o.categoria?.nome ?? '',
      tipoId: o.tipo,
      sla_horas: o.categoria?.sla_horas ?? null,
      prazo: o.prazo ?? null,
      id_responsavel: o.id_responsavel ?? null,
      responsavelNome: responsavelNome,
      status: o.status ?? 'Pendente',
      resposta: o.resposta ?? '',
      resposta_at: o.resposta_at,
      criado_por: o.criadoPor?.name ?? '',
      created_at: o.created_at,
      updated_at: o.updated_at,
      anexos: o.anexos ?? '',
      publica: o.publica ?? false,
      user: o.user,
    };
  }

  async getOcorrenciaById(id: number, requester?: JwtPayload) {
    if (!this.prisma.isConnected) return null;
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id },
      include: { categoria: true, criadoPor: { select: { name: true } } },
    });
    if (!o) return null;
    await this.tenant.assertEntidade(o.id_condominio, requester, `ocorrência #${id}`);
    const typeAccess = requester?.typeAccess ?? requester?.user?.typeAccess;
    const isPrivileged = typeAccess === 'Sindico' || typeAccess === 'Funcionario';
    const callerId = requester?.user?.id ?? requester?.sub;
    if (!isPrivileged && !o.publica && o.user !== callerId) {
      throw new ForbiddenException('Acesso negado: ocorrência não pertence a você');
    }
    let respNome: string | null = null;
    if (o.id_responsavel) {
      const u = await this.prisma.users.findUnique({
        where: { id: o.id_responsavel },
        select: { name: true },
      });
      respNome = u?.name ?? null;
    }
    return this.mapOcorrencia(o, respNome);
  }

  // O financeiro do app é servido pelo FinanceiroController
  // (/financeiro/get-by-user), que filtra pela unidade do morador. Aqui
  // existia um `listFinanceiroByUser` sem rota — e que devolvia TODAS as
  // cobranças em aberto do condomínio, de todos os apartamentos, para
  // qualquer morador. Removido: era um vazamento esperando alguém plugar
  // um @Get nele.

  // ==========================================
  // ENCOMENDAS (MOBILE)
  // ==========================================

  async listEncomendasByUser(idUser: number) {
    try {
      if (this.prisma.isConnected) {
        const moras = await this.prisma.moradores.findMany({
          where: { id_user: idUser },
        });

        let total: any[] = [];
        for (const m of moras) {
          if (
            m.id_condominio === null ||
            m.id_condominio === undefined ||
            m.apartamento === null ||
            m.apartamento === undefined
          ) {
            continue;
          }
          const listWhere: any = {
            id_condominio: m.id_condominio,
            destinatario_apto: m.apartamento,
          };

          if (m.bloco === null || m.bloco === undefined || m.bloco.trim() === '') {
            listWhere.OR = [
              { destinatario_bloco: null },
              { destinatario_bloco: '' }
            ];
          } else {
            listWhere.destinatario_bloco = m.bloco;
          }

          const list = await this.prisma.encomendas.findMany({
            where: listWhere,
            orderBy: { created_at: 'desc' },
          });
          total = [...total, ...list];
        }
        return total;
      }
    } catch (e) {}
    return [];
  }

  /**
   * Retirada feita pelo próprio morador — condomínios sem portaria, onde não há
   * porteiro para dar baixa. O morador confirma que pegou o volume e (opcional)
   * anexa uma foto como comprovante.
   *
   * Só libera se a encomenda for endereçada a um dos apto/bloco do morador; sem
   * essa checagem qualquer morador daria baixa na encomenda alheia (IDOR).
   */
  async retirarEncomendaMorador(
    idUser: number,
    idEncomenda: number,
    fotoDataUrl?: string,
  ) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível.');
    }

    const encomenda = await this.prisma.encomendas.findUnique({
      where: { id: Number(idEncomenda) },
    });
    if (!encomenda) {
      throw new NotFoundException('Encomenda não encontrada.');
    }

    const norm = (v?: string | null) => (v ?? '').trim().toLowerCase();

    const moras = await this.prisma.moradores.findMany({
      where: { id_user: idUser },
    });
    const dono = moras.find(
      (m) =>
        m.id_condominio === encomenda.id_condominio &&
        norm(m.apartamento) === norm(encomenda.destinatario_apto) &&
        norm(m.bloco) === norm(encomenda.destinatario_bloco),
    );
    if (!dono) {
      throw new ForbiddenException('Esta encomenda não é do seu apartamento.');
    }

    if (norm(encomenda.status) === 'retirada') {
      throw new BadRequestException('Esta encomenda já foi retirada.');
    }

    // Foto chega como data URL do app; o storage devolve a URL pública.
    let fotoUrl: string | null = fotoDataUrl ?? null;
    if (fotoUrl && this.storage.isDataUrl(fotoUrl)) {
      const uploaded = await this.storage.uploadDataUrl(fotoUrl, 'encomendas');
      if (uploaded) {
        fotoUrl = uploaded;
      }
    }

    return this.prisma.encomendas.update({
      where: { id: encomenda.id },
      data: {
        retirado_em: new Date(),
        retirado_por: dono.nome,
        retirado_foto: fotoUrl,
        status: 'Retirada',
        entregue_por_user: idUser,
      },
    });
  }

  async updatePassword(idUser: number, newPasswordPlana: string, typeAccess: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível. Tente novamente em instantes.');
    }
    const hash = await bcrypt.hash(newPasswordPlana, 10);
    const user = await this.prisma.users.update({
      where: { id: idUser },
      data: { password: hash },
      include: {
        sindicos: true,
        moradores: true,
        funcionarios: true,
        sindicosCondominios: true,
      },
    });

    if (typeAccess.toLowerCase() === 'sindico') {
      const sindico = user.sindicos[0];
      const payload: JwtPayload = { sub: user.id, nome: sindico?.name || '', typeAccess: 'Sindico' };
      return {
        access_token: this.jwt.sign(payload, { expiresIn: '365d' }),
        id: user.id,
        nome: sindico?.name || '',
        user: {
          id: user.id,
          login: user.login,
          photo: user.photo,
          id_condominio: user.sindicosCondominios[0]?.id_condominio ?? 1,
          sindico,
        },
      };
    } else if (typeAccess.toLowerCase() === 'morador') {
      const morador = user.moradores[0];
      const payload: JwtPayload = { sub: user.id, nome: morador?.nome || '', typeAccess: 'Morador' };
      return {
        access_token: this.jwt.sign(payload, { expiresIn: '365d' }),
        id: user.id,
        nome: morador?.nome || '',
        user: {
          id: user.id,
          login: user.login,
          photo: user.photo,
          id_condominio: morador?.id_condominio ?? 1,
          morador,
        },
      };
    } else {
      const func = user.funcionarios[0];
      const payload: JwtPayload = { sub: user.id, nome: func?.nome || '', typeAccess: 'Funcionario' };
      return {
        access_token: this.jwt.sign(payload, { expiresIn: '365d' }),
        id: user.id,
        nome: func?.nome || '',
        user: {
          id: user.id,
          login: user.login,
          photo: user.photo,
          id_condominio: func?.id_condominio ?? 1,
          funcionario: func,
        },
      };
    }
  }

  async cadastrarRastreioMorador(idUser: number, dto: { descricao: string; recebido_de?: string; codigo_rastreio: string }) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco de dados indisponível.');
    }
    const morador = await this.prisma.moradores.findFirst({
      where: { id_user: idUser },
    });
    if (!morador) {
      throw new BadRequestException('Morador não encontrado para este usuário.');
    }
    if (!morador.id_condominio || !morador.apartamento) {
      throw new BadRequestException('Morador não está vinculado a um condomínio e apartamento.');
    }

    return this.prisma.encomendas.create({
      data: {
        descricao: dto.descricao,
        destinatario_apto: morador.apartamento,
        destinatario_bloco: morador.bloco ?? null,
        recebido_de: dto.recebido_de ?? 'Correios',
        codigo_rastreio: dto.codigo_rastreio,
        status: 'Esperando',
        id_condominio: morador.id_condominio,
        notificado: 0,
      },
    });
  }

  // === Veículos do morador (app) =============================================

  /** Resolve o Moradores.id do usuário no condomínio (ou o mais provável). */
  private async resolveMoradorId(idUser: number, idCondominio?: number): Promise<{ id: number; id_condominio: number } | null> {
    const where: any = { id_user: idUser };
    if (idCondominio) where.id_condominio = idCondominio;
    const morador = await this.prisma.moradores.findFirst({ where });
    if (!morador || !morador.id_condominio) return null;
    return { id: morador.id, id_condominio: morador.id_condominio };
  }

  private normalizarPlaca(v: any) {
    return (v?.placa ?? '').toString().toUpperCase().trim();
  }

  async listVeiculosByUser(idUser: number, idCondominio?: number) {
    if (!this.prisma.isConnected) return [];
    const m = await this.resolveMoradorId(idUser, idCondominio);
    if (!m) return [];
    const list = await this.prisma.veiculos.findMany({
      where: { id_morador: m.id, ativo: 1 },
      include: { tag: true },
      orderBy: { created_at: 'desc' },
    });
    // Formato esperado pelo app (VeiculoModel.fromJson lê tag_codigo).
    return list.map((v) => ({
      id: v.id,
      placa: v.placa,
      cor: v.cor,
      marca_modelo: v.marca_modelo,
      id_tag: v.id_tag,
      id_condominio: v.id_condominio,
      tag_codigo: v.tag?.codigo ?? null,
    }));
  }

  async criarVeiculoMorador(idUser: number, idCondominio: number, veiculo: any) {
    if (!this.prisma.isConnected) throw new ServiceUnavailableException('Banco de dados indisponível.');
    const placa = this.normalizarPlaca(veiculo);
    if (!placa) throw new BadRequestException('Placa é obrigatória.');
    const m = await this.resolveMoradorId(idUser, idCondominio);
    if (!m) throw new BadRequestException('Você não é morador deste condomínio.');
    try {
      const criado = await this.prisma.veiculos.create({
        data: {
          id_morador: m.id,
          id_condominio: m.id_condominio,
          placa,
          cor: veiculo?.cor?.toString().trim() || null,
          marca_modelo: veiculo?.marca_modelo?.toString().trim() || null,
        },
      });
      // Tag opcional: o morador digita o código impresso na tag física.
      if (veiculo?.tag_codigo !== undefined) {
        await this.vincularTagAoVeiculo(m.id_condominio, criado.id, veiculo.tag_codigo);
      }
      return criado;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException('Já existe um veículo com essa placa neste condomínio.');
      }
      throw err;
    }
  }

  /**
   * Vincula (ou desvincula) uma tag RFID ao veículo pelo código digitado pelo
   * morador. Código vazio desvincula. A tag é criada no condomínio se ainda não
   * existir (upsert), e recusamos se ela já estiver em outro veículo ativo — sem
   * isso um morador "roubaria" a tag de acesso de outro.
   */
  private async vincularTagAoVeiculo(idCondominio: number, idVeiculo: number, codigoRaw: any) {
    const codigo = (codigoRaw ?? '').toString().trim();

    if (!codigo) {
      await this.prisma.veiculos.update({
        where: { id: idVeiculo },
        data: { id_tag: null },
      });
      return;
    }

    const tag = await this.prisma.tags.upsert({
      where: { id_condominio_codigo: { id_condominio: idCondominio, codigo } },
      create: { id_condominio: idCondominio, codigo, tipo: 'rfid' },
      update: { ativo: 1 },
    });

    const emOutro = await this.prisma.veiculos.findFirst({
      where: { id_tag: tag.id, ativo: 1, id: { not: idVeiculo } },
    });
    if (emOutro) {
      throw new BadRequestException('Esta tag já está vinculada a outro veículo.');
    }

    await this.prisma.veiculos.update({
      where: { id: idVeiculo },
      data: { id_tag: tag.id },
    });
  }

  async atualizarVeiculoMorador(idUser: number, idCondominio: number, veiculo: any) {
    if (!this.prisma.isConnected) throw new ServiceUnavailableException('Banco de dados indisponível.');
    const placa = this.normalizarPlaca(veiculo);
    if (!veiculo?.id) throw new BadRequestException('Veículo inválido.');
    if (!placa) throw new BadRequestException('Placa é obrigatória.');
    const m = await this.resolveMoradorId(idUser, idCondominio);
    if (!m) throw new BadRequestException('Acesso negado.');
    try {
      // updateMany escopado ao morador — não deixa editar carro de outro.
      const r = await this.prisma.veiculos.updateMany({
        where: { id: Number(veiculo.id), id_morador: m.id },
        data: {
          placa,
          cor: veiculo?.cor?.toString().trim() || null,
          marca_modelo: veiculo?.marca_modelo?.toString().trim() || null,
        },
      });
      if (r.count === 0) throw new BadRequestException('Veículo não encontrado.');
      // Só mexe na tag se o app enviou o campo (edições antigas não desvinculam).
      if (veiculo?.tag_codigo !== undefined) {
        await this.vincularTagAoVeiculo(m.id_condominio, Number(veiculo.id), veiculo.tag_codigo);
      }
      return { ok: true };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException('Já existe um veículo com essa placa neste condomínio.');
      }
      throw err;
    }
  }

  async removerVeiculoMorador(idUser: number, idCondominio: number, id: number) {
    if (!this.prisma.isConnected) throw new ServiceUnavailableException('Banco de dados indisponível.');
    const m = await this.resolveMoradorId(idUser, idCondominio);
    if (!m) throw new BadRequestException('Acesso negado.');
    await this.prisma.veiculos.deleteMany({ where: { id: Number(id), id_morador: m.id } });
    return { ok: true };
  }

  // ==========================================
  // VAGAS (app do morador) — liberar vaga p/ visitante/inquilino
  // ==========================================

  /** Resolve o morador logado + o apartamento a que pertence (com qtd_vagas). */
  private async resolveMoradorApto(idUser: number, idCondominio?: number) {
    const m = await this.resolveMoradorId(idUser, idCondominio);
    if (!m) return null;
    // Preferimos o vínculo em Apartamentos_Users (id_apto direto); se não houver,
    // caímos no match por bloco/apto do registro de Moradores.
    const rel = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: idUser, apartamento: { id_condominio: m.id_condominio } },
      include: { apartamento: true },
    });
    let apto = rel?.apartamento ?? null;
    if (!apto) {
      const mor = await this.prisma.moradores.findFirst({ where: { id: m.id } });
      if (mor?.bloco != null && mor?.apartamento != null) {
        apto = await this.prisma.apartamentos.findFirst({
          where: { id_condominio: m.id_condominio, bloco: mor.bloco, apto: mor.apartamento },
        });
      }
    }
    if (!apto) return null;
    return { moradorId: m.id, idCondominio: m.id_condominio, apto };
  }

  private mapVaga(v: any) {
    return {
      id: v.id,
      tipo_ocupacao: v.tipo_ocupacao,
      id_veiculo: v.id_veiculo,
      id_visitante: v.id_visitante,
      id_morador_beneficiario: v.id_morador_beneficiario,
      placa: v.placa ?? v.veiculo?.placa ?? null,
      inicio: v.inicio,
      fim: v.fim,
      ocupante_nome:
        v.tipo_ocupacao === 'visitante'
          ? v.visitante?.nome ?? null
          : v.tipo_ocupacao === 'inquilino'
            ? v.beneficiario?.nome ?? null
            : v.titular?.nome ?? null,
    };
  }

  async listVagasByUser(idUser: number, idCondominio?: number) {
    if (!this.prisma.isConnected) return { qtd_vagas: 0, ocupadas: 0, vagas: [] };
    const ctx = await this.resolveMoradorApto(idUser, idCondominio);
    if (!ctx) return { qtd_vagas: 0, ocupadas: 0, vagas: [] };
    const [vagas, veiculos] = await Promise.all([
      this.prisma.vagas.findMany({
        where: { id_apartamento: ctx.apto.id, ativo: 1 },
        include: { veiculo: true, visitante: true, beneficiario: true, titular: true },
        orderBy: { created_at: 'desc' },
      }),
      // Veículos próprios do morador ocupam automaticamente uma vaga "proprio"
      // (sintetizada em leitura, sem materializar linha em Vagas).
      this.prisma.veiculos.findMany({
        where: { id_morador: ctx.moradorId, ativo: 1 },
        orderBy: { created_at: 'desc' },
      }),
    ]);
    const proprios = veiculos.map((v) => ({
      id: null,
      tipo_ocupacao: 'proprio',
      id_veiculo: v.id,
      id_visitante: null,
      id_morador_beneficiario: null,
      placa: v.placa ?? null,
      inicio: null,
      fim: null,
      ocupante_nome: v.marca_modelo ?? null,
    }));
    const todas = [...proprios, ...vagas.map((v) => this.mapVaga(v))];
    return {
      qtd_vagas: ctx.apto.qtd_vagas ?? 0,
      ocupadas: todas.length,
      vagas: todas,
    };
  }

  /** Beneficiários possíveis: visitantes do apto + inquilinos do apto. */
  async listBeneficiariosVaga(idUser: number, idCondominio?: number) {
    if (!this.prisma.isConnected) return { visitantes: [], inquilinos: [] };
    const ctx = await this.resolveMoradorApto(idUser, idCondominio);
    if (!ctx) return { visitantes: [], inquilinos: [] };
    const visitantesRaw = await this.prisma.visitantes.findMany({
      where: { id_apartamento: ctx.apto.id, is_visitante: 1 },
      select: { id: true, nome: true, doc_identificacao: true, foto_pessoa: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });

    const mapUnicos = new Map<string, typeof visitantesRaw[0]>();
    for (const v of visitantesRaw) {
      const doc = (v.doc_identificacao ?? '').trim();
      const nome = (v.nome ?? '').trim().toLowerCase();
      const key = doc ? `doc:${doc}` : `nome:${nome}`;
      if (!mapUnicos.has(key)) {
        mapUnicos.set(key, v);
      } else {
        const existente = mapUnicos.get(key)!;
        const existenteTemFoto = !!(existente.foto_pessoa && existente.foto_pessoa.trim() !== '');
        const novoTemFoto = !!(v.foto_pessoa && v.foto_pessoa.trim() !== '');
        if (!existenteTemFoto && novoTemFoto) {
          mapUnicos.set(key, v);
        }
      }
    }

    const visitantesUnicos = Array.from(mapUnicos.values()).sort((a, b) =>
      (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR'),
    );

    const inquilinos = await this.getMoradoresApto(ctx.apto.id, 'Inquilino');
    return {
      // tem_foto indica se o visitante pode ser liberado no facial/portão: sem
      // foto, o app avisa que o reconhecimento não abre (só PIN/código).
      visitantes: visitantesUnicos.map((v) => ({
        id: v.id,
        nome: v.nome,
        doc_identificacao: v.doc_identificacao,
        tem_foto: !!(v.foto_pessoa && v.foto_pessoa.trim() !== ''),
      })),
      inquilinos: (inquilinos ?? []).map((i: any) => ({ id: i.id, nome: i.nome })),
    };
  }

  async liberarVaga(idUser: number, idCondominio: number, body: any) {
    if (!this.prisma.isConnected) throw new ServiceUnavailableException('Banco de dados indisponível.');
    const ctx = await this.resolveMoradorApto(idUser, idCondominio);
    if (!ctx) throw new BadRequestException('Você não é morador deste condomínio.');

    const tipo = (body?.tipo ?? '').toString();
    if (tipo !== 'visitante' && tipo !== 'inquilino') {
      throw new BadRequestException('Tipo de liberação inválido.');
    }

    // Checa vaga livre: (ativas liberadas + veículos próprios) < qtd_vagas.
    const [ativas, veiculosProprios] = await Promise.all([
      this.prisma.vagas.count({ where: { id_apartamento: ctx.apto.id, ativo: 1 } }),
      this.prisma.veiculos.count({ where: { id_morador: ctx.moradorId, ativo: 1 } }),
    ]);
    if (ativas + veiculosProprios >= (ctx.apto.qtd_vagas ?? 0)) {
      throw new BadRequestException('Não há vagas livres neste apartamento.');
    }

    const inicio = body?.inicio ? new Date(body.inicio) : null;
    const fim = body?.fim ? new Date(body.fim) : null;
    const placa = body?.placa ? body.placa.toString().toUpperCase().trim() : null;

    let idVisitante: number | null = null;
    let idBeneficiario: number | null = null;

    if (tipo === 'visitante') {
      idVisitante = Number(body?.id_visitante) || null;
      if (!idVisitante) throw new BadRequestException('Selecione um visitante cadastrado.');
      const vis = await this.prisma.visitantes.findFirst({
        where: { id: idVisitante, id_apartamento: ctx.apto.id },
      });
      if (!vis) throw new BadRequestException('Visitante não encontrado neste apartamento.');
      // Libera o acesso do visitante na janela informada e limpa saída/entrada anteriores.
      let pin = vis.codigo_acesso;
      if (!pin) {
        pin = Math.floor(100000 + Math.random() * 900000).toString();
      }
      await this.prisma.visitantes.update({
        where: { id: idVisitante },
        data: {
          liberado: 1,
          data_entrada: null,
          data_saida: null,
          codigo_acesso: pin,
          ...(inicio ? { data_hora_inicio: inicio } : {}),
          ...(fim ? { data_hora_termino: fim } : {}),
        },
      });
    } else {
      idBeneficiario = Number(body?.id_morador_beneficiario) || null;
      if (!idBeneficiario) throw new BadRequestException('Selecione um inquilino.');
      const inq = await this.prisma.moradores.findFirst({
        where: { id: idBeneficiario, id_condominio: ctx.idCondominio },
      });
      if (!inq) throw new BadRequestException('Inquilino não encontrado.');
    }

    const vaga = await this.prisma.vagas.create({
      data: {
        id_condominio: ctx.idCondominio,
        id_apartamento: ctx.apto.id,
        id_morador_titular: ctx.moradorId,
        tipo_ocupacao: tipo,
        id_visitante: idVisitante,
        id_morador_beneficiario: idBeneficiario,
        id_veiculo: Number(body?.id_veiculo) || null,
        placa,
        inicio,
        fim,
      },
      include: { veiculo: true, visitante: true, beneficiario: true, titular: true },
    });

    // Liberação automática do facial/portão: enrola o visitante em todos os
    // terminais faciais do condomínio já com a janela da reserva (ValidFrom/
    // ValidTo derivados de data_hora_inicio/termino que acabamos de gravar).
    // Fire-and-forget: uma falha de device não pode derrubar a reserva; o
    // próprio syncVisitante grava face_sync_status e os ticks fazem retry.
    if (idVisitante) {
      this.facial
        .syncVisitante(idVisitante)
        .catch((err) =>
          console.error('[vagas] falha ao sincronizar facial do visitante', idVisitante, err?.message),
        );
    }

    return this.mapVaga(vaga);
  }

  async revogarVaga(idUser: number, idCondominio: number, id: number) {
    if (!this.prisma.isConnected) throw new ServiceUnavailableException('Banco de dados indisponível.');
    const ctx = await this.resolveMoradorApto(idUser, idCondominio);
    if (!ctx) throw new BadRequestException('Acesso negado.');
    // Busca a vaga antes de revogar para conhecer o tipo/visitante afetado.
    const vaga = await this.prisma.vagas.findFirst({
      where: { id: Number(id), id_apartamento: ctx.apto.id, ativo: 1 },
    });
    if (!vaga) throw new BadRequestException('Vaga não encontrada.');
    await this.prisma.vagas.update({ where: { id: vaga.id }, data: { ativo: 0 } });

    // Reconcilia o estado no device: re-sincroniza o visitante para refletir a
    // vaga revogada. Não-destrutivo (não força liberado=0), pois o visitante
    // pode estar autorizado por outro caminho; o acesso encerra em `fim` via o
    // tick de expiração já existente.
    if (vaga.tipo_ocupacao === 'visitante' && vaga.id_visitante) {
      this.facial
        .syncVisitante(vaga.id_visitante)
        .catch((err) =>
          console.error('[vagas] falha ao reconciliar facial do visitante', vaga.id_visitante, err?.message),
        );
    }

    return { ok: true };
  }
}
