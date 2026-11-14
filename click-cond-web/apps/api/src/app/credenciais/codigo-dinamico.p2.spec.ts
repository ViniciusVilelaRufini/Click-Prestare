/**
 * Código diário P2 (passe da carteira): mesma montagem do P1, contador =
 * dias desde 01/01/1970 no fuso de Brasília. Vetores fixos do plano.
 */
import { conferirMac, decodificarCodigo, diaBrasiliaDe, gerarCodigo } from './codigo-dinamico.util';

const A = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const B = Buffer.from('ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100', 'hex');

describe('código P2', () => {
  it.each([
    [1, 0, A, 'P2AAAAAAIAAAAABE626COYMR6BFQ'],
    [1, 20771, A, 'P2AAAAAAIAABISHDX2Z4VLLSGTIQ'],
    [1, 20772, A, 'P2AAAAAAIAABISJQUPSUBO6ZWPJY'],
    [4294967295, 20771, A, 'P2777777YAABISGBGZGOT5ZD67E4'],
    [123456, 20800, B, 'P2AAA6EQAAABIUACOWLYZSIM4LWE'],
  ])('gera o vetor P2 id=%i dia=%i', (id, dia, segredo, esperado) => {
    expect(gerarCodigo('P2', id, dia, segredo)).toBe(esperado);
  });

  it('decodifica o vetor e o MAC confere com o segredo certo', () => {
    const dec = decodificarCodigo('P2AAA6EQAAABIUACOWLYZSIM4LWE')!;
    expect(dec).toMatchObject({ prefixo: 'P2', id: 123456, contador: 20800 });
    expect(conferirMac(dec, B)).toBe(true);
    expect(conferirMac(dec, A)).toBe(false);
  });

  it('um P2 não confere como P1 com o mesmo segredo', () => {
    const dec = decodificarCodigo('P2AAAAAAIAABISHDX2Z4VLLSGTIQ')!;
    expect(dec.prefixo).toBe('P2');
    expect(conferirMac({ ...dec, prefixo: 'P1' }, A)).toBe(false);
  });

  it('dia de Brasília vira às 03:00 UTC', () => {
    expect(diaBrasiliaDe(new Date('2026-11-14T02:59:59Z'))).toBe(20770);
    expect(diaBrasiliaDe(new Date('2026-11-14T03:00:00Z'))).toBe(20771);
    expect(diaBrasiliaDe(new Date('2026-11-15T02:59:59Z'))).toBe(20771);
    expect(diaBrasiliaDe(new Date('2026-11-15T03:00:00Z'))).toBe(20772);
  });
});
