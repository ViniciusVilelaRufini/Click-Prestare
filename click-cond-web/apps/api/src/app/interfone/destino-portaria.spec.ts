import { agoraEmBrasilia, decidirDestino, FaixaAgenda, validarAgenda } from './destino-portaria';
import { InterfoneService } from './interfone.service';

const f = (dia_semana: number, inicio: string, fim: string, destino: 'local' | 'central'): FaixaAgenda => ({
  dia_semana,
  inicio,
  fim,
  destino,
});
const m = (diaSemana: number, hh: number, mm = 0) => ({ diaSemana, minutos: hh * 60 + mm });

describe('decidirDestino', () => {
  it('sem central contratada é sempre local', () => {
    expect(decidirDestino(false, [f(1, '00:00', '24:00', 'central')], m(1, 10), false)).toBe('local');
  });
  it('faixa central vence porteiro online', () => {
    expect(decidirDestino(true, [f(1, '08:00', '18:00', 'central')], m(1, 10), true)).toBe('central');
  });
  it('faixa local com porteiro online fica local', () => {
    expect(decidirDestino(true, [f(1, '08:00', '18:00', 'local')], m(1, 10), true)).toBe('local');
  });
  it('faixa local sem porteiro vira central (salvaguarda)', () => {
    expect(decidirDestino(true, [f(1, '08:00', '18:00', 'local')], m(1, 10), false)).toBe('central');
  });
  it('sem faixas, contratada e sem porteiro → central', () => {
    expect(decidirDestino(true, [], m(1, 10), false)).toBe('central');
  });
  it('sem faixas com porteiro → local', () => {
    expect(decidirDestino(true, [], m(1, 10), true)).toBe('local');
  });
  it('faixa de outro dia não vale', () => {
    expect(decidirDestino(true, [f(2, '00:00', '24:00', 'central')], m(1, 10), true)).toBe('local');
  });
  it('meia-noite', () => {
    const fx = [f(0, '22:00', '24:00', 'central'), f(1, '00:00', '06:00', 'central')];
    expect(decidirDestino(true, fx, m(0, 23, 59), true)).toBe('central');
    expect(decidirDestino(true, fx, m(1, 0, 0), true)).toBe('central');
    expect(decidirDestino(true, fx, m(1, 6, 0), true)).toBe('local');
  });
});

describe('agoraEmBrasilia', () => {
  it('converte UTC para sábado 23:30', () => {
    expect(agoraEmBrasilia(new Date('2026-11-29T02:30:00Z'))).toEqual({ diaSemana: 6, minutos: 1410 });
  });
  it('meia-noite local é minuto 0', () => {
    expect(agoraEmBrasilia(new Date('2026-11-29T03:00:00Z'))).toEqual({ diaSemana: 0, minutos: 0 });
  });
  it('os 7 dias da semana (domingo 29/11/2026 a sábado 05/12), na virada e no meio do dia', () => {
    for (let d = 0; d < 7; d++) {
      const meiaNoite = Date.UTC(2026, 10, 29 + d, 3, 0); // 00:00 em Brasília
      expect(agoraEmBrasilia(new Date(meiaNoite))).toEqual({ diaSemana: d, minutos: 0 });
      expect(agoraEmBrasilia(new Date(meiaNoite + (13 * 60 + 45) * 60_000))).toEqual({ diaSemana: d, minutos: 13 * 60 + 45 });
      // Um minuto antes da meia-noite ainda é o dia anterior.
      expect(agoraEmBrasilia(new Date(meiaNoite - 60_000))).toEqual({ diaSemana: (d + 6) % 7, minutos: 1439 });
    }
  });
  it('não depende dos nomes do ICU (Node com small-icu devolve "Sun", "Mon"…)', () => {
    const original = Intl.DateTimeFormat;
    const espiao = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(((_l?: any, o?: any) => new original('en-US', o)) as any);
    try {
      // Segunda-feira 30/11/2026 10:00 em Brasília.
      expect(agoraEmBrasilia(new Date('2026-11-30T13:00:00Z'))).toEqual({ diaSemana: 1, minutos: 600 });
    } finally {
      espiao.mockRestore();
    }
  });
});

describe('validarAgenda', () => {
  it('aceita agenda válida', () => {
    expect(validarAgenda([f(1, '08:00', '12:00', 'central'), f(1, '12:00', '24:00', 'local')])).toBeNull();
  });
  it('rejeita hora inválida', () => {
    expect(validarAgenda([f(1, '25:00', '26:00', 'central')])).toEqual(expect.any(String));
  });
  it('rejeita início igual ao fim', () => {
    expect(validarAgenda([f(1, '08:00', '08:00', 'central')])).toEqual(expect.any(String));
  });
  it('rejeita sobreposição no mesmo dia', () => {
    expect(validarAgenda([f(1, '08:00', '12:00', 'central'), f(1, '11:00', '13:00', 'local')])).toEqual(expect.any(String));
  });
  it('sobreposição em dias diferentes é ok', () => {
    expect(validarAgenda([f(1, '08:00', '12:00', 'central'), f(2, '11:00', '13:00', 'local')])).toBeNull();
  });
  it('rejeita destino inválido e dia inválido', () => {
    expect(validarAgenda([f(1, '08:00', '12:00', 'x' as any)])).toEqual(expect.any(String));
    expect(validarAgenda([f(7, '08:00', '12:00', 'local')])).toEqual(expect.any(String));
  });
});

describe('InterfoneService.destinoPortaria', () => {
  function svc(contratada: number | null, faixas: FaixaAgenda[], online: boolean) {
    const prisma: any = {
      condominios: { findUnique: jest.fn(async () => (contratada === null ? null : { central_contratada: contratada })) },
      portaria_Agenda: { findMany: jest.fn(async () => faixas) },
    };
    const s = new InterfoneService(prisma, {} as any, {} as any, { porteirosOnline: jest.fn(async () => online) } as any);
    return { s, prisma };
  }
  // segunda 10:00 em Brasília
  const SEG_10 = new Date('2026-11-30T13:00:00Z');

  it('sem contrato é local e nem consulta a agenda', async () => {
    const { s, prisma } = svc(0, [], false);
    expect(await s.destinoPortaria(1, SEG_10)).toBe('local');
    expect(prisma.portaria_Agenda.findMany).not.toHaveBeenCalled();
  });
  it('consulta só as faixas do dia e aplica a faixa central', async () => {
    const { s, prisma } = svc(1, [f(1, '08:00', '18:00', 'central')], true);
    expect(await s.destinoPortaria(1, SEG_10)).toBe('central');
    expect(prisma.portaria_Agenda.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id_condominio: 1, dia_semana: 1 } }));
  });
  it('salvaguarda: sem porteiro online vai para central', async () => {
    const { s } = svc(1, [], false);
    expect(await s.destinoPortaria(1, SEG_10)).toBe('central');
  });
  it('condomínio inexistente é local', async () => {
    const { s } = svc(null, [], false);
    expect(await s.destinoPortaria(1, SEG_10)).toBe('local');
  });
});
