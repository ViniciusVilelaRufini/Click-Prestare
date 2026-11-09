/**
 * Prestare — destino por palavra-chave na campanha "Síndico | Pesquisa | SP".
 * Cada busca específica cai na página que trata dela; o resto segue na /sobre/
 * (URL final dos anúncios). A URL da palavra tem prioridade sobre a do anúncio.
 * As páginas dedicadas guardam o gclid (origem-lead.js) e registram o clique
 * no WhatsApp, então a conversão offline continua funcionando.
 *
 * Rodar em Google Ads → Ferramentas → Ações em massa → Scripts:
 * "Visualizar" primeiro (não altera nada), depois "Executar". É idempotente.
 * Para desfazer: troque DESTINOS por {} e REMOVER_OUTRAS = true.
 */
var CAMPANHA = 'Síndico | Pesquisa | SP';
var BASE = 'https://www.prestarecondominios.com.br';
var DESTINOS = {
  'controle de visitantes condomínio': '/controle-de-visitantes-condominio/',
  'registro de visitantes condomínio': '/controle-de-visitantes-condominio/',
  'livro de portaria digital': '/livro-de-portaria-digital/',
  'reconhecimento facial condomínio': '/reconhecimento-facial-condominio/',
  'acesso facial condomínio': '/reconhecimento-facial-condominio/',
};
// true: palavras fora da lista perdem a URL própria e voltam para a do anúncio (/sobre/).
var REMOVER_OUTRAS = true;

function main() {
  var it = AdsApp.keywords()
    .withCondition("campaign.name = '" + CAMPANHA + "'")
    .withCondition("ad_group_criterion.status != 'REMOVED'")
    .get();
  var mudou = 0, igual = 0;
  while (it.hasNext()) {
    var kw = it.next();
    var texto = kw.getText().replace(/^[\["]|[\]"]$/g, '').toLowerCase();
    var alvo = DESTINOS[texto] ? BASE + DESTINOS[texto] : null;
    var atual = kw.urls().getFinalUrl() || null;
    if (alvo === atual || (!alvo && !REMOVER_OUTRAS)) { igual++; continue; }
    if (alvo) kw.urls().setFinalUrl(alvo); else kw.urls().clearFinalUrl();
    mudou++;
    Logger.log(kw.getAdGroup().getName() + ' | ' + kw.getText() + ': ' + (atual || '(anúncio)') + ' → ' + (alvo || '(anúncio: /sobre/)'));
  }
  Logger.log('Alteradas: ' + mudou + ', já certas: ' + igual);
}
