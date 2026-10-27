/**
 * O que de apps/api/dist/assets pode ir para o pacote do Elastic Beanstalk.
 * A pasta é servida publicamente na raiz do site (main.ts) e, na máquina do
 * dev, já carregou a chave do Firebase (gitignored) — que entrava no zip.
 * Fica de fora qualquer .json, credencial, .env e chave/certificado.
 */
const BLOQUEADOS = [
  /\.json$/i,
  /service-account/i,
  /(^|[\/])\.env/i,
  /\.(pem|key|p12|pfx)$/i,
];

export function assetVaiNoPacote(caminhoRelativo) {
  return !BLOQUEADOS.some((re) => re.test(caminhoRelativo));
}
