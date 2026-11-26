import { signal } from '@angular/core';
import { TerminaisFaciaisPageComponent } from './terminais-faciais-page.component';

/** "Último contato: há N min" usa a hora do servidor (signal), não Date.now() da máquina. */
describe('TerminaisFaciaisPageComponent — tempoRelativo', () => {
  const tela = (agora: string) => {
    const t = Object.create(TerminaisFaciaisPageComponent.prototype) as any;
    t.agora = signal(new Date(agora));
    return t as TerminaisFaciaisPageComponent;
  };

  it('conta a partir da hora do servidor', () => {
    const t = tela('2026-11-26T12:10:00Z');
    expect(t.tempoRelativo('2026-11-26T12:00:00Z')).toBe('há 10 min');
    expect(t.tempoRelativo('2026-11-26T09:00:00Z')).toBe('há 3h');
    expect(t.tempoRelativo(null)).toBe('sem registro');
  });

  it('data no futuro (relógio desencontrado) não vira número negativo', () => {
    expect(tela('2026-11-26T12:00:00Z').tempoRelativo('2026-11-26T12:05:00Z')).toBe('agora mesmo');
  });
});
