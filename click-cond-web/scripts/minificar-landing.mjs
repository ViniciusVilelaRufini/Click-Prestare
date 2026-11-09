// Minifica, só na saída do build, os scripts das páginas públicas que vão
// direto de public/ para o site (o Angular copia public/ sem tocar neles).
// O fonte em public/ continua legível: os testes leem trechos dele pelo texto.
// Se algo falhar, o arquivo original fica como está e o build segue.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// esbuild vem com o @angular/build; import dinâmico para nunca derrubar o build.
let transform;
try {
  ({ transform } = await import('esbuild'));
} catch (e) {
  console.warn('[minificar-landing] esbuild indisponível; scripts publicados sem minificar.');
  process.exit(0);
}

const SAIDA = 'dist/apps/portaria-web/browser';
const ARQUIVOS = ['sobre/pagina.js', 'consentimento-anuncios.js'];

for (const rel of ARQUIVOS) {
  const caminho = join(SAIDA, rel);
  if (!existsSync(caminho)) {
    console.warn(`[minificar-landing] ${rel} não existe na saída; ignorado.`);
    continue;
  }
  try {
    const fonte = readFileSync(caminho, 'utf8');
    const { code } = await transform(fonte, { loader: 'js', minify: true, legalComments: 'none', charset: 'utf8' });
    // Sanidade: o resultado precisa ser JS válido e menor que o original.
    new Function(code);
    if (code.length >= fonte.length) throw new Error('resultado não ficou menor');
    writeFileSync(caminho, code);
    console.log(`[minificar-landing] ${rel}: ${fonte.length} -> ${code.length} bytes`);
  } catch (e) {
    console.warn(`[minificar-landing] ${rel} mantido sem minificar: ${e && e.message}`);
  }
}
