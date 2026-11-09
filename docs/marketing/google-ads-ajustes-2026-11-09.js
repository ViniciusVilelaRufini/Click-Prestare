/**
 * Prestare — ajustes de 09/11/2026 na campanha "Síndico | Pesquisa | SP".
 * 1) Lance por palavra nas buscas de mais intenção que estavam abaixo do
 *    CPC de 1ª página (sistema para síndico R$ 6,19; aplicativo para condomínio R$ 4,27).
 * 2) Anúncio novo no G4 Concorrentes com ângulo de comparação. Sem nome de
 *    concorrente no texto (marca de terceiros). O anúncio antigo fica ativo.
 * Idempotente: não recria o anúncio se já existir um com o 1º título igual.
 */
var CAMPANHA = 'Síndico | Pesquisa | SP';
var LANCES = { 'sistema para síndico': 6.5, 'aplicativo para condomínio': 4.5 };
var G4 = 'G4 Concorrentes';
var TITULOS = ['Compare Antes de Contratar', 'Preço Aberto no Site', 'Sem Orçamento Sob Consulta',
  'Simule o Preço em Segundos', 'A partir de R$ 298/mês', 'Outra Opção para o Síndico',
  'App para Síndico e Portaria', 'Toda Entrada Fica Registrada', 'Visitantes e Encomendas',
  'Reconhecimento Facial e PIN', 'Console Web e App iOS/Android', 'Atendemos Todo o Estado de SP',
  'Fale com Gente de Verdade', 'Prestare Controle de Acesso', 'Peça seu Orçamento'];
var DESCRICOES = [
  'Compare antes de contratar: o preço do seu condomínio aparece na hora, no próprio site.',
  'Cada entrada fica registrada com data, hora e quem autorizou. Consulte quando quiser.',
  'Visitantes, encomendas, ocorrências e reservas num só sistema, no app e no computador.',
  'Planos a partir de R$ 298/mês por faixa de unidades. Fale conosco pelo WhatsApp.'];

function main() {
  var it = AdsApp.keywords().withCondition("campaign.name = '" + CAMPANHA + "'")
    .withCondition("ad_group_criterion.status != 'REMOVED'").get();
  while (it.hasNext()) {
    var kw = it.next();
    var t = kw.getText().replace(/^[\["]|[\]"]$/g, '').toLowerCase();
    if (!LANCES[t]) continue;
    var antes = kw.bidding().getCpc();
    if (antes === LANCES[t]) { Logger.log(kw.getText() + ': já em R$ ' + antes); continue; }
    kw.bidding().setCpc(LANCES[t]);
    Logger.log(kw.getText() + ': lance R$ ' + antes + ' → R$ ' + LANCES[t]);
  }

  var g = AdsApp.adGroups().withCondition("campaign.name = '" + CAMPANHA + "'").withCondition("ad_group.name = '" + G4 + "'").get();
  if (!g.hasNext()) throw new Error('Grupo não encontrado: ' + G4);
  var ag = g.next();
  var ads = ag.ads().withCondition("ad_group_ad.status != 'REMOVED'").get();
  while (ads.hasNext()) {
    var a = ads.next();
    var h = a.asType().responsiveSearchAd().getHeadlines();
    if (h.length && h[0].text === TITULOS[0]) { Logger.log('Anúncio novo do G4: já existe (' + a.getId() + ')'); return; }
  }
  var op = ag.newAd().responsiveSearchAdBuilder()
    .withHeadlines(TITULOS.map(function (x) { return { text: x }; }))
    .withDescriptions(DESCRICOES.map(function (x) { return { text: x }; }))
    .withPath1('condominio').withPath2('compare')
    .withFinalUrl('https://www.prestarecondominios.com.br/sobre/')
    .build();
  Logger.log('Anúncio novo do G4: ' + (op.isSuccessful() ? 'criado' : 'FALHOU ' + op.getErrors().join('; ')));
}
