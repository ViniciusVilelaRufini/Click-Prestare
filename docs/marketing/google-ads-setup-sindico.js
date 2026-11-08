/**
 * Prestare — monta a campanha "Síndico | Pesquisa | SP" a partir de
 * docs/marketing/anuncios-sindico-sp.md (fonte única do texto).
 * Rodar uma vez em Google Ads → Ferramentas → Ações em massa → Scripts:
 * primeiro "Visualizar" (não altera nada), depois "Executar".
 * É idempotente: o que já existe (grupo, palavra, negativa, anúncio, horário)
 * não é recriado. Não ativa nada — a campanha continua no status em que está.
 */
var CAMPANHA = 'Síndico | Pesquisa | SP';
var URL_FINAL = 'https://www.prestarecondominios.com.br/sobre/';
var ORCAMENTO_DIA = 15; // ajustado pelo usuário em 07/11/2026
var CAMINHOS = ['condominio', 'orcamento'];

var NEGATIVAS = [
  'prestare', 'emprego', 'vaga', 'vagas', 'salário', 'curso', 'apostila', 'concurso',
  'grátis', 'gratuito', 'download', 'pdf', 'modelo', 'login', 'entrar', '2 via', 'boleto',
  'como ser síndico', 'o que é', 'academia', 'fechadura', 'catraca usada', 'mercado livre',
  'olx', 'reclame aqui', 'portaria remota', 'portaria virtual',
  // Aprendido com a campanha antiga (termos de pesquisa set–nov/2026):
  'villagua', 'synnus', 'lello', 'administradora', 'administradoras', 'site condominios',
  'atende portaria', 'como funciona', 'como montar',
];

var DESCRICOES_COMUNS = {
  registro: 'Cada entrada fica registrada com data, hora e quem autorizou. Consulte quando quiser.',
  sistema: 'Visitantes, encomendas e ocorrências num só sistema, no app e no computador.',
  preco: 'Planos a partir de R$ 298/mês. Simule o preço e fale conosco pelo WhatsApp.',
};

var GRUPOS = [
  {
    nome: 'G1 Registro / portaria digital',
    nomeAntigo: 'Grupo de anúncios 1',
    cpc: 4.0,
    palavras: ['controle de visitantes condomínio', 'registro de visitantes condomínio', 'livro de portaria digital',
      'sistema de portaria condomínio', 'software de portaria', 'app de portaria'],
    titulos: ['Sistema de Portaria Digital', 'Controle de Visitantes', 'Livro de Portaria Digital',
      'Toda Entrada Fica Registrada', 'Histórico de Quem Entrou', 'Registro com Data e Hora',
      'Saiba Quem Autorizou Cada Um', 'Seu Condomínio no Controle', 'App para Síndico e Portaria',
      'Visitantes e Encomendas', 'A partir de R$ 298/mês', 'Simule o Preço Online', 'Peça seu Orçamento',
      'Atendemos Todo o Estado de SP', 'Prestare Controle de Acesso'],
    descricoes: [DESCRICOES_COMUNS.registro, DESCRICOES_COMUNS.sistema,
      'A portaria trabalha mais rápido e o síndico acompanha tudo de onde estiver.', DESCRICOES_COMUNS.preco],
  },
  {
    nome: 'G2 Controle de acesso',
    cpc: 3.5,
    palavras: ['controle de acesso condomínio', 'sistema de controle de acesso para condomínio',
      'reconhecimento facial condomínio', 'acesso facial condomínio'],
    titulos: ['Controle de Acesso Condomínio', 'Reconhecimento Facial', 'Acesso Facial no Condomínio',
      'Toda Entrada Fica Registrada', 'Histórico de Quem Entrou', 'Seu Condomínio no Controle',
      'Mais Segurança na Portaria', 'Portaria Mais Ágil e Segura', 'App para Síndico e Moradores',
      'Visitantes e Encomendas', 'A partir de R$ 298/mês', 'Simule o Preço Online', 'Peça seu Orçamento',
      'Atendemos Todo o Estado de SP', 'Prestare Controle de Acesso'],
    descricoes: ['Reconhecimento facial e registro de cada entrada com data, hora e quem autorizou.',
      'O condomínio faz o próprio controle de acesso, com o histórico sempre à mão.',
      DESCRICOES_COMUNS.sistema, DESCRICOES_COMUNS.preco],
  },
  {
    nome: 'G3 Gestão / app',
    cpc: 3.5,
    palavras: ['aplicativo para condomínio', 'app para síndico', 'sistema para síndico'],
    titulos: ['Aplicativo para Condomínio', 'App para Síndico', 'Sistema para Síndico',
      'Tudo do Condomínio no App', 'Toda Entrada Fica Registrada', 'Visitantes e Encomendas',
      'Ocorrências e Comunicados', 'Seu Condomínio no Controle', 'Acompanhe de Onde Estiver',
      'Console Web e App iOS/Android', 'A partir de R$ 298/mês', 'Simule o Preço Online', 'Peça seu Orçamento',
      'Atendemos Todo o Estado de SP', 'Prestare Controle de Acesso'],
    descricoes: ['O síndico acompanha visitantes, encomendas e ocorrências pelo app e pelo computador.',
      DESCRICOES_COMUNS.registro,
      'Menos mensagens e ligações para resolver o básico do dia a dia do condomínio.', DESCRICOES_COMUNS.preco],
  },
  {
    // Teste: o único lead da campanha antiga veio de "aplicativo vida de síndico".
    // Marca de concorrente só como palavra-chave; o texto do anúncio não cita concorrente.
    nome: 'G4 Concorrentes',
    cpc: 3.0,
    palavras: ['vida de síndico', 'gruvi', 'almah condos', 'winker'],
    titulos: ['Aplicativo para Condomínio', 'Conheça a Prestare', 'Controle de Acesso Condomínio',
      'Toda Entrada Fica Registrada', 'Histórico de Quem Entrou', 'Visitantes e Encomendas',
      'App para Síndico e Portaria', 'Seu Condomínio no Controle', 'Compare Antes de Contratar',
      'Console Web e App iOS/Android', 'A partir de R$ 298/mês', 'Simule o Preço Online', 'Peça seu Orçamento',
      'Atendemos Todo o Estado de SP', 'Prestare Controle de Acesso'],
    descricoes: [DESCRICOES_COMUNS.registro, DESCRICOES_COMUNS.sistema,
      'Compare antes de contratar: simule o preço do seu condomínio em poucos segundos.', DESCRICOES_COMUNS.preco],
  },
];

var SITELINKS = [
  { texto: 'Simule o preço', l1: 'Calcule pelo nº de unidades', l2: 'Planos a partir de R$ 298/mês', url: URL_FINAL + '#simulador' },
  { texto: 'Segurança e registro', l1: 'Toda entrada fica registrada', l2: 'Facial, PIN e histórico', url: URL_FINAL + '#seguranca' },
  { texto: 'App do condomínio', l1: 'Portaria, síndico e moradores', l2: 'App para iOS e Android', url: URL_FINAL + '#portaria-app' },
  { texto: 'Fale conosco', l1: 'Atendimento pelo WhatsApp', l2: 'Orçamento para seu condomínio', url: URL_FINAL + '#contato' },
];
var DESTAQUES = ['App iOS e Android', 'Console web', 'Atende todo o estado SP', 'Histórico de acessos', 'Reconhecimento facial'];

function main() {
  var it = AdsApp.campaigns().withCondition("campaign.name = '" + CAMPANHA + "'").get();
  if (!it.hasNext()) throw new Error('Campanha não encontrada: ' + CAMPANHA);
  var c = it.next();
  Logger.log('Campanha: ' + c.getName() + ' (status ' + (c.isEnabled() ? 'ATIVA' : 'pausada') + ')');

  c.getBudget().setAmount(ORCAMENTO_DIA);
  Logger.log('Orçamento: R$ ' + ORCAMENTO_DIA + '/dia');
  c.bidding().setStrategy('MANUAL_CPC');
  Logger.log('Lance: CPC manual');

  programarHorario(c);
  negativas(c);
  GRUPOS.forEach(function (g) { montarGrupo(c, g); });
  extensoes(c);
}

function programarHorario(c) {
  if (c.targeting().adSchedules().get().totalNumEntities() > 0) {
    Logger.log('Horário: já existe, mantido');
    return;
  }
  ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].forEach(function (d) {
    c.addAdSchedule({ dayOfWeek: d, startHour: 7, startMinute: 0, endHour: 21, endMinute: 0, bidModifier: 1 });
  });
  c.addAdSchedule({ dayOfWeek: 'SATURDAY', startHour: 8, startMinute: 0, endHour: 14, endMinute: 0, bidModifier: 1 });
  Logger.log('Horário: seg–sex 07–21h, sáb 08–14h');
}

// Chave estável: o Google pode devolver o texto sem aspas/colchetes; o tipo vem de getMatchType().
function chave(texto, tipo) {
  return texto.replace(/^[\["+]+|[\]"]+$/g, '').trim().toLowerCase() + '|' + tipo;
}
function tipoDoTexto(t) {
  return t.charAt(0) === '[' ? 'EXACT' : t.charAt(0) === '"' ? 'PHRASE' : 'BROAD';
}

function negativas(c) {
  var existentes = {};
  var it = c.negativeKeywords().get();
  while (it.hasNext()) { var nk = it.next(); existentes[chave(nk.getText(), nk.getMatchType())] = true; }
  var n = 0;
  NEGATIVAS.forEach(function (p) {
    var t = '"' + p + '"';
    if (!existentes[chave(t, 'PHRASE')]) { c.createNegativeKeyword(t); n++; }
  });
  Logger.log('Negativas novas: ' + n + ' (total desejado ' + NEGATIVAS.length + ')');
}

function grupoPorNome(c, nome) {
  var it = c.adGroups().withCondition("ad_group.name = '" + nome.replace(/'/g, "\\'") + "'").get();
  return it.hasNext() ? it.next() : null;
}

function montarGrupo(c, g) {
  var ag = grupoPorNome(c, g.nome);
  if (!ag && g.nomeAntigo) {
    ag = grupoPorNome(c, g.nomeAntigo);
    if (ag) { ag.setName(g.nome); Logger.log('Grupo renomeado: ' + g.nomeAntigo + ' → ' + g.nome); }
  }
  if (!ag) {
    var op = c.newAdGroupBuilder().withName(g.nome).withCpc(g.cpc).build();
    if (!op.isSuccessful()) throw new Error('Grupo ' + g.nome + ': ' + op.getErrors().join('; '));
    ag = op.getResult();
    Logger.log('Grupo criado: ' + g.nome);
  }
  ag.bidding().setCpc(g.cpc);

  var existentes = {};
  var kit = ag.keywords().get();
  while (kit.hasNext()) { var kw = kit.next(); existentes[chave(kw.getText(), kw.getMatchType())] = true; }
  var novas = 0;
  g.palavras.forEach(function (p) {
    ['"' + p + '"', '[' + p + ']'].forEach(function (t) {
      if (existentes[chave(t, tipoDoTexto(t))]) return;
      var op = ag.newKeywordBuilder().withText(t).build();
      if (!op.isSuccessful()) Logger.log('  palavra ' + t + ' falhou: ' + op.getErrors().join('; '));
      else novas++;
    });
  });
  Logger.log('  ' + g.nome + ': CPC R$ ' + g.cpc + ', palavras novas ' + novas);

  var temRsa = ag.ads().withCondition("ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'").withCondition("ad_group_ad.status != 'REMOVED'").get().hasNext();
  if (temRsa) { Logger.log('  anúncio responsivo: já existe, mantido'); return; }
  var op = ag.newAd().responsiveSearchAdBuilder()
    .withHeadlines(g.titulos.map(function (t) { return { text: t }; }))
    .withDescriptions(g.descricoes.map(function (t) { return { text: t }; }))
    .withPath1(CAMINHOS[0]).withPath2(CAMINHOS[1])
    .withFinalUrl(URL_FINAL)
    .build();
  Logger.log('  anúncio responsivo: ' + (op.isSuccessful() ? 'criado' : 'FALHOU ' + op.getErrors().join('; ')));
}

function extensoes(c) {
  try {
    var jaTem = c.extensions().sitelinks().get().totalNumEntities();
    if (jaTem > 0) { Logger.log('Sitelinks: já existem (' + jaTem + '), mantidos'); }
    else {
      SITELINKS.forEach(function (s) {
        var op = AdsApp.extensions().newSitelinkBuilder()
          .withLinkText(s.texto).withDescription1(s.l1).withDescription2(s.l2).withFinalUrl(s.url).build();
        if (op.isSuccessful()) c.addSitelink(op.getResult());
        else Logger.log('Sitelink ' + s.texto + ' falhou: ' + op.getErrors().join('; '));
      });
      Logger.log('Sitelinks: ' + SITELINKS.length + ' adicionados');
    }
  } catch (e) { Logger.log('Sitelinks: não suportado pelo Script (' + e + ') — fazer pela interface'); }
  try {
    var jaTemC = c.extensions().callouts().get().totalNumEntities();
    if (jaTemC > 0) { Logger.log('Frases de destaque: já existem, mantidas'); return; }
    DESTAQUES.forEach(function (t) {
      var op = AdsApp.extensions().newCalloutBuilder().withText(t).build();
      if (op.isSuccessful()) c.addCallout(op.getResult());
    });
    Logger.log('Frases de destaque: ' + DESTAQUES.length + ' adicionadas');
  } catch (e) { Logger.log('Frases de destaque: não suportado (' + e + ') — fazer pela interface'); }
}
