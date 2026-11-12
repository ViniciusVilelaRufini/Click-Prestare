import { hojeBrasilia, intervaloHojeBrasilia } from './hora-brasilia.util';

describe('intervaloHojeBrasilia — dia civil de Brasília como instantes', () => {
  const tzOriginal = process.env.TZ;
  afterAll(() => { process.env.TZ = tzOriginal; });

  for (const tz of ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']) {
    describe(`com TZ=${tz}`, () => {
      beforeAll(() => { process.env.TZ = tz; });

      it('23:30 BRT (02:30Z do dia seguinte) fica no dia BRT que começou', () => {
        const r = intervaloHojeBrasilia(new Date('2026-11-12T02:30:00Z'));
        expect(r.inicio.toISOString()).toBe('2026-11-11T03:00:00.000Z');
        expect(r.fim.toISOString()).toBe('2026-11-12T02:59:59.999Z');
      });

      it('00:30 BRT (03:30Z) abre o dia novo', () => {
        const r = intervaloHojeBrasilia(new Date('2026-11-12T03:30:00Z'));
        expect(r.inicio.toISOString()).toBe('2026-11-12T03:00:00.000Z');
        expect(r.fim.toISOString()).toBe('2026-11-13T02:59:59.999Z');
      });

      it('meio-dia BRT', () => {
        const r = intervaloHojeBrasilia(new Date('2026-11-12T15:00:00Z'));
        expect(r.inicio.toISOString()).toBe('2026-11-12T03:00:00.000Z');
        expect(r.fim.toISOString()).toBe('2026-11-13T02:59:59.999Z');
      });

      it('usa o offset do Intl: em fevereiro/2018 (horário de verão, -2) muda', () => {
        const r = intervaloHojeBrasilia(new Date('2018-01-15T15:00:00Z'));
        expect(r.inicio.toISOString()).toBe('2018-01-15T02:00:00.000Z');
        expect(r.fim.toISOString()).toBe('2018-01-16T01:59:59.999Z');
      });

      it('hojeBrasilia continua devolvendo a data civil à meia-noite UTC', () => {
        expect(hojeBrasilia(new Date('2026-11-12T02:30:00Z')).toISOString())
          .toBe('2026-11-11T00:00:00.000Z');
      });
    });
  }
});
