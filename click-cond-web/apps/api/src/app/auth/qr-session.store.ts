import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

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

@Injectable()
export class QrSessionStore {
  private sessions = new Map<string, QrSession>();

  constructor() {
    // Limpeza periódica automática a cada 30 segundos
    setInterval(() => this.cleanup(), 30000).unref?.();
  }

  create(): QrSession {
    const qrToken = 'qr_' + randomUUID().replace(/-/g, '');
    const session: QrSession = {
      qrToken,
      status: 'pending',
      expiresAt: new Date(Date.now() + 2 * 60 * 1000), // Expirar em 2 minutos
    };
    this.sessions.set(qrToken, session);
    return session;
  }

  get(token: string): QrSession | null {
    const session = this.sessions.get(token);
    if (!session) return null;

    if (session.expiresAt.getTime() < Date.now()) {
      session.status = 'expired';
      this.sessions.delete(token);
      return null;
    }

    return session;
  }

  confirm(token: string, data: Partial<QrSession>): boolean {
    const session = this.get(token);
    if (!session || session.status !== 'pending') {
      return false;
    }

    Object.assign(session, data, { status: 'confirmed' });
    return true;
  }

  /**
   * Entrega única: depois que o token de portaria sai pelo status, a sessão
   * deixa de existir — quem fotografou o QR e consulta depois não recebe nada.
   */
  consumir(token: string): void {
    this.sessions.delete(token);
  }

  private cleanup() {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() < now) {
        this.sessions.delete(token);
      }
    }
  }
}
