import { validarPlaca } from './placa.util';

/** O console aceitava placa "X1" — qualquer texto virava veículo. */
describe('validarPlaca', () => {
  it.each(['ABC1234', 'abc-1234', 'ABC1D23', 'abc1d23', ' ABC 1D23 '])('aceita %s', (p) => {
    expect(validarPlaca(p)).toBe(p.replace(/[^a-z0-9]/gi, '').toUpperCase());
  });

  it.each(['X1', 'ABC123', 'AB12345', 'ABCD123', '', null])('recusa %s', (p) => {
    expect(() => validarPlaca(p as any)).toThrow('Placa inválida');
  });
});
