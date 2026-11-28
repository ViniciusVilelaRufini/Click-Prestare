import { Injectable, Logger } from '@nestjs/common';

export const VOZ_CONTROLE_PADRAO = 'https://voz.prestarecondominios.com.br';
export const VOZ_CONTROLE_TIMEOUT_MS = 5_000;

/**
 * API → serviço de voz: força a portaria, manda DTMF (abrir pelo facial) e
 * encerra a chamada. POST em `<base>/controle/chamadas/:id/<acao>` com
 * `x-voz-token` (VOZ_INTERNAL_TOKEN). Base = VOZ_CONTROLE_URL ou o padrão.
 *
 * Nunca lança: qualquer falha (sem segredo, rede, timeout, resposta ≠ ok)
 * vira `false` e quem chamou decide.
 */
@Injectable()
export class VozControleClient {
  private readonly logger = new Logger(VozControleClient.name);
  private avisouSemToken = false;
  /** Público para os testes trocarem por um falso. */
  fetch: typeof fetch = (...a) => fetch(...a);

  portaria(id: number): Promise<boolean> {
    return this.post(id, 'portaria', {});
  }

  dtmf(id: number, digitos: string): Promise<boolean> {
    if (typeof digitos !== 'string' || !/^[0-9*#]{1,10}$/.test(digitos)) return Promise.resolve(false);
    return this.post(id, 'dtmf', { digitos });
  }

  encerrar(id: number): Promise<boolean> {
    return this.post(id, 'encerrar', {});
  }

  private base(): string {
    return (process.env['VOZ_CONTROLE_URL'] || VOZ_CONTROLE_PADRAO).replace(/\/+$/, '');
  }

  private async post(id: number, acao: string, corpo: object): Promise<boolean> {
    const token = process.env['VOZ_INTERNAL_TOKEN'];
    if (!token) {
      if (!this.avisouSemToken) {
        this.avisouSemToken = true;
        this.logger.warn('Interfone: VOZ_INTERNAL_TOKEN ausente; controle do serviço de voz desligado.');
      }
      return false;
    }
    if (!Number.isInteger(id) || id <= 0) return false;
    try {
      const r = await this.fetch(`${this.base()}/controle/chamadas/${id}/${acao}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-voz-token': token },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(VOZ_CONTROLE_TIMEOUT_MS),
      });
      if (!r.ok) {
        this.logger.warn(`Interfone: controle ${acao} da chamada ${id} respondeu ${r.status}`);
        return false;
      }
      const j: any = await r.json().catch(() => null);
      return j?.ok === true;
    } catch (e: any) {
      this.logger.warn(`Interfone: controle ${acao} da chamada ${id} falhou: ${e?.name ?? ''} ${e?.message ?? e}`.trim());
      return false;
    }
  }
}
