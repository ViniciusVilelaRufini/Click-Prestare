import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from './jwt-payload.interface';
import { StorageService } from '../common/storage/storage.service';

@Injectable()
export class MobileAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
  ) {}

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

    return { token: this.jwt.sign(payload), user: userObj };
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

    // 1. Criar Usuário
    const user = await this.prisma.users.create({
      data: {
        login: emailNormalized,
        email: emailNormalized,
        password: hashedPassword,
        is_sindico: 1,
        name: body.nome,
        phone: phone,
        photo: body.photo || null,
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

    return { token: this.jwt.sign(payload), user: userObj };
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
          photo: body.photo !== undefined ? body.photo : user.photo,
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
        dias_restantes_condominio: 200
      }];
    }

    try {
      const rels = await this.prisma.sindicos_Condominios.findMany({
        where: { id_user: idUser },
        include: {
          condominio: {
            include: {
              financeiro: { where: { pago: 1 }, select: { valor: true, created_at: true } },
              apartamentos: true,
            },
          },
        },
      });

      const resultList = rels.map(r => {
        const c = r.condominio;
        if (!c || c.ativo === 0) return null;
        
        // Garante que financeiro seja tratado como array mesmo se vier nulo/indefinido
        const financeiro = c.financeiro ?? [];
        const apartamentos = c.apartamentos ?? [];

        const saldoNum = financeiro.reduce((acc, f) => acc + (Number(f.valor) || 0), 0);
        const saldoStr = saldoNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        return {
          id: c.id,
          nome: c.nome,
          num_blocos: c.num_blocos ?? 1,
          num_aptos: apartamentos.length > 0 ? apartamentos.length : (c.num_aptos ?? 0),
          moeda: c.moeda ?? 'R$',
          updatedAt: c.updated_at ? c.updated_at.toLocaleDateString('pt-BR') : '',
          photo: c.photo ?? '',
          saldo: saldoStr,
          data_financeiro: financeiro.length > 0 ? financeiro[financeiro.length - 1].created_at.toLocaleDateString('pt-BR') : '-',
          vencimento_condominio: c.vencimento ? c.vencimento.toLocaleDateString('pt-BR') : '',
          dias_restantes_condominio: c.vencimento ? Math.ceil((c.vencimento.getTime() - Date.now()) / 86400000) : 100,
        };
      }).filter(Boolean);

      if (resultList.length > 0) return resultList;
    } catch (e) {
      // Ignora falha interna do PrismaClient e segue para o mock
    }

    return [];
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

    return { token: this.jwt.sign(payload), user: userObj };
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

    const user = await this.prisma.users.findFirst({
      where: { login },
      include: { funcionarios: true },
    });

    if (!user || !user.funcionarios || user.funcionarios.length === 0) {
      throw new UnauthorizedException('Login ou Senha incorretos');
    }

    const isMatch = await this.verifyPassword(senhaRaw, user.password, user.id);

    if (!isMatch) {
      throw new UnauthorizedException('Login ou Senha incorretos');
    }

    const func = user.funcionarios[0];
    const userObj = {
      id: user.id,
      nome: func.nome,
      photo: user.photo ?? '',
      areas_sociais: func.areas_sociais ?? 0,
      comunicados: func.comunicados ?? 0,
      ocorrencias: func.ocorrencias ?? 0,
      manutencoes_programadas: func.manutencoes_programadas ?? 0,
      prestadores_servico: func.prestadores_servico ?? 0,
      agendar_mudanca: func.agendar_mudanca ?? 0,
      cadastrar_visitante: func.cadastrar_visitante ?? 0,
      apartamentos: func.apartamentos ?? 0,
    };
    const payload = { sub: user.id, nome: func.nome, typeAccess: 'Funcionario', user: userObj };

    return { token: this.jwt.sign(payload), user: userObj };
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

        const fins = await this.prisma.financeiro.findMany({
          where: { id_condominio: { in: ids }, pago: 0 },
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
          data_hora_inicio: { gte: hojeIni, lte: hojeFim },
          is_prestador: { not: 1 },
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
        const blocoFiltro = (m.bloco === null || m.bloco === undefined || m.bloco.trim() === '')
          ? { in: [null, ''] }
          : m.bloco;

        const cnt = await this.prisma.encomendas.count({
          where: {
            id_condominio: m.id_condominio,
            destinatario_bloco: blocoFiltro,
            destinatario_apto: m.apartamento,
            status: 'Aguardando',
          },
        });
        packagesCount += cnt;
      }

      return {
        visits: visitsCount,
        packages: packagesCount,
      };
    }
  }

  // ==========================================
  // CONDOMÍNIO DETALHES GERAL
  // ==========================================
  async getCondominioById(id: number) {
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
          financeiro: { where: { pago: 1 } },
          apartamentos: true,
        },
      });

      if (!c) return mockCond;

      const saldoNum = c.financeiro?.reduce((acc, f) => acc + (Number(f.valor) || 0), 0) ?? 0;
      const saldoStr = saldoNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  async updateInfosCondominio(body: any) {
    const data = body.condominio || {};
    const id = Number(data.id);
    if (!id) throw new BadRequestException('ID do condomínio é obrigatório.');

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

  async updateAddressCondominio(body: any) {
    const addr = body.address || {};
    const idCondominio = Number(addr.idCondominio);
    if (!idCondominio) throw new BadRequestException('ID do condomínio é obrigatório.');

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

  async updateMoedaCondominio(body: any) {
    const data = body.condominio || {};
    const id = Number(data.id);
    if (!id) throw new BadRequestException('ID do condomínio é obrigatório.');

    if (!this.prisma.isConnected) return { success: true };

    await this.prisma.condominios.update({
      where: { id },
      data: { moeda: data.moeda },
    });

    return { success: true };
  }

  async updateAssinaturaCondominio(body: any, idUser: number) {
    const data = body.assinatura || {};
    const idCondominio = Number(data.id_condominio);
    const idPlano = data.id_plano;
    const codigo = data.codigo || '';
    const plataforma = data.plataforma || 'Mobile';

    if (!idCondominio) throw new BadRequestException('ID do condomínio é obrigatório.');
    if (!idPlano) throw new BadRequestException('ID/Nome do plano é obrigatório.');

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
    const md5Hash = createHash('md5').update(novaSenha).digest('hex');
    await this.prisma.funcionarios_Portaria.update({ where: { id: func.id }, data: { password: md5Hash } });
    await this.mail.sendForgotPassword(email, novaSenha, 'Funcionário');
    return { success: true };
  }

  // ==========================================
  // FUNCIONÁRIOS DE PORTARIA (MOBILE) — persistência real
  // ==========================================

  async getAllFuncionarios(idCond: number) {
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
      select: { login: true, photo: true }
    });
    const userPhotoMap = new Map(users.map(u => [u.login, u.photo]));

    return reais.map(f => ({
      id: f.id,
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

  async getFuncionarioById(id: number) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const f = await this.prisma.funcionarios_Portaria.findUnique({ where: { id: Number(id) } });
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
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

  async saveFuncionario(body: any, isEdit: boolean) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
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
        const md5Pwd = senhaPlana ? createHash('md5').update(senhaPlana).digest('hex') : fp.password;

        if (!user) {
          user = await this.prisma.users.create({
            data: {
              login: fp.login,
              email: fp.email || fp.login,
              password: md5Pwd,
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
          await this.prisma.users.update({
            where: { id: user.id },
            data: {
              name: fp.nome,
              phone: fp.telefone,
              email: fp.email || fp.login,
              password: md5Pwd,
              is_funcionario: 1,
              ...(uploadedPhotoUrl !== undefined && { photo: uploadedPhotoUrl, profile_image: uploadedPhotoUrl }),
            }
          });
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
    if (!func.nome) throw new BadRequestException('Nome é obrigatório.');
    const loginFinal = func.email || func.login;
    if (!loginFinal) throw new BadRequestException('E-mail é obrigatório para login do porteiro.');

    const conflito = await this.prisma.funcionarios_Portaria.findUnique({ where: { login: loginFinal } });
    if (conflito) throw new BadRequestException('Já existe um funcionário com este e-mail.');

    // Senha inicial = senha recebida, documento ou '123456'
    const senhaInicial = func.senha || func.password || (func.documento && String(func.documento).trim()) || '123456';
    const md5Pwd = createHash('md5').update(senhaInicial).digest('hex');

    const created = await this.prisma.funcionarios_Portaria.create({
      data: {
        nome: func.nome,
        login: loginFinal,
        password: md5Pwd,
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

  async removeFuncionario(id: number) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    try {
      const fp = await this.prisma.funcionarios_Portaria.findUnique({ where: { id: Number(id) } });
      if (fp) {
        const user = await this.prisma.users.findFirst({ where: { login: fp.login } });
        if (user) {
          await this.prisma.funcionarios.deleteMany({ where: { id_user: user.id } });
          await this.prisma.users.delete({ where: { id: user.id } });
        }
        await this.prisma.funcionarios_Portaria.delete({ where: { id: Number(id) } });
      }
    } catch {
      throw new NotFoundException('Funcionário não encontrado.');
    }
    return true;
  }

  async getAllMoradores(idCond: number) {
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
      bloco: m.bloco ?? '',
      apartamento: m.apartamento ?? '',
      photo: m.foto_pessoa ?? m.user?.photo ?? '',
      foto_pessoa: m.foto_pessoa ?? '',
      vinculo: m.tipo ?? 'proprietario',
      tipo: m.tipo ?? 'proprietario',
    }));
  }

  async getMoradorById(id: number, idUser: number) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    let m;
    if (id === 0) {
      m = await this.prisma.moradores.findFirst({
        where: { id_user: idUser },
        include: { user: true },
      });
    } else {
      m = await this.prisma.moradores.findUnique({
        where: { id: Number(id) },
        include: { user: true },
      });
    }

    if (!m) throw new NotFoundException('Morador não encontrado.');

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
      photo: m.user?.photo ?? '',
      vinculo: m.tipo ?? 'proprietario',
      tipo: m.tipo ?? 'proprietario',
      extra1: m.extra1 ?? '',
      extra2: m.extra2 ?? '',
      extra3: m.extra3 ?? '',
      extra4: m.extra4 ?? '',
    };
  }

  async saveMorador(body: any, isEdit: boolean) {
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
              ...(mor.data_nascimento && { data_nascimento: new Date(mor.data_nascimento) }),
              ...(tipo && { tipo }),
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

        return '';
      }

      // ===== CRIAÇÃO =====
      if (!idApto) throw new BadRequestException('Apartamento não informado.');

      const apto = await this.prisma.apartamentos.findUnique({ where: { id: idApto } });
      if (!apto) throw new NotFoundException('Apartamento não encontrado.');

      const idCondominio = Number(body.id_condominio) || apto.id_condominio;

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
      const senhaInicial = cpf || '123456';
      const md5Pwd = createHash('md5').update(senhaInicial).digest('hex');

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
          patch.password = md5Pwd;
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
            password: md5Pwd,
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
          data_nascimento: mor.data_nascimento ? new Date(mor.data_nascimento) : null,
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

  async removeMorador(id: number) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
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

  async getAllApartamentos(idCond: number) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const reais = await this.prisma.apartamentos.findMany({
      where: { id_condominio: Number(idCond) },
      include: {
        users: { include: { user: true } },
        _count: { select: { users: true } },
      },
    });

    reais.sort((a, b) => {
      if (a.bloco === b.bloco) {
        return (a.apto ?? '').localeCompare(b.apto ?? '', 'pt', { numeric: true });
      }
      return (a.bloco ?? '').localeCompare(b.bloco ?? '');
    });

    return reais.map(a => ({
      id: a.id,
      bloco: a.bloco ?? '',
      apto: a.apto ?? '',
      numero: a.apto ?? '',
      fracao: a.fracao ?? '',
      id_condominio: a.id_condominio,
      qtdMoradores: a._count.users,
      moradores: a.users.map(u => u.user.name ?? '').filter(Boolean).join(', '),
    }));
  }

  async getMoradoresApto(idApto: number, tipo?: string) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    // Normaliza filtro de tipo: "Proprietário" -> "proprietario"
    const tipoNorm = tipo
      ? tipo.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
      : undefined;

    const rels = await this.prisma.apartamentos_Users.findMany({
      where: {
        id_apto: Number(idApto),
        ...(tipoNorm ? { tipo: tipoNorm } : {}),
      },
      include: {
        user: { include: { moradores: true } },
      },
    });

    return rels.map(r => {
      const m = r.user.moradores[0];
      return {
        id: m?.id ?? r.id_user, // Flutter usa esse id para abrir o detalhe
        id_user: r.id_user,
        nome: r.user.name ?? m?.nome ?? '',
        email: r.user.email ?? m?.email ?? '',
        telefone: r.user.phone ?? m?.telefone ?? '',
        tipo: r.tipo ?? 'morador',
        photo: r.user.photo ?? '',
      };
    });
  }

  async saveApto(body: any, isEdit: boolean) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    const idCond = Number(body.id_condominio);
    const data = body.Apartamento ?? body.apartamento ?? {};

    if (!data.apto) throw new BadRequestException('Apto é obrigatório.');

    try {
      if (isEdit) {
        const id = Number(data.id);
        if (!id) throw new BadRequestException('ID do apartamento é obrigatório para edição.');
        return await this.prisma.apartamentos.update({
          where: { id },
          data: {
            ...(data.bloco !== undefined && { bloco: data.bloco }),
            ...(data.apto !== undefined && { apto: data.apto }),
            ...(data.fracao !== undefined && { fracao: data.fracao }),
          },
        });
      }
      if (!idCond) throw new BadRequestException('id_condominio é obrigatório.');
      return await this.prisma.apartamentos.create({
        data: {
          id_condominio: idCond,
          bloco: data.bloco ?? null,
          apto: data.apto,
          fracao: data.fracao ?? null,
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

  async removeApto(id: number) {
    if (!this.prisma.isConnected) {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    try {
      await this.prisma.apartamentos.delete({ where: { id: Number(id) } });
    } catch {
      throw new NotFoundException('Apartamento não encontrado.');
    }
    return true;
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

  async saveOcorrencia(body: any, idUser: number) {
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
    try {
      return await this.prisma.ocorrencias.create({
        data: {
          id_condominio: Number(idCondominio),
          descricao: descricao,
          tipo: tipo ? Number(tipo) : null,
          user: idUser,
          status: 'Pendente',
          publica: publica,
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

    return list.map(o => this.mapOcorrencia(o));
  }

  /**
   * Lista todas as ocorrências visíveis para o usuário logado.
   * - Síndico/Funcionário: vê todas do condomínio.
   * - Morador: vê só as próprias ou as públicas.
   */
  async listOcorrenciasTodos(idCondominio: number, idUser: number, typeAccess: string) {
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
    return list.map(o => this.mapOcorrencia(o));
  }

  /**
   * Lista somente as ocorrências NÃO solucionadas (Pendente, Ciente, etc.).
   */
  async listOcorrenciasPendentes(idCondominio: number, idUser: number, typeAccess: string) {
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
    return list.map(o => this.mapOcorrencia(o));
  }

  private mapOcorrencia(o: any) {
    return {
      id: o.id,
      descricao: o.descricao ?? '',
      tipo: o.categoria?.nome ?? '',
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

  async getOcorrenciaById(id: number) {
    if (!this.prisma.isConnected) return null;
    const o = await this.prisma.ocorrencias.findUnique({
      where: { id },
      include: { categoria: true, criadoPor: { select: { name: true } } },
    });
    if (!o) return null;
    return this.mapOcorrencia(o);
  }

  // ==========================================
  // FINANCEIRO (MOBILE)
  // ==========================================

  async listFinanceiroByUser(idUser: number) {
    try {
      if (this.prisma.isConnected) {
        const moras = await this.prisma.moradores.findMany({
          where: { id_user: idUser },
          select: { id_condominio: true }
        });
        const ids = moras.map(m => m.id_condominio);

        return await this.prisma.financeiro.findMany({
          where: {
            id_condominio: { in: ids.filter((v): v is number => v !== null) },
            pago: 0,
          },
          orderBy: { data_vencimento: 'asc' },
          select: {
            id: true,
            nome: true,
            valor: true,
            data_vencimento: true,
            status: true,
            url_boleto: true,
          }
        });
      }
    } catch (e) {}
    return [];
  }

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
          const blocoFiltro = (m.bloco === null || m.bloco === undefined || m.bloco.trim() === '')
            ? { in: [null, ''] }
            : m.bloco;

          const list = await this.prisma.encomendas.findMany({
            where: {
              id_condominio: m.id_condominio,
              destinatario_bloco: blocoFiltro,
              destinatario_apto: m.apartamento,
            },
            orderBy: { created_at: 'desc' },
          });
          total = [...total, ...list];
        }
        return total;
      }
    } catch (e) {}
    return [];
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
        access_token: this.jwt.sign(payload),
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
        access_token: this.jwt.sign(payload),
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
        access_token: this.jwt.sign(payload),
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
}
