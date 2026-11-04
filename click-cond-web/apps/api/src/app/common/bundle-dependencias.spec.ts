import { builtinModules } from 'module';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * O pacote do Elastic Beanstalk é montado por scripts/migration/bundle-eb.mjs
 * com uma lista FIXA de dependências — não lê o package.json do projeto.
 * Pacote importado pela API e ausente dessa lista passa no CI e derruba a API
 * no boot em produção ("Cannot find module").
 */
const RAIZ_API = join(__dirname, '..', '..');
const BUNDLE = join(__dirname, '..', '..', '..', '..', '..', 'scripts', 'migration', 'bundle-eb.mjs');

/** Chegam por dependência de outro pacote da lista. */
const TRANSITIVOS = new Set(['express']); // via @nestjs/platform-express

function importsDaApi(dir: string, acc = new Set<string>()): Set<string> {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      if (nome !== 'generated') importsDaApi(caminho, acc);
      continue;
    }
    if (!caminho.endsWith('.ts') || caminho.endsWith('.spec.ts')) continue;
    const src = readFileSync(caminho, 'utf8');
    for (const m of src.matchAll(/(?:^import\s+(?!type\b)[^'"]*from\s+|import\(|require\()\s*['"]([^'"./][^'"]*)['"]/gm)) {
      const espec = m[1];
      if (espec.startsWith('node:')) continue;
      const pacote = espec.startsWith('@') ? espec.split('/').slice(0, 2).join('/') : espec.split('/')[0];
      if (!builtinModules.includes(pacote)) acc.add(pacote);
    }
  }
  return acc;
}

describe('bundle do Elastic Beanstalk', () => {
  it('lista toda dependência que a API importa', () => {
    const src = readFileSync(BUNDLE, 'utf8');
    const bloco = src.slice(src.indexOf('dependencies: {'));
    const lista = new Set([...bloco.slice(0, bloco.indexOf('}')).matchAll(/"([^"]+)":/g)].map((m) => m[1]));

    const faltando = [...importsDaApi(RAIZ_API)].filter((p) => !lista.has(p) && !TRANSITIVOS.has(p)).sort();
    expect(faltando).toEqual([]);
  });
});
