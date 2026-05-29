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
  tipo?: string;
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
  card_uid?: string;
  qrcode?: string;
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
        tipo: dto.tipo ?? 'facial',
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
        ...(dto.tipo !== undefined && { tipo: dto.tipo }),
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

  async triggerDevice(id: number) {
    const device = await this.getDevice(id);
    if (device.tipo !== 'botoeira' && device.tipo !== 'catraca') {
      throw new BadRequestException('Apenas dispositivos do tipo Botoeira ou Catraca podem ser acionados remotamente.');
    }
    const success = await this.client.triggerRelay(this.toConfig(device));
    await this.prisma.acessos_Facial.create({
      data: {
        id_condominio: device.id_condominio,
        id_device: device.id,
        tipo_dispositivo: device.tipo,
        face_id: 'trigger_manual',
        tipo_pessoa: 'operador',
        id_pessoa: null,
        nome_pessoa: 'Operador (Portal Web)',
        evento: 'acionado_manual',
        timestamp: new Date(),
      },
    });
    return { ok: success };
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

    let tipoPessoa: 'morador' | 'visitante' | 'prestador' | 'funcionario' | null = null;
    let idPessoa: number | null = null;
    let nomePessoa = 'Desconhecido';
    let faceIdSalvo = '';
    const confianca = payload.confidence ?? null;
    const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const evento = this.normalizeEvento(payload.event, payload.direction);

    const qrCodeLido = payload.qrcode ?? (device.tipo === 'qrcode_reader' ? payload.external_id : undefined);
    const tagRfidLida = payload.card_uid ?? (device.tipo === 'tag_reader' ? payload.external_id : undefined);
    const externalId = payload.external_id ?? payload.person_id ?? '';

    if (qrCodeLido) {
      const morador = await this.prisma.moradores.findFirst({
        where: { qrcode_acesso: qrCodeLido, id_condominio: device.id_condominio }
      });
      if (morador) {
        tipoPessoa = 'morador';
        idPessoa = morador.id;
        nomePessoa = morador.nome;
        faceIdSalvo = qrCodeLido;
      } else {
        const visitante = await this.prisma.visitantes.findFirst({
          where: { codigo_acesso: qrCodeLido, id_condominio: device.id_condominio }
        });
        if (visitante) {
          tipoPessoa = visitante.is_prestador === 1 ? 'prestador' : 'visitante';
          idPessoa = visitante.id;
          nomePessoa = visitante.nome;
          faceIdSalvo = qrCodeLido;
        }
      }
    } else if (tagRfidLida) {
      const morador = await this.prisma.moradores.findFirst({
        where: { tag_rfid: tagRfidLida, id_condominio: device.id_condominio }
      });
      if (morador) {
        tipoPessoa = 'morador';
        idPessoa = morador.id;
        nomePessoa = morador.nome;
        faceIdSalvo = tagRfidLida;
      } else {
        const visitante = await this.prisma.visitantes.findFirst({
          where: { tag_rfid: tagRfidLida, id_condominio: device.id_condominio }
        });
        if (visitante) {
          tipoPessoa = visitante.is_prestador === 1 ? 'prestador' : 'visitante';
          idPessoa = visitante.id;
          nomePessoa = visitante.nome;
          faceIdSalvo = tagRfidLida;
        }
      }
    } else if (externalId) {
      const parsed = this.parseExternalId(externalId);
      if (parsed.tipo === 'morador') {
        const m = await this.prisma.moradores.findUnique({ where: { id: parsed.id } });
        if (m) {
          tipoPessoa = 'morador';
          idPessoa = m.id;
          nomePessoa = m.nome;
          faceIdSalvo = m.face_id ?? externalId;
        }
      } else if (parsed.tipo === 'visitante') {
        const v = await this.prisma.visitantes.findUnique({ where: { id: parsed.id } });
        if (v) {
          tipoPessoa = v.is_prestador === 1 ? 'prestador' : 'visitante';
          idPessoa = v.id;
          nomePessoa = v.nome;
          faceIdSalvo = v.face_id ?? externalId;
        }
      }
    }

    if (!idPessoa || !tipoPessoa) {
      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          tipo_dispositivo: device.tipo,
          face_id: qrCodeLido ?? tagRfidLida ?? externalId ?? 'desconhecido',
          tipo_pessoa: 'desconhecido',
          id_pessoa: null,
          nome_pessoa: 'Não identificado ou expirado',
          evento: 'negado',
          confianca,
          timestamp,
        },
      });
      throw new BadRequestException('Acesso negado: Credencial não encontrada ou inválida');
    }

    // Regra: Visitantes e Prestadores só podem acessar se a entrada foi ativamente liberada/registrada via app ou web
    if (tipoPessoa === 'visitante' || tipoPessoa === 'prestador') {
      const v = await this.prisma.visitantes.findUnique({ where: { id: idPessoa } });
      if (!v) {
        throw new NotFoundException('Cadastro de visitante/prestador não encontrado');
      }

      if (evento === 'entrada') {
        if (!v.data_entrada) {
          await this.prisma.acessos_Facial.create({
            data: {
              id_condominio: device.id_condominio,
              id_device: device.id,
              tipo_dispositivo: device.tipo,
              face_id: faceIdSalvo || qrCodeLido || tagRfidLida || externalId || 'desconhecido',
              tipo_pessoa: tipoPessoa,
              id_pessoa: idPessoa,
              nome_pessoa: `${nomePessoa} (Bloqueado por falta de liberação)`,
              evento: 'negado',
              confianca,
              timestamp,
            },
          });
          throw new BadRequestException(
            'Acesso negado: A entrada deste visitante não foi autorizada pelo morador ou portaria.'
          );
        }
      } else if (evento === 'saida') {
        if (!v.data_entrada || v.data_saida) {
          await this.prisma.acessos_Facial.create({
            data: {
              id_condominio: device.id_condominio,
              id_device: device.id,
              tipo_dispositivo: device.tipo,
              face_id: faceIdSalvo || qrCodeLido || tagRfidLida || externalId || 'desconhecido',
              tipo_pessoa: tipoPessoa,
              id_pessoa: idPessoa,
              nome_pessoa: `${nomePessoa} (Bloqueado por não estar no condomínio)`,
              evento: 'negado',
              confianca,
              timestamp,
            },
          });
          throw new BadRequestException(
            'Acesso negado: Este visitante não possui uma entrada ativa no condomínio para poder registrar saída.'
          );
        }
      }
    }

    // Validação de Regras de Acesso (Sprint 3 com Horários e Sentidos)
    const regrasDispositivo = await this.prisma.regras_Acesso.findMany({
      where: {
        id_condominio: device.id_condominio,
        ativo: 1,
        dispositivos: {
          some: {
            id_dispositivo: device.id,
          },
        },
      },
    });

    if (regrasDispositivo.length > 0) {
      let possuiRegraAplicavel = false;
      let permitido = false;

      // Obtém o horário do evento em formato HH:MM (ajustando a data e a timezone se necessário)
      const horaMinutoAtual = timestamp.toTimeString().substring(0, 5); // formato "HH:MM"

      for (const r of regrasDispositivo) {
        // 1. Validar sentido (entrada / saida / ambos)
        if (r.sentido !== 'ambos' && r.sentido !== evento) {
          continue; // Esta regra não se aplica a esta direção
        }

        // 2. Validar horário de funcionamento da regra
        if (r.hora_inicio && r.hora_fim) {
          let dentroDoHorario = false;
          if (r.hora_inicio <= r.hora_fim) {
            dentroDoHorario = horaMinutoAtual >= r.hora_inicio && horaMinutoAtual <= r.hora_fim;
          } else {
            // Caso ultrapasse a meia-noite (ex: das 22:00 às 06:00)
            dentroDoHorario = horaMinutoAtual >= r.hora_inicio || horaMinutoAtual <= r.hora_fim;
          }
          if (!dentroDoHorario) {
            continue; // Esta regra não se aplica a este horário
          }
        }

        // Se a regra é válida para esta direção e hora, ela passa a ser uma regra ativa/aplicável
        possuiRegraAplicavel = true;

        // 3. Validar se a categoria da pessoa é permitida
        if (tipoPessoa === 'morador' && r.permitir_morador === 1) permitido = true;
        if (tipoPessoa === 'visitante' && r.permitir_visitante === 1) permitido = true;
        if (tipoPessoa === 'prestador' && r.permitir_prestador === 1) permitido = true;
        if (tipoPessoa === 'funcionario' && r.permitir_funcionario === 1) permitido = true;
      }

      // Se temos regras aplicáveis para este sentido e horário, mas nenhuma autorizou o usuário
      if (possuiRegraAplicavel && !permitido) {
        await this.prisma.acessos_Facial.create({
          data: {
            id_condominio: device.id_condominio,
            id_device: device.id,
            tipo_dispositivo: device.tipo,
            face_id: faceIdSalvo || qrCodeLido || tagRfidLida || externalId || 'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Bloqueado por Regra de Acesso)`,
            evento: 'negado',
            confianca,
            timestamp,
          },
        });

        const sentidoLabel = evento === 'entrada' ? 'Entrada' : evento === 'saida' ? 'Saída' : evento;
        throw new BadRequestException(
          `Acesso negado: terminal restrito para ${
            tipoPessoa === 'morador'
              ? 'Moradores'
              : tipoPessoa === 'prestador'
              ? 'Prestadores'
              : 'Visitantes'
          } no sentido de ${sentidoLabel} neste horário`
        );
      }
    }

    // Controle de Anti-passback (Evita registro duplicado sequencial de entrada ou saída)
    if (evento === 'entrada' || evento === 'saida') {
      const ultimoAcesso = await this.prisma.acessos_Facial.findFirst({
        where: {
          tipo_pessoa: tipoPessoa,
          id_pessoa: idPessoa,
          evento: { in: ['entrada', 'saida'] },
        },
        orderBy: { timestamp: 'desc' },
      });

      if (ultimoAcesso && ultimoAcesso.evento === evento) {
        await this.prisma.acessos_Facial.create({
          data: {
            id_condominio: device.id_condominio,
            id_device: device.id,
            tipo_dispositivo: device.tipo,
            face_id: faceIdSalvo || qrCodeLido || tagRfidLida || externalId || 'desconhecido',
            tipo_pessoa: tipoPessoa,
            id_pessoa: idPessoa,
            nome_pessoa: `${nomePessoa} (Bloqueado por Anti-passback)`,
            evento: 'negado',
            confianca,
            timestamp,
          },
        });

        const sentidoLabel = evento === 'entrada' ? 'entrada' : 'saída';
        throw new BadRequestException(
          `Acesso negado: O usuário já registrou uma ${sentidoLabel} e não pode registrar outra sequencialmente (Regra de Anti-passback).`
        );
      }
    }

    if (tipoPessoa === 'morador') {
      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          tipo_dispositivo: device.tipo,
          face_id: faceIdSalvo,
          tipo_pessoa: 'morador',
          id_pessoa: idPessoa,
          nome_pessoa: nomePessoa,
          evento,
          confianca,
          timestamp,
        },
      });
    } else {
      const isEntrada = evento === 'entrada';
      const v = await this.prisma.visitantes.findUnique({ where: { id: idPessoa } });
      if (!v) throw new NotFoundException('Cadastro de visitante/prestador não encontrado');

      if (isEntrada) {
        await this.prisma.visitantes.update({
          where: { id: v.id },
          data: { data_entrada: timestamp, data_saida: null },
        });
      } else if (evento === 'saida') {
        await this.prisma.visitantes.update({
          where: { id: v.id },
          data: { data_saida: timestamp, codigo_acesso: device.tipo === 'qrcode_reader' ? null : v.codigo_acesso },
        });
      }

      await this.prisma.acessos_Facial.create({
        data: {
          id_condominio: device.id_condominio,
          id_device: device.id,
          tipo_dispositivo: device.tipo,
          face_id: faceIdSalvo,
          tipo_pessoa: v.is_prestador === 1 ? 'prestador' : 'visitante',
          id_pessoa: v.id,
          nome_pessoa: nomePessoa,
          evento,
          confianca,
          timestamp,
        },
      });

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
          const label = v.is_prestador === 1 ? 'Prestador' : 'Visitante';
          const titulo = evento === 'entrada' ? `${label} entrou` : `${label} saiu`;
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
    }

    return { ok: true, tipo: tipoPessoa, id: idPessoa, evento };
  }

  async listAcessos(idCondominio: number, limit = 50) {
    const list = await this.prisma.acessos_Facial.findMany({
      where: { id_condominio: idCondominio },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 200),
    });
    return list.map((a) => {
      let observacao = null;
      const match = a.nome_pessoa.match(/\(([^)]+)\)/);
      if (match) {
        observacao = match[1];
      }
      return {
        ...a,
        observacao,
      };
    });
  }

  async listAcessosPessoa(tipo: 'morador' | 'visitante', idPessoa: number, limit = 30) {
    const list = await this.prisma.acessos_Facial.findMany({
      where: { tipo_pessoa: tipo, id_pessoa: idPessoa },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 100),
    });
    return list.map((a) => {
      let observacao = null;
      const match = a.nome_pessoa.match(/\(([^)]+)\)/);
      if (match) {
        observacao = match[1];
      }
      return {
        ...a,
        observacao,
      };
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
