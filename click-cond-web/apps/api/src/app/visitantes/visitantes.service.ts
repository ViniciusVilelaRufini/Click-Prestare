import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';

export interface CreateVisitanteDto {
  nome: string;
  doc_identificacao?: string;
  data_hora_inicio?: string;
  data_hora_termino?: string;
  is_visitante?: number;
  is_prestador?: number;
  id_apartamento: number;
  id_condominio: number;
  foto_documento?: string;
  foto_pessoa?: string;
}

export interface UpdateVisitanteDto extends Partial<CreateVisitanteDto> {
  id: number;
}

@Injectable()
export class VisitantesService {
  private readonly logger = new Logger(VisitantesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly facial: FacialService,
  ) {}

  private fireFacialSync(idVisitante: number) {
    this.facial
      .syncVisitante(idVisitante)
      .catch((err) => this.logger.warn(`Sync facial visitante ${idVisitante} falhou: ${err?.message ?? err}`));
  }

  private async resolveFoto(value: string | undefined | null): Promise<string | null> {
    if (!value) return value ?? null;
    if (this.storage.isDataUrl(value)) {
      return (await this.storage.uploadDataUrl(value, 'visitantes')) ?? null;
    }
    return value;
  }

  async findAll(idCondominio: number, search?: string) {
    if (!this.prisma.isConnected) {
      const mocks = [
        {
          id: 101,
          nome: 'Carlos Eduardo Pereira',
          doc_identificacao: 'RG 45.123.890-X',
          data_hora_inicio: new Date(),
          data_hora_termino: null,
          is_visitante: 1,
          is_prestador: 0,
          id_apartamento: 1,
          id_condominio: Number(idCondominio),
          created_at: new Date(),
          apartamento: { bloco: 'A', apto: '101' },
        },
        {
          id: 102,
          nome: 'Instalação Vivo Fibra (Técnico Marcos)',
          doc_identificacao: 'CPF 234.567.890-12',
          data_hora_inicio: new Date(Date.now() - 3600000),
          data_hora_termino: null,
          is_visitante: 0,
          is_prestador: 1,
          id_apartamento: 4,
          id_condominio: Number(idCondominio),
          created_at: new Date(Date.now() - 3600000),
          apartamento: { bloco: 'B', apto: '202' },
        },
        {
          id: 103,
          nome: 'Ana Julia Souza',
          doc_identificacao: 'RG 12.345.678-9',
          data_hora_inicio: new Date(Date.now() - 86400000),
          data_hora_termino: new Date(Date.now() - 72000000),
          is_visitante: 1,
          is_prestador: 0,
          id_apartamento: 15,
          id_condominio: Number(idCondominio),
          created_at: new Date(Date.now() - 86400000),
          apartamento: { bloco: 'A', apto: '504' },
        },
      ];

      if (search) {
        const s = search.toLowerCase();
        return mocks.filter(
          (m) =>
            m.nome.toLowerCase().includes(s) ||
            (m.doc_identificacao && m.doc_identificacao.toLowerCase().includes(s)),
        );
      }
      return mocks;
    }

    return this.prisma.visitantes.findMany({
      where: {
        id_condominio: Number(idCondominio),
        ...(search
          ? {
              OR: [
                { nome: { contains: search } },
                { doc_identificacao: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        apartamento: { select: { bloco: true, apto: true } },
      },
      orderBy: [{ data_hora_inicio: 'desc' }, { created_at: 'desc' }],
    });
  }

  async findOne(id: number) {
    if (!this.prisma.isConnected) {
      return {
        id,
        nome: 'Carlos Eduardo Pereira',
        doc_identificacao: 'RG 45.123.890-X',
        data_hora_inicio: new Date(),
        data_hora_termino: null,
        is_visitante: 1,
        is_prestador: 0,
        id_apartamento: 1,
        id_condominio: 1,
        created_at: new Date(),
        apartamento: { bloco: 'A', apto: '101' },
      };
    }

    const v = await this.prisma.visitantes.findUnique({
      where: { id: Number(id) },
      include: { apartamento: { select: { bloco: true, apto: true } } },
    });
    if (!v) throw new NotFoundException(`Visitante ${id} não encontrado`);
    return v;
  }

  async create(dto: CreateVisitanteDto) {
    if (!this.prisma.isConnected) {
      return {
        id: Date.now(),
        nome: dto.nome,
        doc_identificacao: dto.doc_identificacao ?? null,
        data_hora_inicio: dto.data_hora_inicio ? new Date(dto.data_hora_inicio) : new Date(),
        data_hora_termino: dto.data_hora_termino ? new Date(dto.data_hora_termino) : null,
        is_visitante: dto.is_visitante ?? 1,
        is_prestador: dto.is_prestador ?? 0,
        id_apartamento: dto.id_apartamento,
        id_condominio: dto.id_condominio,
        foto_documento: dto.foto_documento ?? null,
        foto_pessoa: dto.foto_pessoa ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      };
    }

    const fotoDoc = await this.resolveFoto(dto.foto_documento);
    const fotoPes = await this.resolveFoto(dto.foto_pessoa);

    // Gerar PIN único e ativo
    let pin = '';
    let isUnique = false;
    while (!isUnique) {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      const check = await this.prisma.visitantes.findFirst({
        where: { codigo_acesso: pin, data_saida: null },
      });
      if (!check) {
        isUnique = true;
      }
    }

    const visitante = await this.prisma.visitantes.create({
      data: {
        nome: dto.nome,
        doc_identificacao: dto.doc_identificacao ?? null,
        data_hora_inicio: dto.data_hora_inicio ? new Date(dto.data_hora_inicio) : new Date(),
        data_hora_termino: dto.data_hora_termino ? dto.data_hora_termino ? new Date(dto.data_hora_termino) : null : null,
        is_visitante: dto.is_visitante ?? 1,
        is_prestador: dto.is_prestador ?? 0,
        id_apartamento: dto.id_apartamento,
        id_condominio: dto.id_condominio,
        foto_documento: fotoDoc,
        foto_pessoa: fotoPes,
        codigo_acesso: pin,
      },
    });

    // Notificar moradores
    try {
      const moradores = await this.prisma.users.findMany({
        where: {
          apartamentosUsers: {
            some: {
              id_apto: dto.id_apartamento,
            },
          },
          fcm_token: { not: null },
          notif_visitantes: 1,
        },
        select: { fcm_token: true },
      });

      for (const m of moradores) {
        if (m.fcm_token) {
          await this.notifications.sendPushNotification(
            m.fcm_token,
            dto.is_prestador ? 'Prestador de Serviço' : 'Chegada de Visitante',
            `${dto.nome} acabou de chegar para o seu apartamento.`,
            { id: visitante.id.toString(), type: 'visitante' },
          );
        }
      }
    } catch (error) {
      console.error('Erro ao notificar moradores sobre visitante:', error);
    }

    if (fotoPes) {
      this.fireFacialSync(visitante.id);
    }

    return visitante;
  }

  async update(dto: UpdateVisitanteDto) {
    if (!this.prisma.isConnected) {
      return { success: true, id: dto.id };
    }

    const fotoDoc = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento) : undefined;
    const fotoPes = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa) : undefined;

    try {
      const updated = await this.prisma.visitantes.update({
        where: { id: Number(dto.id) },
        data: {
          ...(dto.nome !== undefined && { nome: dto.nome }),
          ...(dto.doc_identificacao !== undefined && { doc_identificacao: dto.doc_identificacao }),
          ...(dto.data_hora_inicio !== undefined && {
            data_hora_inicio: new Date(dto.data_hora_inicio),
          }),
          ...(dto.data_hora_termino !== undefined && {
            data_hora_termino: dto.data_hora_termino ? new Date(dto.data_hora_termino) : null,
          }),
          ...(dto.is_visitante !== undefined && { is_visitante: dto.is_visitante }),
          ...(dto.is_prestador !== undefined && { is_prestador: dto.is_prestador }),
          ...(dto.id_apartamento !== undefined && { id_apartamento: dto.id_apartamento }),
          ...(fotoDoc !== undefined && { foto_documento: fotoDoc }),
          ...(fotoPes !== undefined && { foto_pessoa: fotoPes }),
        },
      });
      if (fotoPes !== undefined && fotoPes) {
        this.fireFacialSync(updated.id);
      }
      return updated;
    } catch {
      throw new NotFoundException(`Visitante ${dto.id} não encontrado`);
    }
  }

  async remove(id: number) {
    if (!this.prisma.isConnected) return { success: true };
    const v = await this.prisma.visitantes.findUnique({
      where: { id: Number(id) },
      select: { face_id: true, id_condominio: true },
    });
    try {
      await this.prisma.visitantes.delete({ where: { id: Number(id) } });
    } catch {
      throw new NotFoundException(`Visitante ${id} não encontrado`);
    }
    if (v?.face_id) {
      this.facial
        .unsyncVisitante(id, v.face_id, v.id_condominio)
        .catch((err) => this.logger.warn(`Unsync facial visitante ${id} falhou: ${err?.message ?? err}`));
    }
    return { success: true };
  }

  async validarCodigo(idCondominio: number, codigo: string) {
    const v = await this.prisma.visitantes.findFirst({
      where: {
        id_condominio: Number(idCondominio),
        codigo_acesso: codigo,
        data_saida: null,
      },
      include: {
        apartamento: { select: { bloco: true, apto: true } },
        criadoPor: { select: { name: true } },
      },
    });

    if (!v) {
      throw new NotFoundException('Código inválido ou visita não agendada/já encerrada.');
    }

    const now = new Date();
    const inicio = v.data_hora_inicio ? new Date(v.data_hora_inicio) : now;
    const termino = v.data_hora_termino ? new Date(v.data_hora_termino) : now;

    // Grace periods: 15 minutes before start, 15 minutes after end to account for server clock drift
    const GRACE_PERIOD_MS = 15 * 60 * 1000;
    const inicioComTolerancia = new Date(inicio.getTime() - GRACE_PERIOD_MS);
    const terminoComTolerancia = new Date(termino.getTime() + GRACE_PERIOD_MS);

    let status = 'ATIVO';
    if (now < inicioComTolerancia) {
      status = 'FUTURO';
    } else if (now > terminoComTolerancia) {
      status = 'EXPIRADO';
    }

    if (status === 'EXPIRADO') {
      throw new BadRequestException('Acesso negado: O período de validade deste código já expirou.');
    }
    if (status === 'FUTURO') {
      throw new BadRequestException('Acesso negado: O período de validade deste código ainda não iniciou.');
    }

    const formatarData = (d: Date | null) => {
      if (!d) return '';
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    return {
      id: v.id,
      nome: v.nome,
      doc_identificacao: v.doc_identificacao,
      data_inicio: formatarData(v.data_hora_inicio),
      data_termino: formatarData(v.data_hora_termino),
      is_visitante: v.is_visitante,
      is_prestador: v.is_prestador,
      foto_documento: v.foto_documento,
      foto_pessoa: v.foto_pessoa,
      apto: v.apartamento?.apto ?? null,
      apto_bloco: v.apartamento?.bloco ?? null,
      morador_nome: v.criadoPor?.name ?? 'Morador',
      status_vigencia: status,
    };
  }

  async checkIn(id: number) {
    await this.prisma.visitantes.update({
      where: { id: Number(id) },
      data: { data_entrada: new Date(), data_saida: null },
    });
    return { ok: true };
  }

  async checkOut(id: number) {
    await this.prisma.visitantes.update({
      where: { id: Number(id) },
      data: { data_saida: new Date(), codigo_acesso: null },
    });
    return { ok: true };
  }

  async findAllMobile(
    idCondominio?: number,
    idApto?: number,
    search?: string,
    offset = 0,
    userId?: number,
    userType?: string,
  ) {
    const conditions: any[] = [];

    if (idCondominio) {
      conditions.push({ id_condominio: Number(idCondominio) });
      if (idApto) {
        conditions.push({ id_apartamento: Number(idApto) });
      }
    } else if (userId && userType) {
      const typeLower = userType.toLowerCase();
      if (typeLower === 'morador') {
        conditions.push({
          OR: [
            {
              apartamento: {
                users: {
                  some: {
                    id_user: userId,
                  },
                },
              },
            },
            {
              user: userId,
            },
          ],
        });
      } else if (typeLower === 'sindico') {
        const managed = await this.prisma.sindicos_Condominios.findMany({
          where: { id_user: userId },
          select: { id_condominio: true },
        });
        const condoIds = managed.map((m) => m.id_condominio);
        conditions.push({
          id_condominio: { in: condoIds },
        });
      } else if (typeLower === 'funcionario') {
        const func = await this.prisma.funcionarios.findFirst({
          where: { id_user: userId },
          select: { id_condominio: true },
        });
        if (func) {
          conditions.push({
            id_condominio: func.id_condominio,
          });
        } else {
          return [];
        }
      }
    } else {
      return [];
    }

    if (search) {
      conditions.push({
        OR: [
          { nome: { contains: search } },
          { doc_identificacao: { contains: search } },
        ],
      });
    }

    const whereClause = conditions.length > 0 ? { AND: conditions } : {};

    const list = await this.prisma.visitantes.findMany({
      where: whereClause,
      include: {
        apartamento: { select: { bloco: true, apto: true } },
        condominio: { select: { nome: true } },
      },
      orderBy: [{ data_hora_inicio: 'desc' }, { created_at: 'desc' }],
      take: 30,
      skip: offset,
    });

    // Auto-gerar PIN para visitantes sem código e que ainda não saíram
    const updated: any[] = [];
    for (const v of list) {
      if (!v.codigo_acesso && !v.data_saida) {
        const pin = await this.gerarPinUnico();
        const novo = await this.prisma.visitantes.update({
          where: { id: v.id },
          data: { codigo_acesso: pin },
          include: { 
            apartamento: { select: { bloco: true, apto: true } },
            condominio: { select: { nome: true } },
          },
        });
        updated.push(novo);
      } else {
        updated.push(v);
      }
    }

    return updated.map((v: any) => ({
      ...v,
      condominio_nome: v.condominio?.nome || null,
    }));
  }

  private async gerarPinUnico(): Promise<string> {
    let pin = '';
    let isUnique = false;
    while (!isUnique) {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      const check = await this.prisma.visitantes.findFirst({
        where: { codigo_acesso: pin, data_saida: null },
      });
      if (!check) isUnique = true;
    }
    return pin;
  }
}