import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A lógica da /sobre roda por new Function no navegador. Um erro de sintaxe ali
// não quebra o build: a página carrega com as áreas dinâmicas vazias.
describe('lógica da landing /sobre', () => {
  it('compila sem erro de sintaxe', () => {
    const html = readFileSync(join(process.cwd(), 'apps/portaria-web/public/sobre/index.html'), 'utf8');
    const logica = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(logica).toBeTruthy();
    expect(() => new Function('DCLogic', 'StreamableLogic', 'React', logica as string)).not.toThrow();
  });
});
