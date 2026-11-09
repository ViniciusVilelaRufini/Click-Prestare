import { totaisPorDia } from './dashboard.service';

/** Mini-gráficos do console: um total por dia, no calendário de Brasília. */
describe('totaisPorDia', () => {
  const agora = new Date('2026-11-09T15:00:00.000Z'); // 09/11, 12:00 em Brasília

  it('devolve 7 dias com hoje no fim', () => {
    const t = totaisPorDia([new Date('2026-11-09T13:00:00.000Z'), new Date('2026-11-03T13:00:00.000Z')], agora);
    expect(t).toEqual([1, 0, 0, 0, 0, 0, 1]);
  });

  it('conta no dia de Brasília: 01:00 UTC do dia 9 ainda é dia 8', () => {
    const t = totaisPorDia([new Date('2026-11-09T01:00:00.000Z')], agora);
    expect(t[5]).toBe(1);
    expect(t[6]).toBe(0);
  });

  it('descarta datas fora da janela e nulas', () => {
    const t = totaisPorDia([new Date('2026-11-01T13:00:00.000Z'), null], agora);
    expect(t.reduce((s, v) => s + v, 0)).toBe(0);
  });
});
