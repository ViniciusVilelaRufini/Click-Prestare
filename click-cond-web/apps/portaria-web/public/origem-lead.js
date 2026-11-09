// Origem do lead nas páginas de conteúdo (as que não são a /sobre, que tem a
// própria cópia inline). Guarda os parâmetros do anúncio na chegada e
// registra no CRM o clique direto no WhatsApp ou Instagram, uma vez por
// canal na sessão, igual à /sobre. Sem isso, quem chega por anúncio numa
// página dedicada e clica no WhatsApp não vira conversão.
(function () {
  var CHAVES = ['gclid', 'oppref', 'utm_source', 'utm_medium', 'utm_campaign', 'campaign_id', 'ad_group_id', 'ad_id'];
  try {
    var q = new URLSearchParams(location.search);
    var salvo = JSON.parse(sessionStorage.getItem('psOrigem') || '{}');
    CHAVES.forEach(function (k) { if (q.get(k)) salvo[k] = q.get(k); });
    sessionStorage.setItem('psOrigem', JSON.stringify(salvo));
  } catch (e) {}

  if (!window.psRegistrarLead) {
    window.psRegistrarLead = function (dados) {
      try {
        var origem = {};
        try { origem = JSON.parse(sessionStorage.getItem('psOrigem') || '{}'); } catch (e) {}
        var api = location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://api.prestarecondominios.com.br';
        fetch(api + '/api/public/leads', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, dados, origem, { pagina: (dados && dados.pagina) || location.pathname })),
        }).catch(function () {});
      } catch (e) {}
    };
  }

  if (window.psCliqueLeadAtivo) return;
  window.psCliqueLeadAtivo = true;
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href*="wa.me/"], a[href*="ig.me/m/"]') : null;
    if (!a) return;
    var canal = a.href.indexOf('ig.me/') >= 0 ? 'instagram' : 'whatsapp';
    try {
      if (sessionStorage.getItem('psClique_' + canal)) return;
      sessionStorage.setItem('psClique_' + canal, '1');
    } catch (e2) {}
    window.psRegistrarLead({ clique: canal });
  }, true);
})();
