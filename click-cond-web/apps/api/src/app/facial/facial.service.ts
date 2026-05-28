import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  FacialDeviceClientService,
  FacialDeviceConfig,
} from './facial-device-client.service';

export interface CreateDeviceDto {
  id_condominio: number;
  nome: string;
  fabricante: string;
  modelo?: string;
  ip: string;
  porta?: number;
  api_user?: string;
  api_password?: string;
}

export interface UpdateDeviceDto extends Partial<CreateDeviceDto> {}

export interface WebhookEventDto {
  device_id?: string;
  event?: string;
  person_id?: string;
  external_id?: string;
  timestamp?: string;
  confidence?: number;
  direction?: string;
}

const FACIAL_ENABLED = process.env.FACIAL_INTEGRATION_ENABLED === 'true';

@Injectable()
export class FacialService {
  private readonly logger = new Logger(FacialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: FacialDeviceClientService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- Devices CRUD ----------

  async listDevices(idCondominio: number) {
    if (!this.prisma.isConnected) return [];
    return this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { created_at: 'desc' },
    });
  }

  async getDevice(id: number) {
    const d = await this.prisma.facial_Devices.findUnique({ where: { id } });
    if (!d) throw new NotFoundException(`Terminal facial ${id} não encontrado`);
    return d;
  }

  async findDeviceByToken(token: string) {
    const d = await this.prisma.facial_Devices.findFirst({
      where: { webhook_token: token, ativo: 1 },
    });
    if (!d) throw new UnauthorizedException('Token de webhook inválido');
    return d;
  }

  async createDevice(dto: CreateDeviceDto) {
    const token = crypto.randomBytes(32).toString('hex');
    return this.prisma.facial_Devices.create({
      data: {
        id_condominio: dto.id_condominio,
        nome: dto.nome,
        fabricante: dto.fabricante,
        modelo: dto.modelo ?? null,
        ip: dto.ip,
        porta: dto.porta ?? 80,
        api_user: dto.api_user ?? null,
        api_password: dto.api_password ?? null,
        webhook_token: token,
      },
    });
  }

  async updateDevice(id: number, dto: UpdateDeviceDto) {
    await this.getDevice(id);
    return this.prisma.facial_Devices.update({
      where: { id },
      data: {
        ...(dto.nome !== undefined && { nome: dto.nome }),
        ...(dto.fabricante !== undefined && { fabricante: dto.fabricante }),
        ...(dto.modelo !== undefined && { modelo: dto.modelo }),
        ...(dto.ip !== undefined && { ip: dto.ip }),
        ...(dto.porta !== undefined && { porta: dto.porta }),
        ...(dto.api_user !== undefined && { api_user: dto.api_user }),
        ...(dto.api_password !== undefined && { api_password: dto.api_password }),
      },
    });
  }

  async removeDevice(id: number) {
    await this.getDevice(id);
    await this.prisma.facial_Devices.delete({ where: { id } });
    return { ok: true };
  }

  async testDevice(id: number) {
    const device = await this.getDevice(id);
    const online = await this.client.ping(this.toConfig(device));
    return { online };
  }

  /**
   * Lista pessoas com foto cadastrada no condomínio do terminal.
   * Usado pelo simulador (browser) para fazer matching local de rostos.
   * Fotos armazenadas como URL no R2 são baixadas e convertidas para
   * data URL (base64) para evitar problemas de CORS no canvas do face-api.
   */
  async listPersonsForDevice(idDevice: number) {
    const device = await this.getDevice(idDevice);
    const idCondominio = device.id_condominio;

    const [moradores, visitantes] = await Promise.all([
      this.prisma.moradores.findMany({
        where: { id_condominio: idCondominio, foto_pessoa: { not: null } },
        select: { id: true, nome: true, foto_pessoa: true },
      }),
      this.prisma.visitantes.findMany({
        where: {
          id_condominio: idCondominio,
          foto_pessoa: { not: null },
          data_saida: null,
        },
        select: { id: true, nome: true, foto_pessoa: true },
      }),
    ]);

    const rawPersons = [
      ...moradores.map((m) => ({
        external_id: `morador_${m.id}`,
        tipo: 'morador',
        nome: m.nome,
        foto: m.foto_pessoa,
      })),
      ...visitantes.map((v) => ({
        external_id: `visitante_${v.id}`,
        tipo: 'visitante',
        nome: v.nome,
        foto: v.foto_pessoa,
      })),
    ];

    const persons = await Promise.all(
      rawPersons.map(async (p) => ({
        ...p,
        foto: await this.toDataUrl(p.foto),
      })),
    );

    return {
      device: {
        id: device.id,
        nome: device.nome,
        webhook_token: device.webhook_token,
      },
      persons,
      total: persons.length,
    };
  }

  /**
   * Converte foto (URL HTTP do R2, base64 puro ou data: URL) em data URL
   * com prefix correto. Necessário para o face-api processar a imagem em
   * canvas sem CORS taint.
   */
  private async toDataUrl(foto: string | null): Promise<string | null> {
    if (!foto) return null;
    if (foto.startsWith('data:')) return foto;
    if (foto.startsWith('http://') || foto.startsWith('https://')) {
      try {
        const axios = (await import('axios')).default;
        const res = await axios.get(foto, {
          responseType: 'arraybuffer',
          timeout: 15000,
        });
        const mime = res.headers['content-type'] || 'image/jpeg';
        const b64 = Buffer.from(res.data).toString('base64');
        return `data:${mime};base64,${b64}`;
      } catch (err: any) {
        this.logger.warn(`Falha ao baixar foto ${foto}: ${err?.message ?? err}`);
        return null;
      }
    }
    // Já é base64 puro
    return `data:image/jpeg;base64,${foto}`;
  }

  // ---------- Sync ----------

  async syncMorador(idMorador: number) {
    if (!FACIAL_ENABLED) return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const morador = await this.prisma.moradores.findUnique({ where: { id: idMorador } });
    if (!morador) throw new NotFoundException(`Morador ${idMorador} não encontrado`);
    if (!morador.foto_pessoa) {
      return { skipped: true, reason: 'no_photo' };
    }
    if (!morador.id_condominio) {
      return { skipped: true, reason: 'no_condominio' };
    }

    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: morador.id_condominio, ativo: 1 },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_devices' };
    }

    const externalId = `morador_${morador.id}`;
    const fotoBase64 = await this.fetchPhotoAsBase64(morador.foto_pessoa);
    if (!fotoBase64) {
      await this.markMoradorSyncStatus(idMorador, 'error');
      return { ok: false, reason: 'photo_unreachable' };
    }

    let faceId: string | null = morador.face_id ?? null;
    let allOk = true;
    for (const device of devices) {
      try {
        if (faceId) {
          await this.client.updatePerson(this.toConfig(device), faceId, {
            nome: morador.nome,
            fotoBase64,
          });
        } else {
          const r = await this.client.enrollPerson(this.toConfig(device), {
            externalId,
            nome: morador.nome,
            fotoBase64,
          });
          faceId = r.faceId;
        }
      } catch (err: any) {
        allOk = false;
        this.logger.warn(`Sync morador ${idMorador} device ${device.id} falhou: ${err?.message ?? err}`);
      }
    }

    await this.prisma.moradores.update({
      where: { id: idMorador },
      data: {
        face_id: faceId,
        face_sync_status: allOk ? 'synced' : 'pending',
        face_enrolled_at: allOk ? new Date() : morador.face_enrolled_at,
      },
    });

    return { ok: allOk, face_id: faceId };
  }

  async syncVisitante(idVisitante: number) {
    if (!FACIAL_ENABLED) return { skipped: true, reason: 'integration_disabled' };
    if (!this.prisma.isConnected) return { skipped: true, reason: 'no_db' };

    const visitante = await this.prisma.visitantes.findUnique({ where: { id: idVisitante } });
    if (!visitante) throw new NotFoundException(`Visitante ${idVisitante} não encontrado`);
    if (!visitante.foto_pessoa) {
      return { skipped: true, reason: 'no_photo' };
    }

    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: visitante.id_condominio, ativo: 1 },
    });
    if (devices.length === 0) {
      return { skipped: true, reason: 'no_devices' };
    }

    const externalId = `visitante_${visitante.id}`;
    const fotoBase64 = await this.fetchPhotoAsBase64(visitante.foto_pessoa);
    if (!fotoBase64) {
      await this.markVisitanteSyncStatus(idVisitante, 'error');
      return { ok: false, reason: 'photo_unreachable' };
    }

    let faceId: string | null = visitante.face_id ?? null;
    let allOk = true;
    for (const device of devices) {
      try {
        if (faceId) {
          await this.client.updatePerson(this.toConfig(device), faceId, {
            nome: visitante.nome,
            fotoBase64,
          });
        } else {
          const r = await this.client.enrollPerson(this.toConfig(device), {
            externalId,
            nome: visitante.nome,
            fotoBase64,
          });
          faceId = r.faceId;
        }
      } catch (err: any) {
        allOk = false;
        this.logger.warn(`Sync visitante ${idVisitante} device ${device.id} falhou: ${err?.message ?? err}`);
      }
    }

    await this.prisma.visitantes.update({
      where: { id: idVisitante },
      data: {
        face_id: faceId,
        face_sync_status: allOk ? 'synced' : 'pending',
        face_enrolled_at: allOk ? new Date() : visitante.face_enrolled_at,
      },
    });

    return { ok: allOk, face_id: faceId };
  }

  async unsyncMorador(idMorador: number, faceId: string | null, idCondominio: number | null) {
    if (!FACIAL_ENABLED || !faceId || !idCondominio) return;
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1 },
    });
    for (const device of devices) {
      try {
        await this.client.removePerson(this.toConfig(device), faceId);
      } catch (err: any) {
        this.logger.warn(`Remoção morador ${idMorador} device ${device.id}: ${err?.message ?? err}`);
      }
    }
  }

  async unsyncVisitante(idVisitante: number, faceId: string | null, idCondominio: number) {
    if (!FACIAL_ENABLED || !faceId) return;
    const devices = await this.prisma.facial_Devices.findMany({
      where: { id_condominio: idCondominio, ativo: 1 },
    });
    for (const device of devices) {
      try {
        await this.client.removePerson(this.toConfig(device), faceId);
      } catch (err: any) {
        this.logger.warn(`Remoção visitante ${idVisitante} device ${device.id}: ${err?.message ?? err}`);
      }
    }
  }

  // ---------- Webhook ----------

  async processWebhook(token: string, payload: WebhookEventDto) {
    const device = await this.prisma.facial_Devices.findFirst({
      where: { webhook_token: token, ativo: 1 },
    });
    if (!device) throw new UnauthorizedException('Token de webhook inválido');

    const externalId = payload.external_id ?? payload.person_id ?? '';
    if (!externalId) {
      throw new BadRequestException('Payload sem external_id ou person_id');
    }

    const parsed = this.parseExternalId(externalId);
    const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const evento = this.normalizeEvento(payload.event, payload.direction);

    if (parsed.tipo === 'morador') {
      const m = await this.prisma.moradores.findUnique({ where: { id: parsed.id } });
      if (!m) throw new NotFoundException(`Morador ${parsed.id} não encontrado`);

      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          face_id: m.face_id ?? externalId,
          tipo_pessoa: 'morador',
          id_pessoa: m.id,
          nome_pessoa: m.nome,
          evento,
          confianca: payload.confidence ?? null,
          timestamp,
        },
      });

      return { ok: true, tipo: 'morador', id: m.id, evento };
    }

    if (parsed.tipo === 'visitante') {
      const v = await this.prisma.visitantes.findUnique({ where: { id: parsed.id } });
      if (!v) throw new NotFoundException(`Visitante ${parsed.id} não encontrado`);

      const isEntrada = evento === 'entrada';
      if (isEntrada) {
        await this.prisma.visitantes.update({
          where: { id: v.id },
          data: { data_entrada: timestamp, data_saida: null },
        });
      } else if (evento === 'saida') {
        await this.prisma.visitantes.update({
          where: { id: v.id },
          data: { data_saida: timestamp, codigo_acesso: null },
        });
      }

      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          face_id: v.face_id ?? externalId,
          tipo_pessoa: 'visitante',
          id_pessoa: v.id,
          nome_pessoa: v.nome,
          evento,
          confianca: payload.confidence ?? null,
          timestamp,
        },
      });

      // Notifica moradores do apartamento (entrada ou saída)
      if (evento === 'entrada' || evento === 'saida') {
        try {
          const moradores = await this.prisma.users.findMany({
            where: {
              apartamentosUsers: { some: { id_apto: v.id_apartamento } },
              fcm_token: { not: null },
              notif_visitantes: 1,
            },
            select: { fcm_token: true },
          });
          const titulo = evento === 'entrada' ? 'Visitante entrou' : 'Visitante saiu';
          const corpo = evento === 'entrada'
            ? `${v.nome} acabou de entrar no condomínio.`
            : `${v.nome} acabou de sair do condomínio.`;
          for (const u of moradores) {
            if (u.fcm_token) {
              await this.notifications.sendPushNotification(
                u.fcm_token,
                titulo,
                corpo,
                { id: v.id.toString(), type: 'visitante_acesso' },
              );
            }
          }
        } catch (err) {
          this.logger.warn(`Push de acesso falhou: ${err}`);
        }
      }

      return { ok: true, tipo: 'visitante', id: v.id, evento };
    }

    throw new BadRequestException(`external_id desconhecido: ${externalId}`);
  }

  async listAcessos(idCondominio: number, limit = 50) {
    return this.prisma.acessos_Facial.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async listAcessosPessoa(tipo: 'morador' | 'visitante', idPessoa: number, limit = 30) {
    return this.prisma.acessos_Facial.findMany({
      where: { tipo_pessoa: tipo, id_pessoa: idPessoa },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 100),
    });
  }

  // ---------- Helpers ----------

  private toConfig(device: any): FacialDeviceConfig {
    return {
      id: device.id,
      ip: device.ip,
      porta: device.porta,
      api_user: device.api_user,
      api_password: device.api_password,
      fabricante: device.fabricante,
    };
  }

  private parseExternalId(externalId: string): { tipo: string; id: number } {
    const match = externalId.match(/^(morador|visitante)_(\d+)$/);
    if (!match) return { tipo: 'desconhecido', id: 0 };
    return { tipo: match[1], id: Number(match[2]) };
  }

  private normalizeEvento(event?: string, direction?: string): string {
    const e = (event ?? '').toLowerCase();
    const d = (direction ?? '').toLowerCase();
    if (e.includes('denied') || e.includes('negado')) return 'negado';
    if (d === 'in' || e.includes('granted') || e.includes('entrada')) return 'entrada';
    if (d === 'out' || e.includes('saida') || e.includes('exit')) return 'saida';
    return 'entrada';
  }

  private async fetchPhotoAsBase64(foto: string): Promise<string | null> {
    if (!foto) return null;
    if (foto.startsWith('data:')) {
      const idx = foto.indexOf(',');
      return idx >= 0 ? foto.substring(idx + 1) : foto;
    }
    if (foto.startsWith('http://') || foto.startsWith('https://')) {
      try {
        const axios = (await import('axios')).default;
        const res = await axios.get(foto, { responseType: 'arraybuffer', timeout: 15000 });
        return Buffer.from(res.data).toString('base64');
      } catch (err) {
        this.logger.warn(`Falha baixando foto ${foto}: ${err}`);
        return null;
      }
    }
    // Já é base64 puro
    return foto;
  }

  private async markMoradorSyncStatus(id: number, status: string) {
    try {
      await this.prisma.moradores.update({
        where: { id },
        data: { face_sync_status: status },
      });
    } catch {
      /* noop */
    }
  }

  private async markVisitanteSyncStatus(id: number, status: string) {
    try {
      await this.prisma.visitantes.update({
        where: { id },
        data: { face_sync_status: status },
      });
    } catch {
      /* noop */
    }
  }
}
