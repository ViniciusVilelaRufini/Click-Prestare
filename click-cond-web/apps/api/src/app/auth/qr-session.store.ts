import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';

export interface QrSession {
  qrToken: string;
  status: 'pending' | 'confirmed' | 'expired';
  expiresAt: Date;
  idUser?: number;
  nome?: string;
  typeAccess?: string;
  id_condominio?: number;
  condominio_nome?: string;
  access_token?: string;
}

const TTL_MS = 2 * 60 * 1000;
const PREFIXO = 'qr:';

/**
 * Sessões do login por QR Code na portaria-web.
 *
 * Em estado_compartilhado (TTL 2 min): o navegador cria a sessão numa
 * instância, o app confirma em outra e o navegador consulta o status em
 * qualquer uma. A confirmação (pending → confirmed) e a entrega do token
 * (apaga ao entregar) são atômicas no banco — duas instâncias não confirmam
 * nem entregam a mesma sessão duas vezes. Sem banco, fica em memória.
 */
@Injectable()
export class QrSessionStore {
  private readonly estado: EstadoCompartilhado;

  constructor(@Optional() prisma?: PrismaService) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  async create(): Promise<QrSession> {
    const qrToken = 'qr_' + randomUUID().replace(/-/g, '');
    const session: QrSession = {
      qrToken,
      status: 'pending',
      expiresAt: new Date(Date.now() + TTL_MS), // Expirar em 2 minutos
    };
    await this.estado.definir(PREFIXO + qrToken, session, TTL_MS);
    return session;
  }

  async get(token: string): Promise<QrSession | null> {
    if (!token) return null;
    const e = await this.estado.obter<QrSession>(PREFIXO + token);
    if (!e) return null;
    return { ...e.valor, expiresAt: new Date(e.valor.expiresAt) };
  }

  /** pending → confirmed, uma vez só (UPDATE condicional). */
  async confirm(token: string, data: Partial<QrSession>): Promise<boolean> {
    const session = await this.get(token);
    if (!session || session.status !== 'pending') {
      return false;
    }
    return this.estado.reivindicar(PREFIXO + token, { ...session, ...data, status: 'confirmed' });
  }

  /**
   * Entrega única: depois que o token de portaria sai pelo status, a sessão
   * deixa de existir — quem fotografou o QR e consulta depois não recebe nada.
   * Devolve a sessão só para quem de fato a apagou.
   */
  async consumir(token: string): Promise<QrSession | null> {
    const s = await this.estado.consumirUmaVez<QrSession>(PREFIXO + token);
    return s ? { ...s, expiresAt: new Date(s.expiresAt) } : null;
  }
}
