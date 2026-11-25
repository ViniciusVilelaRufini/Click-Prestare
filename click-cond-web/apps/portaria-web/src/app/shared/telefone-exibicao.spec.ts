import { formatarTelefoneExibicao } from './input-mask.directive';

/** W9 (varredura 25/11): Moradores → Contato mostrava "11953561869" cru numa linha e "(17) 98833-8146" em outra. */
describe('formatarTelefoneExibicao', () => {
  it('celular cru (11 dígitos) → (DD) 9XXXX-XXXX', () => {
    expect(formatarTelefoneExibicao('11953561869')).toBe('(11) 95356-1869');
  });
  it('fixo cru (10 dígitos) → (DD) XXXX-XXXX', () => {
    expect(formatarTelefoneExibicao('1733224455')).toBe('(17) 3322-4455');
  });
  it('já formatado continua igual', () => {
    expect(formatarTelefoneExibicao('(17) 98833-8146')).toBe('(17) 98833-8146');
  });
  it('outros formatos saem como vieram', () => {
    expect(formatarTelefoneExibicao('+55 11 95356-1869')).toBe('+55 11 95356-1869');
    expect(formatarTelefoneExibicao('9535')).toBe('9535');
  });
  it('vazio', () => {
    expect(formatarTelefoneExibicao(null)).toBe('');
    expect(formatarTelefoneExibicao(undefined)).toBe('');
  });
});
