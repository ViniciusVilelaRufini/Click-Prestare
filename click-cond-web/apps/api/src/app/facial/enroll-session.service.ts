import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoCompartilhado } from '../common/estado-compartilhado';

const PREFIXO = 'enroll:';

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
 * As sessões ficam em estado_compartilhado (TTL 90s): o portal abre a sessão
 * numa instância e o evento do leitor chega na outra. A captura usa
 * `reivindicar` — só um evento preenche a sessão, mesmo com as duas
 * instâncias recebendo leituras ao mesmo tempo. Sem banco, fica em memória.
 */
@Injectable()
export class EnrollSessionService {
  private readonly ttlMs = 90_000;
  private readonly estado: EstadoCompartilhado;

  constructor(@Optional() prisma?: PrismaService) {
    this.estado = new EstadoCompartilhado(prisma);
  }

  async start(idDevice: number): Promise<EnrollSession> {
    const id = randomBytes(8).toString('hex');
    const session: EnrollSession = {
      id,
      idDevice,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
      status: 'waiting',
      capturedValue: null,
    };
    await this.estado.definir(PREFIXO + id, session, this.ttlMs);
    return session;
  }

  /**
   * Tenta consumir uma sessão ativa para o device dado. Retorna a sessão
   * (já marcada como captured) se havia uma aguardando, ou null caso contrário.
   * Chamado pelo processWebhook quando recebe um valor não identificado.
   */
  async consumeForDevice(idDevice: number, value: string): Promise<EnrollSession | null> {
    const abertas = await this.estado.listarPorPrefixo<EnrollSession>(PREFIXO);
    for (const e of abertas) {
      if (e.consumidoEm || e.valor.idDevice !== idDevice || e.valor.status !== 'waiting') continue;
      const capturada: EnrollSession = { ...e.valor, status: 'captured', capturedValue: value };
      if (await this.estado.reivindicar(e.chave, capturada)) return capturada;
    }
    return null;
  }

  async get(id: string): Promise<EnrollSession> {
    const e = await this.estado.obter<EnrollSession>(PREFIXO + id);
    if (!e) throw new NotFoundException('Sessão de enrollment expirada');
    return e.valor;
  }

  async cancel(id: string): Promise<void> {
    await this.estado.remover(PREFIXO + id);
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
