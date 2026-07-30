import { Injectable } from '@nestjs/common';

/**
 * Store em memória de "triggers" recebidos por botoeiras simuladas.
 *
 * Como funciona o setup:
 *   1. Operador roda o simulator-botoeira.html no browser e escolhe um slug
 *      (ex: "porta-entrada").
 *   2. Cadastra um Facial_Device com fabricante "genérico", ip "localhost"
 *      e porta igual à da API, indicando esse slug no nome ou em algum campo.
 *   3. Quando a ponte (RFID/QR → botoeira) chama POST /open_door no IP do
 *      device, o axios bate no PRÓPRIO backend, que registra aqui o trigger.
 *   4. O HTML faz polling em /sim/relay/:slug/events e mostra animação.
 *
 * Isso permite testar o fluxo ponta-a-ponta sem hardware real.
 */
@Injectable()
export class MockRelayService {
  private readonly events = new Map<string, MockRelayEvent[]>();
  private readonly maxPerSlug = 50;
  /**
   * Teto de slugs distintos. Os eventos já eram limitados por slug, mas o Map
   * em si crescia sem fim: chamadas com slugs aleatórios inflavam a memória do
   * processo indefinidamente. O slug vem da URL, então é entrada de fora.
   */
  private readonly maxSlugs = 50;

  record(slug: string, payload: unknown): MockRelayEvent {
    const event: MockRelayEvent = {
      id: Date.now() + Math.random(),
      slug,
      payload,
      receivedAt: new Date().toISOString(),
    };
    const list = this.events.get(slug) ?? [];
    list.unshift(event);
    if (list.length > this.maxPerSlug) list.length = this.maxPerSlug;
    this.events.set(slug, list);

    // Descarta o slug mais antigo quando estoura o teto (Map preserva ordem de
    // inserção, então o primeiro é o menos recente).
    while (this.events.size > this.maxSlugs) {
      const maisAntigo = this.events.keys().next().value;
      if (maisAntigo === undefined) break;
      this.events.delete(maisAntigo);
    }

    return event;
  }

  list(slug: string, since?: number): MockRelayEvent[] {
    const list = this.events.get(slug) ?? [];
    if (!since) return list;
    return list.filter((e) => e.id > since);
  }

  clear(slug: string): void {
    this.events.delete(slug);
  }
}

export interface MockRelayEvent {
  id: number;
  slug: string;
  payload: unknown;
  receivedAt: string;
}
