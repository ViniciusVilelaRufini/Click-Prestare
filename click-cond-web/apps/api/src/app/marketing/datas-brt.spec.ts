import { diaBrt, fimDiaBrt, inicioDiaBrt } from './datas-brt';

describe('datas-brt', () => {
  it('diaBrt bucketiza um lead noturno em BRT no dia correto', () => {
    expect(diaBrt(new Date('2026-09-10T23:30:00-03:00'))).toBe('2026-09-10');
  });

  it('diaBrt bucketiza um lead de madrugada UTC no dia anterior em BRT', () => {
    // 2026-09-11T02:00:00Z = 2026-09-10T23:00:00-03:00
    expect(diaBrt(new Date('2026-09-11T02:00:00.000Z'))).toBe('2026-09-10');
  });

  it('inicioDiaBrt retorna meia-noite BRT em UTC', () => {
    expect(inicioDiaBrt('2026-09-10').toISOString()).toBe('2026-09-10T03:00:00.000Z');
  });

  it('fimDiaBrt retorna o fim do dia BRT em UTC', () => {
    expect(fimDiaBrt('2026-09-10').toISOString()).toBe('2026-09-11T02:59:59.999Z');
  });
});
