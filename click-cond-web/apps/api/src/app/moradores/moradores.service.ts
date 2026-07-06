import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../common/mail/mail.service';
import { StorageService } from '../common/storage/storage.service';
import { FacialService } from '../facial/facial.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { JwtPayload } from '../auth/jwt-payload.interface';
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
  foto_pessoa?: string;
  foto_documento?: string;
  tag_rfid?: string;
  qrcode_acesso?: string;
}

@Injectable()
export class MoradoresService {
  private static mockMoradores = [
    { id: 1, nome: 'João da Silva', documento: '11122233344', email: 'joao@example.com', telefone: '11999998888', data_nascimento: null, tipo: 'proprietario', bloco: 'A', apartamento: '101', id_apartamento: 0, id_condominio: 1, photo: null, foto_pessoa: null, foto_documento: null },
    { id: 2, nome: 'Maria Oliveira', documento: '55566677788', email: 'maria@example.com', telefone: '11988887777', data_nascimento: null, tipo: 'inquilino', bloco: 'B', apartamento: '202', id_apartamento: 0, id_condominio: 1, photo: null, foto_pessoa: null, foto_documento: null },
  ];

  private readonly logger = new Logger(MoradoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly storage: StorageService,
    private readonly facial: FacialService,
    private readonly auditoria: AuditoriaService,
  ) {}

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

  /**
   * Contexto rico para auditoria de morador: identificação, apartamento,
   * status de credenciais (RFID, QR, foto facial). Responde no painel:
   * "qual morador, em qual apto, com quais credenciais habilitadas".
   */
  private async carregarContextoMorador(idMorador: number) {
    const m = await this.prisma.moradores.findUnique({ where: { id: idMorador } });
    if (!m) return null;

    const aptoLabel = m.bloco
      ? `Bloco ${m.bloco}, Apto ${m.apartamento}`
      : (m.apartamento ? `Apto ${m.apartamento}` : null);

    return {
      morador: {
        id: m.id,
        nome: m.nome,
        documento: m.documento,
        email: m.email,
        telefone: m.telefone,
        tipo: m.tipo,
      },
      apartamento: aptoLabel
        ? { bloco: m.bloco, numero: m.apartamento, label: aptoLabel }
        : null,
      credenciais: {
        temTagRfid: !!(m as any).tag_rfid,
        temQrCode: !!(m as any).qrcode_acesso,
        temFacial: !!m.face_id,
        statusFacial: m.face_sync_status,
      },
    };
  }

  private fireFacialSync(idMorador: number) {
    this.facial
      .syncMorador(idMorador)
      .catch((err) => this.logger.warn(`Sync facial morador ${idMorador} falhou: ${err?.message ?? err}`));
  }

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

  private async resolveFoto(value: string | undefined | null): Promise<string | null> {
    // Qualquer vazio (null/undefined/"") vira null — "" no banco contaria como
    // "tem foto" (foto_pessoa != null) e quebraria o status e o "Remover foto".
    if (!value) return null;
    if (this.storage.isDataUrl(value)) {
      return (await this.storage.uploadDataUrl(value, 'moradores')) ?? null;
    }
    return value;
  }

  /**
   * Garante que tag RFID / QR não estão sendo usadas por outra pessoa
   * (morador OU visitante) no mesmo condomínio. Idealmente o schema teria
   * UNIQUE compound (id_condominio, tag_rfid) — enquanto não rodamos a
   * migration, validamos no application layer.
   *
   * Suporta excluir o próprio morador via `excluirMoradorId` (no update).
   */
  private async assertCredencialDisponivel(
    idCondominio: number,
    tag: string | undefined | null,
    qr: string | undefined | null,
    excluirMoradorId: number | null,
  ): Promise<void> {
    if (!this.prisma.isConnected) return;

    const checks: Array<Promise<void>> = [];

    if (tag) {
      checks.push(
        (async () => {
          const conflitoMorador = await this.prisma.moradores.findFirst({
            where: {
              id_condominio: idCondominio,
              tag_rfid: tag,
              ...(excluirMoradorId ? { NOT: { id: excluirMoradorId } } : {}),
            },
            select: { id: true, nome: true },
          });
          if (conflitoMorador) {
            throw new BadRequestException(
              `Tag RFID já cadastrada para o morador "${conflitoMorador.nome}"`,
            );
          }
          const conflitoVisitante = await this.prisma.visitantes.findFirst({
            where: { id_condominio: idCondominio, tag_rfid: tag },
            select: { id: true, nome: true },
          });
          if (conflitoVisitante) {
            throw new BadRequestException(
              `Tag RFID já em uso pelo visitante "${conflitoVisitante.nome}"`,
            );
          }
        })(),
      );
    }

    if (qr) {
      checks.push(
        (async () => {
          const conflitoMorador = await this.prisma.moradores.findFirst({
            where: {
              id_condominio: idCondominio,
              qrcode_acesso: qr,
              ...(excluirMoradorId ? { NOT: { id: excluirMoradorId } } : {}),
            },
            select: { id: true, nome: true },
          });
          if (conflitoMorador) {
            throw new BadRequestException(
              `QR Code já cadastrado para o morador "${conflitoMorador.nome}"`,
            );
          }
          const conflitoVisitante = await this.prisma.visitantes.findFirst({
            where: { id_condominio: idCondominio, codigo_acesso: qr },
            select: { id: true, nome: true },
          });
          if (conflitoVisitante) {
            throw new BadRequestException(
              `QR Code já em uso pelo visitante "${conflitoVisitante.nome}"`,
            );
          }
        })(),
      );
    }

    await Promise.all(checks);
  }

  /** Síndicos do condomínio, para o painel escolher quem vincular como morador. */
  async listSindicosCondominio(idCondominio: number) {
    if (!this.prisma.isConnected) return [];
    const rels = await this.prisma.sindicos_Condominios.findMany({
      where: { id_condominio: Number(idCondominio) },
      include: { user: { include: { sindicos: true } } },
    });
    return rels.map((r) => ({
      id_user: r.id_user,
      nome: r.user?.sindicos?.[0]?.name ?? r.user?.name ?? '',
      email: r.user?.email ?? null,
    }));
  }

  /**
   * Vincula um usuário JÁ EXISTENTE (ex.: um síndico) a um apartamento como morador,
   * sem criar conta nova: cria Apartamentos_Users + Moradores e marca is_morador=1.
   * Idempotente. Valida que o apartamento pertence ao condomínio do path (tenant).
   */
  async linkExistingUser(
    idCondominio: number,
    body: { id_user: number; id_apartamento: number; tipo?: string },
  ) {
    if (!this.prisma.isConnected) {
      throw new BadRequestException('Banco indisponível. Tente novamente em instantes.');
    }
    const idUser = Number(body.id_user);
    const idApto = Number(body.id_apartamento);
    if (!idUser || !idApto) throw new BadRequestException('Usuário e apartamento são obrigatórios.');

    const tipo = String(body.tipo || 'proprietario')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim() || 'proprietario';

    const apto = await this.prisma.apartamentos.findUnique({ where: { id: idApto } });
    if (!apto) throw new NotFoundException('Apartamento não encontrado.');
    if (apto.id_condominio !== Number(idCondominio)) {
      throw new BadRequestException('Este apartamento não pertence ao condomínio.');
    }

    const user = await this.prisma.users.findUnique({ where: { id: idUser } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const already = await this.prisma.apartamentos_Users.findFirst({
      where: { id_user: idUser, id_apto: idApto },
    });
    if (already) throw new BadRequestException(`${user.name ?? 'Este usuário'} já está vinculado a este apartamento.`);

    const venc = new Date();
    venc.setDate(venc.getDate() + 45);

    await this.prisma.$transaction(async (tx) => {
      await tx.apartamentos_Users.create({
        data: { id_apto: apto.id, id_user: idUser, tipo, vencimento: venc },
      });
      await tx.moradores.create({
        data: {
          nome: user.name ?? 'Síndico',
          documento: user.cpf ?? null,
          email: user.email ?? null,
          telefone: user.phone ?? null,
          tipo,
          id_user: idUser,
          id_condominio: apto.id_condominio,
          bloco: apto.bloco || null,
          apartamento: apto.apto || null,
        },
      });
      await tx.users.update({ where: { id: idUser }, data: { is_morador: 1 } });
    });

    return { success: true, id_condominio: apto.id_condominio, apto_id: apto.id, apto_tipo: tipo };
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

    // Quando filtra por apartamento, a fonte canônica é Apartamentos_Users (o vínculo real
    // morador↔apto), com LEFT JOIN em Moradores para o perfil. Assim a lista inclui vínculos
    // "órfãos" (sem ficha em Moradores) e bate exatamente com a contagem do card/app.
    if (idApto) {
      const rels = await this.prisma.apartamentos_Users.findMany({
        where: { id_apto: Number(idApto) },
        include: {
          apartamento: true,
          user: { include: { moradores: true } },
        },
      });
      const seen = new Set<number>();
      const out: any[] = [];
      for (const r of rels) {
        if (seen.has(r.id_user)) continue;
        seen.add(r.id_user);
        const condId = r.apartamento?.id_condominio ?? idCondominio;
        const m = r.user?.moradores?.find((mor) => mor.id_condominio === condId) ?? r.user?.moradores?.[0];
        const fotoFinal = m?.foto_pessoa ?? r.user?.photo ?? null;
        out.push({
          id: m?.id ?? r.id_user,
          nome: m?.nome ?? r.user?.name ?? '',
          documento: m?.documento ?? r.user?.cpf ?? null,
          email: m?.email ?? r.user?.email ?? null,
          telefone: m?.telefone ?? r.user?.phone ?? null,
          data_nascimento: m?.data_nascimento ?? null,
          tipo: r.tipo ?? m?.tipo ?? null,
          bloco: m?.bloco ?? r.apartamento?.bloco ?? null,
          apartamento: m?.apartamento ?? r.apartamento?.apto ?? null,
          id_apartamento: Number(idApto),
          id_condominio: condId,
          photo: fotoFinal,
          foto_pessoa: fotoFinal,
          foto_documento: m?.foto_documento ?? null,
          face_id: m?.face_id ?? null,
          face_sync_status: m?.face_sync_status ?? null,
        });
      }
      // Busca textual local (mesmo comportamento da query condo-wide).
      if (!search) return out;
      const q = search.toLowerCase();
      return out.filter(
        (o) =>
          (o.nome ?? '').toLowerCase().includes(q) ||
          (o.documento ?? '').toLowerCase().includes(q),
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
      const fotoFinal = m.foto_pessoa ?? m.user?.photo ?? null;
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
        photo: fotoFinal,
        foto_pessoa: fotoFinal,
        foto_documento: m.foto_documento ?? null,
        face_id: m.face_id ?? null,
        face_sync_status: m.face_sync_status ?? null,
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
    });
    if (!m) throw new NotFoundException(`Morador ${id} não encontrado`);
    const fotoFinal = m.foto_pessoa ?? m.user?.photo ?? null;
    const idAptoMapped = m.user?.apartamentosUsers?.[0]?.id_apto ?? 0;
    return {
      ...m,
      id_apartamento: idAptoMapped,
      photo: fotoFinal,
      foto_pessoa: fotoFinal,
      foto_documento: m.foto_documento ?? null,
    };
  }

  /**
   * Retorna toda a atividade do morador para o painel de detalhes:
   * - Visitas que esse morador convidou (Visitantes WHERE user=id_user)
   * - Encomendas para o apto do morador (match por string apto+bloco)
   * - Ocorrências criadas pelo morador
   * - Histórico de acessos faciais do morador
   *
   * As 4 queries rodam em paralelo (Promise.all) para baixa latência.
   */
  async atividade(idMorador: number) {
    if (!this.prisma.isConnected) {
      return {
        visitas: [],
        encomendas: [],
        ocorrencias: [],
        acessos: [],
        stats: {
          visitasNoLocal: 0,
          visitasAgendadas: 0,
          visitasHistorico: 0,
          encomendasAguardando: 0,
          encomendasEntregues: 0,
          ocorrenciasPendentes: 0,
          ocorrenciasResolvidas: 0,
          totalAcessos: 0,
        },
      };
    }

    const morador = await this.prisma.moradores.findUnique({
      where: { id: idMorador },
      select: {
        id: true,
        id_user: true,
        id_condominio: true,
        apartamento: true,
        bloco: true,
      },
    });
    if (!morador) {
      throw new NotFoundException(`Morador ${idMorador} não encontrado`);
    }

    // Normaliza apartamento/bloco do morador uma vez (strings podem ter
    // espaços ou variações que quebrariam o match).
    const aptoNorm = (morador.apartamento ?? '').trim();
    const blocoNorm = (morador.bloco ?? '').trim();

    const [visitas, encomendas, ocorrencias, acessos] = await Promise.all([
      // Visitas que esse morador convidou (campo `user` em Visitantes = autor)
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: morador.id_condominio ?? -1,
          user: morador.id_user,
        },
        select: {
          id: true,
          nome: true,
          doc_identificacao: true,
          foto_pessoa: true,
          is_visitante: true,
          is_prestador: true,
          data_hora_inicio: true,
          data_hora_termino: true,
          data_entrada: true,
          data_saida: true,
          codigo_acesso: true,
          created_at: true,
          apartamento: { select: { bloco: true, apto: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),

      // Encomendas para o apto do morador. Encomendas NÃO tem FK para
      // Morador — match feito por string (apto + bloco). O índice
      // (id_condominio, status) acelera o filtro.
      aptoNorm
        ? this.prisma.encomendas.findMany({
            where: {
              id_condominio: morador.id_condominio ?? -1,
              destinatario_apto: aptoNorm,
              ...(blocoNorm ? { destinatario_bloco: blocoNorm } : {}),
            },
            select: {
              id: true,
              descricao: true,
              destinatario_apto: true,
              destinatario_bloco: true,
              recebido_de: true,
              recebido_em: true,
              retirado_em: true,
              retirado_por: true,
              status: true,
              foto_volume: true,
              recebidoPor: { select: { name: true } },
              entreguePor: { select: { name: true } },
            },
            orderBy: { recebido_em: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),

      // Ocorrências criadas pelo morador (`user` em Ocorrencias = autor)
      this.prisma.ocorrencias.findMany({
        where: {
          id_condominio: morador.id_condominio ?? -1,
          user: morador.id_user,
        },
        select: {
          id: true,
          descricao: true,
          status: true,
          resposta: true,
          resposta_at: true,
          created_at: true,
          categoria: { select: { nome: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 50,
      }),

      // Histórico de acessos faciais do morador
      this.prisma.acessos_Facial.findMany({
        where: {
          id_condominio: morador.id_condominio ?? -1,
          tipo_pessoa: 'morador',
          id_pessoa: morador.id,
        },
        select: {
          id: true,
          id_device: true,
          tipo_dispositivo: true,
          evento: true,
          confianca: true,
          timestamp: true,
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
      }),
    ]);

    // Resolve nomes dos dispositivos referenciados nos acessos (1 query)
    const idsDevice = Array.from(new Set(acessos.map((a) => a.id_device)));
    const devices = idsDevice.length > 0
      ? await this.prisma.facial_Devices.findMany({
          where: { id: { in: idsDevice } },
          select: { id: true, nome: true, tipo: true },
        })
      : [];
    const deviceById = new Map(devices.map((d) => [d.id, d]));

    // Stats agregados pra alimentar os badges das abas e KPIs
    const agora = new Date();
    const visitasNoLocal = visitas.filter((v) => !!v.data_entrada && !v.data_saida).length;
    const visitasAgendadas = visitas.filter(
      (v) =>
        !v.data_entrada &&
        !v.data_saida &&
        v.data_hora_inicio &&
        (!v.data_hora_termino || new Date(v.data_hora_termino) >= agora),
    ).length;
    const visitasHistorico = visitas.length - visitasNoLocal - visitasAgendadas;
    const encomendasAguardando = encomendas.filter(
      (e) => (e.status ?? '').toLowerCase() !== 'entregue',
    ).length;
    const encomendasEntregues = encomendas.length - encomendasAguardando;
    const ocorrenciasPendentes = ocorrencias.filter(
      (o) => (o.status ?? '').toLowerCase() !== 'resolvido',
    ).length;
    const ocorrenciasResolvidas = ocorrencias.length - ocorrenciasPendentes;

    return {
      visitas: visitas.map((v) => ({
        ...v,
        apto: v.apartamento?.apto ?? null,
        apto_bloco: v.apartamento?.bloco ?? null,
        apartamento: undefined,
      })),
      encomendas,
      ocorrencias,
      acessos: acessos.map((a) => {
        const d = deviceById.get(a.id_device);
        return {
          ...a,
          terminalNome: d?.nome ?? `Dispositivo #${a.id_device}`,
          terminalTipo: d?.tipo ?? a.tipo_dispositivo ?? 'desconhecido',
        };
      }),
      stats: {
        visitasNoLocal,
        visitasAgendadas,
        visitasHistorico: Math.max(0, visitasHistorico),
        encomendasAguardando,
        encomendasEntregues,
        ocorrenciasPendentes,
        ocorrenciasResolvidas,
        totalAcessos: acessos.length,
      },
    };
  }

  /**
   * Criação simplificada: assumimos que o porteiro está só registrando dados
   * básicos. Cria um Users mínimo se ainda não existir e vincula via id_user.
   */
  async create(dto: CreateMoradorDto, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      const newM = {
        id: MoradoresService.mockMoradores.length + 1,
        nome: dto.nome,
        documento: dto.documento || null,
        email: dto.email || null,
        data_nascimento: dto.data_nascimento ? this.parseDate(dto.data_nascimento) : null,
        tipo: dto.tipo || 'proprietario',
        bloco: 'A',
        apartamento: '101',
        id_apartamento: 0,
        id_condominio: dto.id_condominio,
        photo: null,
        foto_pessoa: dto.foto_pessoa || null,
        foto_documento: dto.foto_documento || null,
      };
      MoradoresService.mockMoradores.push(newM as any);
      if (dto.sendCredentials && dto.email) {
        this.fireWelcomeEmail(dto.email, dto.nome, dto.documento || '123456');
      }
      return newM;
    }

    // Validar duplicidade
    const emailNorm = dto.email ? dto.email.toLowerCase().trim() : null;
    const docNorm = dto.documento ? dto.documento.trim() : null;
    const nomeNorm = dto.nome ? dto.nome.trim() : null;

    let aptoObj = null;
    if (dto.id_apartamento) {
      aptoObj = await this.prisma.apartamentos.findUnique({
        where: { id: Number(dto.id_apartamento) },
      });
    }

    const duplicationCheck = await this.prisma.moradores.findFirst({
      where: {
        id_condominio: dto.id_condominio,
        OR: [
          ...(emailNorm ? [{ email: emailNorm }] : []),
          ...(docNorm ? [{ documento: docNorm }] : []),
          ...(nomeNorm && aptoObj ? [{ 
            nome: nomeNorm,
            bloco: aptoObj.bloco || null,
            apartamento: aptoObj.apto || null
          }] : [])
        ]
      }
    });

    if (duplicationCheck) {
      throw new BadRequestException('Este morador já está cadastrado neste condomínio (e-mail, documento ou nome/apartamento duplicado).');
    }

    // Garante que tag/QR não estão em uso por outro morador OU visitante no
    // mesmo condomínio. Duas pessoas com a mesma credencial é o pior bug
    // possível em controle de acesso — "quem é quem?".
    await this.assertCredencialDisponivel(dto.id_condominio, dto.tag_rfid, dto.qrcode_acesso, null);

    const fotoPessoaUrl = await this.resolveFoto(dto.foto_pessoa);
    const fotoDocumentoUrl = await this.resolveFoto(dto.foto_documento);

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
        // Atualiza login e password caso estejam vazios para permitir acesso, e as fotos
        const userUpdates: any = {};
        if (!existing.login || !existing.password) {
          userUpdates.login = dto.email;
          userUpdates.password = md5Password;
          passwordWasSet = true;
        }
        if (fotoPessoaUrl) {
          userUpdates.photo = fotoPessoaUrl;
          userUpdates.profile_image = fotoPessoaUrl;
        }
        if (Object.keys(userUpdates).length > 0) {
          await this.prisma.users.update({
            where: { id: existing.id },
            data: userUpdates,
          });
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
            photo: fotoPessoaUrl,
            profile_image: fotoPessoaUrl,
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
          photo: fotoPessoaUrl,
          profile_image: fotoPessoaUrl,
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

    let createdMorador;
    try {
      createdMorador = await this.prisma.moradores.create({
        data: {
          nome: dto.nome,
          documento: dto.documento ?? null,
          email: dto.email ?? null,
          data_nascimento: dto.data_nascimento ? this.parseDate(dto.data_nascimento) : null,
          tipo: dto.tipo ?? 'proprietario',
          id_user: userId,
          id_condominio: dto.id_condominio,
          bloco: bloco || null,
          apartamento: aptoNum || null,
          foto_pessoa: fotoPessoaUrl,
          foto_documento: fotoDocumentoUrl,
          tag_rfid: dto.tag_rfid ? dto.tag_rfid.trim() : null,
          qrcode_acesso: dto.qrcode_acesso ? dto.qrcode_acesso.trim() : null,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `[moradores.create] Falha ao criar morador: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel cadastrar o morador. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    if (dto.sendCredentials && dto.email) {
      this.fireWelcomeEmail(dto.email, dto.nome, passwordWasSet ? (dto.documento || '123456') : undefined);
    }

    if (fotoPessoaUrl) {
      this.fireFacialSync(createdMorador.id);
    }

    const ctx = await this.carregarContextoMorador(createdMorador.id);
    await this.auditoria.registrar({
      id_condominio: createdMorador.id_condominio ?? dto.id_condominio,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'CREATE',
      modulo: 'moradores',
      entidade_id: createdMorador.id,
      descricao: `Cadastrou morador "${createdMorador.nome}"${ctx?.apartamento ? ' no ' + ctx.apartamento.label : ''}`,
      detalhes: ctx ?? undefined,
    });

    return this.findOne(createdMorador.id);
  }

  async update(id: number, dto: Partial<CreateMoradorDto>, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      const idx = MoradoresService.mockMoradores.findIndex(x => x.id === id);
      if (idx !== -1) {
        MoradoresService.mockMoradores[idx] = { ...MoradoresService.mockMoradores[idx], ...dto } as any;
        return MoradoresService.mockMoradores[idx];
      }
      throw new NotFoundException(`Morador ${id} não encontrado`);
    }

    const fotoPessoaUrl = dto.foto_pessoa !== undefined ? await this.resolveFoto(dto.foto_pessoa) : undefined;
    const fotoDocumentoUrl = dto.foto_documento !== undefined ? await this.resolveFoto(dto.foto_documento) : undefined;

    // Carrega o morador atual com seu Users vinculado
    const atual = await this.prisma.moradores.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!atual) throw new NotFoundException(`Morador ${id} não encontrado`);

    // Valida duplicação de credenciais. Só dispara se o campo veio no dto e
    // mudou — não bloqueia edições que mantêm a credencial atual.
    const novaTag = dto.tag_rfid !== undefined ? dto.tag_rfid?.trim() : undefined;
    const novoQr = dto.qrcode_acesso !== undefined ? dto.qrcode_acesso?.trim() : undefined;
    await this.assertCredencialDisponivel(
      atual.id_condominio ?? -1,
      novaTag !== (atual as any).tag_rfid ? novaTag : undefined,
      novoQr !== (atual as any).qrcode_acesso ? novoQr : undefined,
      id,
    );

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

    let result;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        let bloco: string | undefined = undefined;
        let aptoNum: string | undefined = undefined;

        if (dto.id_apartamento !== undefined) {
          if (atual.id_user) {
            await tx.apartamentos_Users.deleteMany({
              where: { id_user: atual.id_user },
            });
          }

          if (dto.id_apartamento > 0) {
            const aptoObj = await tx.apartamentos.findUnique({
              where: { id: Number(dto.id_apartamento) },
            });
            if (aptoObj) {
              bloco = aptoObj.bloco || '';
              aptoNum = aptoObj.apto || '';

              if (atual.id_user) {
                const dataVenc = new Date();
                dataVenc.setDate(dataVenc.getDate() + 45);
                await tx.apartamentos_Users.create({
                  data: {
                    id_apto: aptoObj.id,
                    id_user: atual.id_user,
                    tipo: dto.tipo || atual.tipo || 'proprietario',
                    vencimento: dataVenc,
                  },
                });
              }
            }
          } else {
            bloco = '';
            aptoNum = '';
          }
        }

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
              data_nascimento: dto.data_nascimento ? this.parseDate(dto.data_nascimento) : null,
            }),
            ...(fotoPessoaUrl !== undefined && { foto_pessoa: fotoPessoaUrl }),
            ...(fotoDocumentoUrl !== undefined && { foto_documento: fotoDocumentoUrl }),
            ...(novaTag !== undefined && { tag_rfid: novaTag || null }),
            ...(novoQr !== undefined && { qrcode_acesso: novoQr || null }),
            ...(bloco !== undefined && { bloco: bloco || null }),
            ...(aptoNum !== undefined && { apartamento: aptoNum || null }),
          },
        });

        // Propaga para Users (login/email/phone/name/cpf/photo) para manter o acesso ao app e sincronizar a foto
        const userPatch: any = {};
        if (dto.nome !== undefined) userPatch.name = dto.nome;
        if (dto.telefone !== undefined) userPatch.phone = dto.telefone;
        if (dto.documento !== undefined) userPatch.cpf = dto.documento || null;
        if (emailMudou) {
          userPatch.email = dto.email || null;
          userPatch.login = dto.email || null;
        }
        if (fotoPessoaUrl !== undefined) {
          userPatch.photo = fotoPessoaUrl;
          userPatch.profile_image = fotoPessoaUrl;
        }
        if (Object.keys(userPatch).length > 0 && atual.id_user) {
          await tx.users.update({
            where: { id: atual.id_user },
            data: userPatch,
          });
        }

        return morador;
      });
    } catch (err: any) {
      this.logger.error(
        `[moradores.update] Falha ao atualizar morador ${id}: ${err?.message ?? err}`,
        err?.stack,
      );
      throw new BadRequestException(
        `Nao foi possivel atualizar o morador. Verifique os dados e tente novamente. (${err?.code ?? err?.name ?? 'erro'})`,
      );
    }

    // Roda quando o campo foto foi tocado — INCLUSIVE remoção (foto null).
    // syncMorador cadastra (foto nova) ou remove o rosto do aparelho (sem foto).
    if (fotoPessoaUrl !== undefined) {
      this.fireFacialSync(id);
    }

    // Diff dos campos sensíveis para o log.
    const camposAuditar = ['nome', 'documento', 'email', 'telefone', 'tipo', 'tag_rfid', 'qrcode_acesso'] as const;
    const changes: Record<string, { de: any; para: any }> = {};
    for (const k of camposAuditar) {
      if (dto[k] !== undefined && (atual as any)[k] !== (result as any)[k]) {
        changes[k] = { de: (atual as any)[k] ?? null, para: (result as any)[k] ?? null };
      }
    }
    if (fotoPessoaUrl !== undefined && fotoPessoaUrl !== atual.foto_pessoa) {
      changes['foto_pessoa'] = { de: '(anterior)', para: '(nova)' };
    }
    const ctx = await this.carregarContextoMorador(result.id);
    await this.auditoria.registrar({
      id_condominio: atual.id_condominio ?? -1,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'UPDATE',
      modulo: 'moradores',
      entidade_id: result.id,
      descricao: `Atualizou morador "${result.nome}"${ctx?.apartamento ? ' (' + ctx.apartamento.label + ')' : ''}`,
      detalhes: { contexto: ctx, changes },
    });

    return this.findOne(result.id);
  }

  async remove(id: number, operador?: JwtPayload) {
    if (!this.prisma.isConnected) {
      MoradoresService.mockMoradores = MoradoresService.mockMoradores.filter(x => x.id !== id);
      return;
    }
    // Carrega contexto ANTES de remover.
    const ctx = await this.carregarContextoMorador(id);
    const morador = await this.prisma.moradores.findUnique({
      where: { id },
      select: { face_id: true, id_condominio: true, nome: true, id_user: true },
    });
    try {
      await this.prisma.$transaction(async (tx) => {
        if (morador?.id_user && morador?.id_condominio) {
          const aptos = await tx.apartamentos.findMany({
            where: { id_condominio: morador.id_condominio },
            select: { id: true },
          });
          const aptoIds = aptos.map((a) => a.id);
          if (aptoIds.length > 0) {
            await tx.apartamentos_Users.deleteMany({
              where: {
                id_user: morador.id_user,
                id_apto: { in: aptoIds },
              },
            });
          }
        }
        await tx.moradores.delete({ where: { id } });
      });
    } catch {
      throw new NotFoundException(`Morador ${id} não encontrado`);
    }
    if (morador) {
      await this.auditoria.registrar({
        id_condominio: morador.id_condominio ?? -1,
        usuario_nome: operador?.nome ?? 'Portaria',
        acao: 'DELETE',
        modulo: 'moradores',
        entidade_id: id,
        descricao: `Removeu morador "${morador.nome}"${ctx?.apartamento ? ' do ' + ctx.apartamento.label : ''}`,
        detalhes: ctx ?? undefined,
      });
    }
    if (morador?.face_id) {
      this.facial
        .unsyncMorador(id, morador.face_id, morador.id_condominio)
        .catch((err) => this.logger.warn(`Unsync facial morador ${id} falhou: ${err?.message ?? err}`));
    }
  }

  async sendCredentials(id: number, operador?: JwtPayload) {
    const m = (await this.findOne(id)) as any;
    if (!m.email) {
      throw new NotFoundException('Morador não possui e-mail cadastrado');
    }
    const senhaInicial = m.documento || '123456';
    if (this.prisma.isConnected && m.id_user) {
      const md5Password = crypto.createHash('md5').update(senhaInicial).digest('hex');
      await this.prisma.users.update({
        where: { id: m.id_user },
        data: {
          login: m.email,
          password: md5Password,
        },
      });
    }
    this.fireWelcomeEmail(m.email, m.nome, senhaInicial);

    const ctx = await this.carregarContextoMorador(id);
    await this.auditoria.registrar({
      id_condominio: m.id_condominio ?? -1,
      usuario_nome: operador?.nome ?? 'Portaria',
      acao: 'STATUS',
      modulo: 'moradores',
      entidade_id: id,
      descricao: `Reenviou credenciais para "${m.nome}" (${m.email})`,
      detalhes: ctx ?? undefined,
    });

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
        let idApto = 0;
        const blocoStr = item.quadra?.toString().trim() || item.bloco?.toString().trim() || '';
        const aptoStr = item.lote?.toString().trim() || item.apartamento?.toString().trim() || '';

        if (blocoStr || aptoStr) {
          // Tenta encontrar o apartamento no condominio
          const dbApto = await this.prisma.apartamentos.findFirst({
            where: {
              id_condominio: idCondominio,
              bloco: blocoStr || null,
              apto: aptoStr || null,
            },
          });

          if (dbApto) {
            idApto = dbApto.id;
          } else {
            // Se nao encontrar, cria-o automaticamente
            const novoApto = await this.prisma.apartamentos.create({
              data: {
                id_condominio: idCondominio,
                bloco: blocoStr || null,
                apto: aptoStr || null,
              },
            });
            idApto = novoApto.id;
          }
        }

        const m = await this.create({
          nome: item.nome,
          documento: item.documento?.toString() || undefined,
          email: item.email?.toString() || undefined,
          telefone: item.telefone?.toString() || undefined,
          tipo: item.tipo?.toString() || 'proprietario',
          id_apartamento: idApto,
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