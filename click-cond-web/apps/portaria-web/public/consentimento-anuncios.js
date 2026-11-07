// Tags de anúncio (Google Ads e OpenAI) só com o consentimento de marketing.
// A escolha é gravada pelo aviso de cookies da /sobre e da /sindico.
(function () {
  var CHAVE = 'prestare-click:consentimento';
  var carregado = false;

  function temMarketing() {
    try {
      var c = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      return !!(c && c.marketing);
    } catch (e) {
      return false;
    }
  }

  function carregar() {
    carregado = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', 'AW-18476913499');
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=AW-18476913499';
    document.head.appendChild(g);

    !function (w, d, s, u) {
      if (w.oaiq) return;
      var q = function () { q.q.push(arguments); };
      q.q = [];
      w.oaiq = q;
      var j = d.createElement(s);
      j.async = 1;
      j.src = u;
      d.head.appendChild(j);
    }(window, document, 'script', 'https://bzrcdn.openai.com/sdk/oaiq.min.js');
    window.oaiq('init', { pixelId: '17H2XPR4dY5HHBNUs9L5ha' });
  }

  // Tag já em execução não se descarrega: ao retirar o consentimento, apaga os
  // cookies dela e recarrega a página, que volta sem as tags.
  function retirar() {
    document.cookie.split(';').forEach(function (c) {
      var nome = c.split('=')[0].trim();
      if (/^(_gcl|_ga|_gid|_oai)/.test(nome)) {
        document.cookie = nome + '=; Max-Age=0; path=/';
        document.cookie = nome + '=; Max-Age=0; path=/; domain=.' + location.hostname.replace(/^www\./, '');
      }
    });
    location.reload();
  }

  window.psAplicarConsentimento = function () {
    if (temMarketing()) {
      if (!carregado) carregar();
    } else if (carregado) {
      retirar();
    }
  };
  window.psAplicarConsentimento();
})();
