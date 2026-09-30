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

    expect(html).toContain('<link rel="icon" href="/favicon.ico">');
    expect(tamanhosDoIco(favicon)).toEqual([16, 32, 48]);
  });
});
