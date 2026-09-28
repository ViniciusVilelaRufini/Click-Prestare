import { normalizarIdApartamento } from './prestadores.service';

/**
 * Funcionário do condomínio (porteiro, zelador) não tem unidade: fica com
 * `id_apartamento` nulo e aparece para todos os moradores. O console manda 0
 * quando nenhuma unidade é escolhida — gravar 0 quebraria a FK.
 */
describe('normalizarIdApartamento', () => {
  it.each([
    [0, null],
    ['0', null],
    ['', null],
    [null, null],
  ])('%p vira null (do condomínio)', (entrada, esperado) => {
    expect(normalizarIdApartamento(entrada as any)).toBe(esperado);
  });

  it('mantém o id válido', () => {
    expect(normalizarIdApartamento(40)).toBe(40);
    expect(normalizarIdApartamento('40' as any)).toBe(40);
  });

  it('ausente continua ausente (update não mexe na unidade)', () => {
    expect(normalizarIdApartamento(undefined)).toBeUndefined();
  });
});
