import { organizarAcoes, rotuloStatus, tomStatus, verboAcao, PROXIMOS_STATUS } from './delivery-status';

describe('delivery-status', () => {
  it('rotula em caixa de frase com acento', () => {
    expect(rotuloStatus('AGUARDANDO_AUTORIZACAO')).toBe('Aguardando autorização');
    expect(rotuloStatus('CONCLUIDA')).toBe('Concluída');
    expect(rotuloStatus('RETIRADA_NA_PORTARIA')).toBe('Retirada na portaria');
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
    });
    expect(organizarAcoes(PROXIMOS_STATUS.AGENDADA)).toEqual({ primaria: 'CHEGOU', secundarias: [], recusar: false });
    expect(organizarAcoes(PROXIMOS_STATUS.CONCLUIDA)).toEqual({ primaria: null, secundarias: [], recusar: false });
  });

  it('portaria não cancela aviso agendado', () => {
    expect(PROXIMOS_STATUS.AGENDADA).not.toContain('CANCELADA');
  });
});
