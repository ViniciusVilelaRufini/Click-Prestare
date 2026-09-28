import { origemPermitida } from './origem-permitida';

describe('origemPermitida', () => {
  it('sem Origin (chamada de servidor/script) é permitido', () => {
    expect(origemPermitida(undefined)).toBe(true);
  });

  it('Origin na lista principal é permitido', () => {
    expect(origemPermitida('https://www.prestarecondominios.com.br')).toBe(true);
  });

  it('Origin fora da lista é rejeitado', () => {
    expect(origemPermitida('https://site-malicioso.com')).toBe(false);
  });
});
