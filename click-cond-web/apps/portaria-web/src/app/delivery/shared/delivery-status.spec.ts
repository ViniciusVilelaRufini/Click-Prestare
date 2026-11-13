import { organizarAcoes, rotuloStatus, tomStatus, verboAcao, PROXIMOS_STATUS, STATUS_CARDS } from './delivery-status';

describe('delivery-status', () => {
  it('rotula em caixa de frase com acento', () => {
    expect(rotuloStatus('AGUARDANDO_AUTORIZACAO')).toBe('Aguardando autorização');
    expect(rotuloStatus('CONCLUIDA')).toBe('Concluída');
    expect(rotuloStatus('RETIRADA_NA_PORTARIA')).toBe('Na portaria – aguardando retirada');
  });

  it('associa tons e verbos', () => {
    expect(tomStatus('CHEGOU')).toBe('amber');
    expect(tomStatus('RECUSADA')).toBe('red');
    expect(verboAcao('AUTORIZADA')).toBe('Autorizar subida');
    expect(verboAcao('AGUARDANDO_AUTORIZACAO')).toBe('Pedir autorização ao morador');
  });

  it('ordena ações: autorizar primária, recusar separada', () => {
    expect(organizarAcoes(PROXIMOS_STATUS.CHEGOU)).toEqual({
      primaria: 'AUTORIZADA',
      secundarias: ['AGUARDANDO_AUTORIZACAO', 'RETIRADA_NA_PORTARIA'],
      recusar: true,
      cancelar: false,
    });
    expect(organizarAcoes(PROXIMOS_STATUS.CONCLUIDA)).toEqual({ primaria: null, secundarias: [], recusar: false, cancelar: false });
  });

  it('A1: portaria cancela aviso agendado (ação separada, com motivo)', () => {
    expect(PROXIMOS_STATUS.AGENDADA).toContain('CANCELADA');
    expect(organizarAcoes(PROXIMOS_STATUS.AGENDADA)).toEqual({ primaria: 'CHEGOU', secundarias: [], recusar: false, cancelar: true });
  });

  it('M4: entrega na portaria tem "Deixar na portaria" como ação principal', () => {
    expect(organizarAcoes(PROXIMOS_STATUS.CHEGOU, 'PORTARIA')).toEqual({
      primaria: 'RETIRADA_NA_PORTARIA',
      secundarias: ['AGUARDANDO_AUTORIZACAO', 'AUTORIZADA'],
      recusar: true,
      cancelar: false,
    });
    expect(organizarAcoes(PROXIMOS_STATUS.CHEGOU, 'UNIDADE').primaria).toBe('AUTORIZADA');
  });

  it('M5: aguardando retirada tem card próprio', () => {
    expect(STATUS_CARDS).toContain('RETIRADA_NA_PORTARIA');
  });
});
