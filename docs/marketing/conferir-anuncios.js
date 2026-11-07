// Confere limites de caracteres do docs/marketing/anuncios-sindico-sp.md.
// Uso: node docs/marketing/conferir-anuncios.js  → sai com código 1 se algo passar do limite.
const fs = require('fs');
const path = require('path');

const md = fs.readFileSync(path.join(__dirname, 'anuncios-sindico-sp.md'), 'utf8');
const erros = [];
const proibidos = /gr[aá]tis|isent|sem fidelidade|teste gr|demit|substitu|portaria (remota|virtual)/i;

function blocos(tag) {
  const re = new RegExp(`<!-- ${tag}[^>]*-->([\\s\\S]*?)<!-- /${tag.split(' ')[0]} -->`, 'g');
  return [...md.matchAll(re)].map((m) => m[1]);
}
function itens(bloco) {
  return bloco.split('\n').map((l) => l.replace(/^\s*(\d+\.|-)\s*/, '').trim()).filter(Boolean);
}
function conferir(rotulo, textos, max, qtd) {
  if (qtd && textos.length !== qtd) erros.push(`${rotulo}: ${textos.length} itens (esperado ${qtd})`);
  for (const t of textos) {
    if ([...t].length > max) erros.push(`${rotulo}: "${t}" tem ${[...t].length} (máx ${max})`);
    if (proibidos.test(t)) erros.push(`${rotulo}: "${t}" usa termo proibido`);
  }
}

const titulos = blocos('titulos');
const descricoes = blocos('descricoes');
if (titulos.length !== 3 || descricoes.length !== 3) erros.push('esperados 3 grupos de anúncio');
titulos.forEach((b, i) => conferir(`títulos G${i + 1}`, itens(b), 30, 15));
descricoes.forEach((b, i) => conferir(`descrições G${i + 1}`, itens(b), 90, 4));
blocos('destaques').forEach((b) => conferir('destaques', itens(b), 25));
blocos('sitelinks').forEach((b) => {
  const linhas = b.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('|---') && !l.includes('Título'));
  if (linhas.length < 4) erros.push('sitelinks: menos de 4');
  for (const l of linhas) {
    const [titulo, l1, l2] = l.split('|').slice(1).map((c) => c.trim());
    conferir('sitelink título', [titulo], 25);
    conferir('sitelink linha', [l1, l2], 35);
  }
});
conferir('caminho', ['condominio', 'orcamento'], 15);

if (erros.length) {
  console.error(erros.join('\n'));
  process.exit(1);
}
console.log('anúncios ok');
