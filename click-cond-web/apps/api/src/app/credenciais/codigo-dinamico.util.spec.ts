import {
  conferirMac,
  contadorDe,
  decodificarCodigo,
  ehCodigoDinamico,
  gerarCodigo,
  INTERVALO_MS,
  normalizarLeitura,
  rotuloDeCredencial,
} from './codigo-dinamico.util';

const A = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const B = Buffer.from('ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100', 'hex');

describe('codigo-dinamico.util', () => {
  it.each([
    [1, 0, A, 'P1AAAAAAIAAAAABALZ4WDJKZ4FNI'],
    [1, 59000000, A, 'P1AAAAAAIDQRCMABTQCSPWDO5F3Q'],
    [1, 59000001, A, 'P1AAAAAAIDQRCMDS3DSX2WSX2IVM'],
    [4294967295, 59000000, A, 'P1777777YDQRCMBFJSPWOFKGKEXQ'],
    [123456, 59461234, B, 'P1AAA6EQADRNHHENRPXWQLO4XSOQ'],
  ])('gera o vetor id=%i contador=%i', (id, contador, segredo, esperado) => {
    expect(gerarCodigo('P1', id as number, contador as number, segredo as Buffer)).toBe(esperado);
  });

  it('decodifica e confere o que gerou', () => {
    const dec = decodificarCodigo('P1AAA6EQADRNHHENRPXWQLO4XSOQ')!;
    expect(dec).toMatchObject({ prefixo: 'P1', id: 123456, contador: 59461234 });
    expect(conferirMac(dec, B)).toBe(true);
    expect(conferirMac(dec, A)).toBe(false);
  });

  it('decodifica o id acima de 2^31 sem virar negativo', () => {
    const dec = decodificarCodigo('P1777777YDQRCMBFJSPWOFKGKEXQ')!;
    expect(dec.id).toBe(4294967295);
    expect(conferirMac(dec, A)).toBe(true);
  });

  it('aceita leitura suja de leitor (Review Focus 1)', () => {
    const sujo = '  p1aaaaaaidqrcmabtqcspwdo5f3q\r\n';
    expect(normalizarLeitura(sujo)).toBe('P1AAAAAAIDQRCMABTQCSPWDO5F3Q');
    expect(ehCodigoDinamico(sujo)).toBe(true);
    expect(decodificarCodigo(sujo)).toMatchObject({ id: 1, contador: 59000000 });
    expect(conferirMac(decodificarCodigo(sujo)!, A)).toBe(true);
    expect(ehCodigoDinamico('P1AAAA AAIDQRCMAB\nTQCSPWDO5F3Q')).toBe(true);
  });

  it('não confunde PIN nem tag com código dinâmico', () => {
    for (const v of ['123456', 'QR_MORADOR_99827', 'P1', 'P1AAAAAAIDQRCMABTQCSPWDO5F3', 'P3AAAAAAIDQRCMABTQCSPWDO5F3Q', '', null, undefined]) {
      expect(ehCodigoDinamico(v as any)).toBe(false);
    }
    expect(decodificarCodigo('P1AAAAAAIDQRCMABTQCSPWDO5F31')).toBeNull(); // '1' fora do alfabeto
  });

  it('MAC adulterado não confere', () => {
    const dec = decodificarCodigo('P1AAAAAAIDQRCMABTQCSPWDO5F3Q')!;
    const outro = { ...dec, contador: dec.contador + 1 };
    expect(conferirMac(outro, A)).toBe(false);
    expect(conferirMac({ ...dec, mac: Buffer.alloc(4) }, A)).toBe(false);
  });

  it('contador e rótulo', () => {
    expect(INTERVALO_MS).toBe(30_000);
    expect(contadorDe(new Date(1794614400 * 1000))).toBe(59820480);
    expect(rotuloDeCredencial('P1AAA6EQADRNHHENRPXWQLO4XSOQ')).toBe('cred:123456');
    expect(rotuloDeCredencial('P1!!!')).toBe('cred:?');
    expect(rotuloDeCredencial('p2xyz')).toBe('cred:?');
    expect(rotuloDeCredencial('123456')).toBe('123456');
  });
});
