import { entradasPorHora } from './dashboard.service';

/** O servidor roda em UTC; o gráfico do console segue o calendário de Brasília. */
describe('entradasPorHora', () => {
  const agora = new Date('2026-11-09T15:00:00.000Z'); // 12:00 em Brasília

  it('conta na hora de Brasília, não na do servidor', () => {
    const horas = entradasPorHora([new Date('2026-11-09T11:30:00.000Z')], agora);
    expect(horas).toHaveLength(24);
    expect(horas[8]).toBe(1);
    expect(horas[11]).toBe(0);
  });

  it('descarta entradas de ontem, mesmo com data UTC de hoje', () => {
    // 01:00 UTC do dia 9 ainda é 22:00 do dia 8 em Brasília.
    const horas = entradasPorHora([new Date('2026-11-09T01:00:00.000Z')], agora);
    expect(horas.reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('ignora data nula e soma as entradas da mesma hora', () => {
    const d = new Date('2026-11-09T14:10:00.000Z');
    const horas = entradasPorHora([d, null, d], agora);
    expect(horas[11]).toBe(2);
  });
});
