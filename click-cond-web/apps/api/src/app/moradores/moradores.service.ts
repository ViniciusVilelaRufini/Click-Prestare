import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import * as crypto from 'crypto';

export interface CreateMoradorDto {
  nome: string;
  documento?: string;
  email?: string;
  telefone?: string;
  data_nascimento?: string;
  tipo?: string;
  id_apartamento: number;
  id_condominio: number;
  sendCredentials?: boolean;
}

@Injectable()
export class MoradoresService {
  private static mockMoradores = [
    { id: 1, nome: 'João da Silva', documento: '11122233344', email: 'joao@example.com', telefone: '11999998888', data_nascimento: null, tipo: 'proprietario', bloco: 'A', apartamento: '101', id_apartamento: 0, id_condominio: 1, photo: null },
    { id: 2, nome: 'Maria Oliveira', documento: '55566677788', email: 'maria@example.com', telefone: '11988887777', data_nascimento: null, tipo: 'inquilino', bloco: 'B', apartamento: '202', id_apartamento: 0, id_condominio: 1, photo: null },
  ];

  private readonly logger = new Logger(MoradoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private fireWelcomeEmail(email: string, nome: string, senha?: string) {
    if (senha) {
      this.mail
        .sendWelcomeMorador(email, nome, senha)
        .catch((err) => this.logger.warn(`Falha ao enviar credenciais para ${email}: ${err?.message ?? err}`));
    } else {
      this.mail
        .sendWelcomeMoradorExisting(email, nome)
        .catch((err) => this.logger.warn(`Falha ao enviar boas-vindas para ${email}: ${err?.message ?? err}`));
    }
  }

  /**
   * Moradores no schema legado têm FK para Users e podem ter id_condominio.
   * Para a portaria, listamos moradores diretamente filtrados por id_condominio
   * e juntamos foto via Users. Quando o app legado popular Apartamentos_Users
   * podemos cruzar pelo apartamento.
   */
  async findAll(idCondominio: number, search?: string, idApto?: number) {
    if (!this.prisma.isConnected) {
      return MoradoresService.mockMoradores.filter(m => 
        !search || m.nome.toLowerCase().includes(search.toLowerCase()) || (m.documento || '').includes(search)
      );
    }
    const list = await this.prisma.moradores.findMany({
      where: {
        id_condominio: idCondominio,
        ...(idApto
          ? {
              user: {
                apartamentosUsers: {
                  some: {
                    id_apto: idApto,
                  },
                },
              },
            }
          : {}),
        ...(search
          ? {
              OR: [
                { nome: { contains: search } },
                { documento: { contains: search } },
                { apartamento: { contains: search } },
                { bloco: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        user: {
          select: {
            photo: true,
            apartamentosUsers: {
              select: {
                id_apto: true,
              },
            },
          },
        },
      },
      orderBy: { nome: 'asc' },
    });

    return list.map((m) => {
      const idAptoMapped = m.user?.apartamentosUsers?.[0]?.id_apto ?? 0;
      return {
        id: m.id,
        nome: m.nome,
        documento: m.documento,
        email: m.email,
        telefone: m.telefone,
        data_nascimento: m.data_nascimento,
        tipo: m.tipo,
        bloco: m.bloco,
        apartamento: m.apartamento,
        id_apartamento: idAptoMapped,
        id_condominio: m.id_condominio,
        photo: m.user?.photo ?? null,
      };
    });
  }

  async findOne(id: number) {
    if (!this.prisma.isConnected) {
      const m = MoradoresService.mockMoradores.find(x => x.id === id);
      if (!m) throw new NotFoundException(`Morador ${id} não encontrado`);
      return m;
    }
    const m = await this.prisma.moradores.findUnique({
      where: { id },
      include: { user: { select: { photo: true } } },
    });
    if (!m) throw new NotFoundException(`Morador ${id} não encontrado`);
    return {
      ...m,
      photo: m.user?.photo ?? null,
    };
  }

  /**
   * Criação simplificada: assumimos que o porteiro está só registrando dados
   * básicos. Cria um Users mínimo se ainda não existir e vincula via id_user.
   */
  async create(dto: CreateMoradorDto) {
    if (!this.prisma.isConnected) {
      const newM = {
        id: MoradoresService.mockMoradores.length + 1,
        nome: dto.nome,
        documento: dto.documento || null,
        email: dto.email || null,
        telefone: dto.telefone || null,
        data_nascimento: dto.data_nascimento ? new Date(dto.data_nascimento) : null,
        tipo: dto.tipo || 'proprietario',
        bloco: 'A',
        apartamento: '101',
        id_apartamento: 0,
        id_condominio: dto.id_condominio,
        photo: null,
      };
      MoradoresService.mockMoradores.push(newM as any);
      if (dto.sendCredentials && dto.email) {
        this.fireWelcomeEmail(dto.email, dto.nome, dto.documento || '123456');
      }
      return newM;
    }
    const md5Password = crypto.createHash('md5').update(dto.documento || '123456').digest('hex');
    let passwordWasSet = false;

    // Cria/encontra Users por email se fornecido
    let userId: number;
    if (dto.email) {
      const existing = await this.prisma.users.findFirst({
        where: { email: dto.email },
      });
      if (existing) {
        userId = existing.id;
        // Atualiza login e password caso estejam vazios para permitir acesso
        if (!existing.login || !existing.password) {
          await this.prisma.users.update({
            where: { id: existing.id },
            data: {
              login: dto.email,
              password: md5Password,
            },
          });
          passwordWasSet = true;
        }
      } else {
        const u = await this.prisma.users.create({
          data: {
            name: dto.nome,
            email: dto.email,
            login: dto.email,
            password: md5Password,
            phone: dto.telefone,
            cpf: dto.documento,
            is_morador: 1,
            login_type: 'morador',
          },
        });
        userId = u.id;
        passwordWasSet = true;
      }
    } else {
      const u = await this.prisma.users.create({
        data: {
          name: dto.nome,
          phone: dto.telefone,
          cpf: dto.documento,
          is_morador: 1,
          login_type: 'morador',
        },
      });
      userId = u.id;
    }

    // Busca dados do apartamento
    let bloco = '';
    let aptoNum = '';
    if (dto.id_apartamento) {
      const aptoObj = await this.prisma.apartamentos.findUnique({
        where: { id: Number(dto.id_apartamento) },
      });
      if (aptoObj) {
        bloco = aptoObj.bloco || '';
        aptoNum = aptoObj.apto || '';

        // Insere o vinculo em Apartamentos_Users
        const dataVenc = new Date();
        dataVenc.setDate(dataVenc.getDate() + 45);
        await this.prisma.apartamentos_Users.create({
          data: {
            id_apto: aptoObj.id,
            id_user: userId,
            tipo: dto.tipo || 'proprietario',
            vencimento: dataVenc,
          },
        });
      }
    }

    const createdMorador = await this.prisma.moradores.create({
      data: {
        nome: dto.nome,
        documento: dto.documento ?? null,
        email: dto.email ?? null,
        telefone: dto.telefone ?? null,
        data_nascimento: dto.data_nascimento ? new Date(dto.data_nascimento) : null,
        tipo: dto.tipo ?? 'proprietario',
        id_user: userId,
        id_condominio: dto.id_condominio,
        bloco: bloco || null,
        apartamento: aptoNum || null,
      },
    });

    if (dto.sendCredentials && dto.email) {
      this.fireWelcomeEmail(dto.email, dto.nome, passwordWasSet ? (dto.documento || '123456') : undefined);
    }

    return createdMorador;
  }

  async update(id: number, dto: Partial<CreateMoradorDto>) {
    if (!this.prisma.isConnected) {
      const idx = MoradoresService.mockMoradores.findIndex(x => x.id === id);
      if (idx !== -1) {
        MoradoresService.mockMoradores[idx] = { ...MoradoresService.mockMoradores[idx], ...dto } as any;
        return MoradoresService.mockMoradores[idx];
      }
      throw new NotFoundException(`Morador ${id} não encontrado`);
    }

    // Carrega o morador atual com seu Users vinculado
    const atual = await this.prisma.moradores.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!atual) throw new NotFoundException(`Morador ${id} não encontrado`);

    // Se o email mudou, valida unicidade no Users (login + email)
    const emailMudou = dto.email !== undefined && dto.email !== atual.email;
    if (emailMudou && dto.email) {
      const conflito = await this.prisma.users.findFirst({
        where: {
          OR: [{ email: dto.email }, { login: dto.email }],
          NOT: { id: atual.id_user },
        },
        select: { id: true },
      });
      if (conflito) {
        throw new BadRequestException('Já existe outro usuário com este e-mail.');
      }
    }

    return await this.prisma.$transaction(async (tx) => {
      // Atualiza moradores
      const morador = await tx.moradores.update({
        where: { id },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.documento !== undefined && { documento: dto.documento }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.telefone !== undefined && { telefone: dto.telefone }),
          ...(dto.tipo !== undefined && { tipo: dto.tipo }),
          ...(dto.data_nascimento !== undefined && {
            data_nascimento: dto.data_nascimento ? new Date(dto.data_nascimento) : null,
          }),
        },
      });

      // Propaga para Users (login/email/phone/name/cpf) para manter o acesso ao app
      const userPatch: any = {};
      if (dto.nome !== undefined) userPatch.name = dto.nome;
      if (dto.telefone !== undefined) userPatch.phone = dto.telefone;
      if (dto.documento !== undefined) userPatch.cpf = dto.documento || null;
      if (emailMudou) {
        userPatch.email = dto.email || null;
        userPatch.login = dto.email || null;
      }
      if (Object.keys(userPatch).length > 0 && atual.id_user) {
        await tx.users.update({
          where: { id: atual.id_user },
          data: userPatch,
        });
      }

      return morador;
    });
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) {
      MoradoresService.mockMoradores = MoradoresService.mockMoradores.filter(x => x.id !== id);
      return;
    }
    try {
      await this.prisma.moradores.delete({ where: { id } });
    } catch {
      throw new NotFoundException(`Morador ${id} não encontrado`);
    }
  }

  async sendCredentials(id: number) {
    const m = await this.findOne(id);
    if (!m.email) {
      throw new NotFoundException('Morador não possui e-mail cadastrado');
    }
    this.fireWelcomeEmail(m.email, m.nome, m.documento || '123456');
    return { ok: true };
  }

  async exportExcel(idCondominio: number) {
    const list = await this.findAll(idCondominio);
    try {
      const xlsx = require('xlsx');
      const ws = xlsx.utils.json_to_sheet(list.map(m => ({
        'Nome Completo': m.nome,
        'Documento': m.documento || '',
        'E-mail': m.email || '',
        'Telefone': m.telefone || '',
        'Quadra/Bloco': m.bloco || '',
        'Lote/Apto': m.apartamento || '',
        'Vínculo': m.tipo || 'proprietario',
      })));
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Moradores');
      const base64 = xlsx.write(wb, { type: 'base64', bookType: 'xlsx' });
      return { base64, filename: `moradores_condominio_${idCondominio}.xlsx` };
    } catch {
      const csv = ['Nome Completo,Documento,E-mail,Telefone,Quadra/Bloco,Lote/Apto,Vínculo']
        .concat(list.map(m => `"${m.nome}","${m.documento||''}","${m.email||''}","${m.telefone||''}","${m.bloco||''}","${m.apartamento||''}","${m.tipo||''}"`))
        .join('\n');
      return { base64: Buffer.from(csv).toString('base64'), filename: `moradores_condominio_${idCondominio}.csv` };
    }
  }

  async importBulk(idCondominio: number, linhas: any[]) {
    const criados = [];
    for (const item of linhas) {
      if (!item.nome) continue;
      try {
        const m = await this.create({
          nome: item.nome,
          documento: item.documento?.toString() || undefined,
          email: item.email?.toString() || undefined,
          telefone: item.telefone?.toString() || undefined,
          tipo: item.tipo?.toString() || 'proprietario',
          id_apartamento: 0,
          id_condominio: idCondominio,
          sendCredentials: item.sendCredentials !== false,
        });
        criados.push(m);
      } catch (err: any) {
        console.log('Erro ao importar linha:', item.nome, err?.message);
      }
    }
    return { ok: true, total: criados.length, criados };
  }
}