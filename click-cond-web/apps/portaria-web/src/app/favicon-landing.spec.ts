import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const publicDir = join(process.cwd(), 'apps/portaria-web/public');

function tamanhosDoIco(arquivo: Buffer): number[] {
  const quantidade = arquivo.readUInt16LE(4);
  return Array.from({ length: quantidade }, (_, indice) => {
    const largura = arquivo[6 + indice * 16];
    return largura === 0 ? 256 : largura;
  });
}

describe('favicon da landing da Prestare', () => {
  it('referencia o favicon da marca com variantes para resultados do Google', () => {
    const html = readFileSync(join(publicDir, 'sobre/index.html'), 'utf8');
    const favicon = readFileSync(join(publicDir, 'favicon.ico'));

    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any">');
    expect(tamanhosDoIco(favicon)).toEqual([16, 32, 48]);
  });

  it('oferece PNGs em múltiplos de 48 px (exigência do Google) nas três páginas públicas', () => {
    const paginas = ['sobre/index.html', 'sindico/index.html', '../src/index.html'];
    for (const pagina of paginas) {
      const html = readFileSync(join(publicDir, pagina), 'utf8');
      for (const tamanho of [48, 96, 192]) {
        expect(html).toMatch(new RegExp(`sizes="${tamanho}x${tamanho}"[^>]*favicon-${tamanho}\.png`));
      }
      expect(html).toContain('apple-touch-icon.png');
    }
    for (const arquivo of ['favicon-48.png', 'favicon-96.png', 'favicon-192.png', 'apple-touch-icon.png']) {
      const png = readFileSync(join(publicDir, arquivo));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
    }
    const largura = (arquivo: string) => readFileSync(join(publicDir, arquivo)).readUInt32BE(16);
    expect([48, 96, 192].map((t) => largura(`favicon-${t}.png`))).toEqual([48, 96, 192]);
  });
});
