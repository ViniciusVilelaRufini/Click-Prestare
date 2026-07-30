import { Injectable, signal } from '@angular/core';

/**
 * Hora do SERVIDOR, para o console não depender do relógio da máquina.
 *
 * Por que existe: o PC da portaria costuma rodar com o relógio livre no CMOS,
 * sem sincronizar com nenhum servidor de horário. Encontrado em produção com
 * 91,5s de adiantamento (`w32tm`: "Fonte: Local CMOS Clock"). O dashboard
 * mostrava `new Date()` e exibia a hora errada, que não batia com o horário
 * dos eventos gravados pela API.
 *
 * Como funciona: toda resposta HTTP traz o header `Date` do servidor. O
 * interceptor entrega essa data aqui e medimos a defasagem de graça, sem
 * endpoint dedicado e sem NTP. O header precisa estar em
 * `Access-Control-Expose-Headers` na API (ver main.ts) — sem isso o navegador
 * o esconde do JavaScript em requisição cross-origin.
 */
@Injectable({ providedIn: 'root' })
export class ServerClockService {
  /** Quanto o relógio local está adiantado em relação ao servidor, em ms. */
  private skewMs = 0;

  /** Defasagem medida, em segundos (positivo = máquina local adiantada).
   *  `null` enquanto nenhuma resposta foi lida. Usado para avisar o usuário. */
  readonly desvioSegundos = signal<number | null>(null);

  /**
   * Registra a hora do servidor de uma resposta HTTP.
   * @param dateHeader valor cru do header `Date`
   * @param enviadoEm  `Date.now()` de quando a requisição saiu
   */
  registrar(dateHeader: string | null, enviadoEm: number): void {
    if (!dateHeader) return;
    const servidorMs = Date.parse(dateHeader);
    if (!Number.isFinite(servidorMs)) return;

    // O header tem resolução de 1s e a resposta leva um RTT para chegar; usar o
    // meio do intervalo tira o viés da latência. Precisão de ~1s basta: o que
    // importa é não errar por minutos.
    const localMs = (enviadoEm + Date.now()) / 2;
    const novo = localMs - servidorMs;

    // Suaviza para que um pico de latência isolado não sacuda o relógio na tela.
    this.skewMs =
      this.desvioSegundos() === null ? novo : this.skewMs * 0.7 + novo * 0.3;
    this.desvioSegundos.set(Math.round(this.skewMs / 1000));
  }

  /** Hora atual corrigida. Use no lugar de `new Date()` para exibir horário. */
  agora(): Date {
    return new Date(Date.now() - this.skewMs);
  }
}
