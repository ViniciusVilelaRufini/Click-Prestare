import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';

/**
 * Sessões de "captura" para enrollment guiado de RFID/QR.
 *
 * Fluxo:
 *   1. Portal chama POST /facial/enroll/start com id_device do leitor
 *   2. Server cria sessão (id aleatório, TTL 90s) e devolve sessionId
 *   3. Portal mostra "Apresente o crachá no leitor" e faz polling
 *   4. Quando alguém encosta uma tag não cadastrada nesse leitor, o
 *      processWebhook detecta a sessão ativa e desvia: registra o UID na
 *      sessão (status=captured) em vez de processar como acesso
 *   5. Portal recebe o UID no polling e preenche o campo
 *
 * Decisão: sessões viva apenas em memória. Se o backend reiniciar, sessões
 * são perdidas — operador reinicia a captura. Não vale o custo de persistir.
 */
@Injectable()
export class EnrollSessionService {
  private readonly sessions = new Map<string, EnrollSession>();
  private readonly ttlMs = 90_000;

  start(idDevice: number): EnrollSession {
    const id = randomBytes(8).toString('hex');
    const session: EnrollSession = {
      id,
      idDevice,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
      status: 'waiting',
      capturedValue: null,
    };
    this.sessions.set(id, session);
    this.cleanup();
    return session;
  }

  /**
   * Tenta consumir uma sessão ativa para o device dado. Retorna a sessão
   * (já marcada como captured) se havia uma aguardando, ou null caso contrário.
   * Chamado pelo processWebhook quando recebe um valor não identificado.
   */
  consumeForDevice(idDevice: number, value: string): EnrollSession | null {
    this.cleanup();
    for (const session of this.sessions.values()) {
      if (session.idDevice === idDevice && session.status === 'waiting') {
        session.status = 'captured';
        session.capturedValue = value;
        return session;
      }
    }
    return null;
  }

  get(id: string): EnrollSession {
    this.cleanup();
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException('Sessão de enrollment expirada');
    return session;
  }

  cancel(id: string): void {
    this.sessions.delete(id);
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) this.sessions.delete(id);
    }
  }
}

export interface EnrollSession {
  id: string;
  idDevice: number;
  createdAt: number;
  expiresAt: number;
  status: 'waiting' | 'captured';
  capturedValue: string | null;
}
