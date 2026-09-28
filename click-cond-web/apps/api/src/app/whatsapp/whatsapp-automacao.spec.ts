import { AUTOMACOES_PADRAO, ConfigAutomacoes, decidirAutomacao, dentroDoHorario, normalizarConfig } from './whatsapp-automacao';

// Horários em UTC; Brasília = UTC-3. 2026-09-28 é segunda-feira.
const seg10h = new Date('2026-09-28T13:00:00Z'); // seg 10:00 BRT
const seg20h = new Date('2026-09-28T23:00:00Z'); // seg 20:00 BRT
const sab10h = new Date('2026-10-03T13:00:00Z'); // sáb 10:00 BRT

const cfg = (over: Partial<ConfigAutomacoes> = {}): ConfigAutomacoes => ({
  boasVindas: { ...AUTOMACOES_PADRAO.boasVindas, ativo: true },
  foraHorario: { ...AUTOMACOES_PADRAO.foraHorario, ativo: true },
  ...over,
});

describe('dentroDoHorario', () => {
  it('segunda 10h está dentro, 20h fora', () => {
    expect(dentroDoHorario(cfg().foraHorario, seg10h)).toBe(true);
    expect(dentroDoHorario(cfg().foraHorario, seg20h)).toBe(false);
  });
  it('sábado fica fora no padrão (seg–sex)', () => expect(dentroDoHorario(cfg().foraHorario, sab10h)).toBe(false));
  it('limite: 18:00 já é fora, 08:00 já é dentro', () => {
    expect(dentroDoHorario(cfg().foraHorario, new Date('2026-09-28T21:00:00Z'))).toBe(false);
    expect(dentroDoHorario(cfg().foraHorario, new Date('2026-09-28T11:00:00Z'))).toBe(true);
  });
});

describe('decidirAutomacao', () => {
  it('primeira mensagem no horário → boas-vindas', () => {
    expect(decidirAutomacao({ cfg: cfg(), conversaNova: true, ultimaForaHorarioEm: null, agora: seg10h })?.tipo).toBe('auto_boas_vindas');
  });
  it('primeira mensagem fora do horário → só fora do horário', () => {
    expect(decidirAutomacao({ cfg: cfg(), conversaNova: true, ultimaForaHorarioEm: null, agora: seg20h })?.tipo).toBe('auto_fora_horario');
  });
  it('conversa antiga no horário → nada', () => {
    expect(decidirAutomacao({ cfg: cfg(), conversaNova: false, ultimaForaHorarioEm: null, agora: seg10h })).toBeNull();
  });
  it('fora do horário não repete em menos de 12h', () => {
    const ha2h = new Date(seg20h.getTime() - 2 * 3600e3);
    const ha13h = new Date(seg20h.getTime() - 13 * 3600e3);
    expect(decidirAutomacao({ cfg: cfg(), conversaNova: false, ultimaForaHorarioEm: ha2h, agora: seg20h })).toBeNull();
    expect(decidirAutomacao({ cfg: cfg(), conversaNova: false, ultimaForaHorarioEm: ha13h, agora: seg20h })?.tipo).toBe('auto_fora_horario');
  });
  it('fora do horário desligado → primeira mensagem recebe boas-vindas', () => {
    const c = cfg({ foraHorario: { ...AUTOMACOES_PADRAO.foraHorario, ativo: false } });
    expect(decidirAutomacao({ cfg: c, conversaNova: true, ultimaForaHorarioEm: null, agora: seg20h })?.tipo).toBe('auto_boas_vindas');
  });
  it('tudo desligado → nada', () => {
    expect(decidirAutomacao({ cfg: AUTOMACOES_PADRAO, conversaNova: true, ultimaForaHorarioEm: null, agora: seg20h })).toBeNull();
  });
});

describe('normalizarConfig', () => {
  it('completa com o padrão e descarta lixo', () => {
    const c = normalizarConfig({ boasVindas: { ativo: true, texto: '  Oi  ' }, foraHorario: { dias: [1, 9, 'x'], inicio: '25:00' } });
    expect(c.boasVindas).toEqual({ ativo: true, texto: 'Oi' });
    expect(c.foraHorario.dias).toEqual([1]);
    expect(c.foraHorario.inicio).toBe(AUTOMACOES_PADRAO.foraHorario.inicio);
  });
  it('texto vazio volta ao padrão', () => {
    expect(normalizarConfig({ boasVindas: { texto: '' } }).boasVindas.texto).toBe(AUTOMACOES_PADRAO.boasVindas.texto);
  });
});
