// Minifica, só na saída do build, os scripts das páginas públicas que vão
// direto de public/ para o site (o Angular copia public/ sem tocar neles),
// e embute o paginas.css nas páginas de conteúdo (ver no fim do arquivo).
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

// CSS das páginas de conteúdo (/paginas.css, pequeno): embutido em <style> no
// lugar do <link>, para não bloquear a primeira pintura. O arquivo continua
// publicado, e o fonte em public/ segue com o <link>.
const LINK_CSS = '<link rel="stylesheet" href="/paginas.css">';
const PAGINAS = [
  '404.html',
  'precos/index.html',
  'quem-somos/index.html',
  'controle-de-visitantes-condominio/index.html',
  'livro-de-portaria-digital/index.html',
  'reconhecimento-facial-condominio/index.html',
  'aplicativo-para-condominio/index.html',
];
try {
  const fonteCss = readFileSync(join(SAIDA, 'paginas.css'), 'utf8');
  const { code } = await transform(fonteCss, { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8' });
  const css = code.trim();
  if (!css || /<\/style/i.test(css)) throw new Error('CSS minificado inválido');
  for (const rel of PAGINAS) {
    const caminho = join(SAIDA, rel);
    if (!existsSync(caminho)) {
      console.warn(`[minificar-landing] ${rel} não existe na saída; CSS não embutido.`);
      continue;
    }
    const html = readFileSync(caminho, 'utf8');
    if (!html.includes(LINK_CSS)) {
      console.warn(`[minificar-landing] ${rel} sem o link do paginas.css; ignorado.`);
      continue;
    }
    writeFileSync(caminho, html.replace(LINK_CSS, () => `<style>${css}</style>`));
    console.log(`[minificar-landing] paginas.css embutido em ${rel} (${css.length} bytes)`);
  }
} catch (e) {
  console.warn(`[minificar-landing] paginas.css mantido como arquivo externo: ${e && e.message}`);
}
