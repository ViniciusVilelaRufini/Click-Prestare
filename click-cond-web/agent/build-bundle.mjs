/**
 * Empacota o Agente Local (agent/src/index.js) num único arquivo CommonJS,
 * sem dependências externas — é o que o Node SEA e o `npm start` rodam.
 *
 * Resolve o esbuild do node_modules do monorepo (click-cond-web), já que o
 * agente em si não tem node_modules próprio (não usa deps em runtime).
 *
 * Uso:  node build-bundle.mjs   (ou: import { bundle } from './build-bundle.mjs')
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname aqui é agent/; o monorepo (com node_modules/esbuild) é um nível acima.
const require = createRequire(join(dirname(__dirname), 'package.json'));

const ENTRY = join(__dirname, 'src', 'index.js');
const OUTFILE = join(__dirname, 'dist', 'click-agent.cjs');

export function bundle() {
  const { buildSync } = require('esbuild');
  buildSync({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    legalComments: 'none',
  });
  return OUTFILE;
}

// Permite rodar direto: `node build-bundle.mjs`. Usa pathToFileURL (em vez de
// montar a string "file://" na mão) porque no Windows o caminho de
// process.argv[1] usa barra invertida e precisa ser normalizado.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = bundle();
  console.log(`Bundle gerado: ${out}`);
}
