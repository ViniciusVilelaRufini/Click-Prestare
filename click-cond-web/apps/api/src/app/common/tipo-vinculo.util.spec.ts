import { maiorVinculo, nivelVinculo, normalizarTipoVinculo } from './tipo-vinculo.util';

describe('tipo de vínculo da unidade', () => {
  it.each([
    ['proprietario', 'proprietario'],
    ['Proprietário', 'proprietario'],
    ['PROPRIETARIO ', 'proprietario'],
    ['morador', 'proprietario'],
    ['', 'proprietario'],
    [null, 'proprietario'],
    [undefined, 'proprietario'],
    ['qualquer coisa', 'proprietario'],
    ['inquilino', 'inquilino'],
    [' Inquilino', 'inquilino'],
    ['membro', 'membro'],
    ['Dependente', 'membro'],
  ])('normaliza %j como %j (o mesmo de antes no MobileAuthService)', (raw, esperado) => {
    expect(normalizarTipoVinculo(raw as any)).toBe(esperado);
  });

  it('hierarquia: proprietario > inquilino > membro', () => {
    expect(nivelVinculo('proprietario')).toBeGreaterThan(nivelVinculo('inquilino'));
    expect(nivelVinculo('inquilino')).toBeGreaterThan(nivelVinculo('membro'));
  });

  it('vários vínculos: vale o mais alto (sem vínculo: nulo)', () => {
    expect(maiorVinculo(['membro', 'inquilino'])).toBe('inquilino');
    expect(maiorVinculo(['inquilino', null])).toBe('proprietario'); // nulo é legado = proprietário
    expect(maiorVinculo(['dependente'])).toBe('membro');
    expect(maiorVinculo([])).toBeNull();
  });
});
