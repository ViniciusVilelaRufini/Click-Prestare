/* Lógica da /sobre/: simulador, formulários, consentimento de cookies, tema,
   menu, carrossel e ampliação das telas. Sem React e sem compilação: o HTML
   já chega pronto e este arquivo só cuida do que muda com a interação.
   Os handlers ficam com dois espaços de recuo dentro da classe: os testes
   (landing-pedido-orcamento.spec.ts) extraem alguns deles pelo texto. */
(function (raiz) {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

class Pagina {
  // Valores que o editor antigo passava como propriedades.
  props = { whatsapp: "5517996608148", mostrarNumeros: true, mostrarFaq: true };

  setState(parcial) {
    Object.assign(this.state, parcial);
    if (this._agendar) this._agendar();
  }

  state = {
    enviado: false, tela: null,
    // O banner comeca fechado e so abre no componentDidMount, depois de ler o
    // localStorage: abrir antes provocaria um pisca em quem ja decidiu.
    consoleIndice: 0, menuAberto: false,
    cookieBanner: false, cookiePainel: false,
    cookieAnalytics: false, cookieMarketing: false,
    emailPainel: false, emailCopiado: false,
    simUnidades: 60, simEnviado: false, barraOculta: false
  };

  // Ordem do carrossel do console. As legendas e os textos moram no TELAS,
  // para o carrossel e o modal nunca divergirem.
  CONSOLE_TELAS = ["web-visitantes", "web-dashboard", "web-ocorrencias", "web-relatorios"];

  alternarMenu = () => this.setState({ menuAberto: !this.state.menuAberto });
  fecharMenu = () => this.setState({ menuAberto: false });
  // O painel fica dentro do fundo clicavel; sem isto, clicar no proprio menu
  // fecharia o menu.
  pararClique = (e) => { if (e && e.stopPropagation) e.stopPropagation(); };

  INTERVALO_CONSOLE = 6000;

  navegarConsole = (passo) => () => {
    const n = this.CONSOLE_TELAS.length;
    // +n antes do resto para o -1 no primeiro slide dar a volta em vez de -1.
    this.setState({ consoleIndice: (this.state.consoleIndice + passo + n) % n });
    // Reinicia a contagem: girar sozinho logo apos um clique manual passaria
    // a impressao de que o proprio clique pulou duas telas.
    this.iniciarRotacao();
  };

  irConsole = (i) => () => {
    this.setState({ consoleIndice: i });
    this.iniciarRotacao();
  };

  iniciarRotacao = () => {
    this.pararRotacao();
    // Quem pediu menos animacao no sistema nao recebe carrossel girando.
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch (_) { /* sem matchMedia: segue girando */ }
    this._rotacao = window.setInterval(() => {
      // Com o modal aberto a tela de fundo mudaria sozinha por tras dele.
      if (this.state.tela) return;
      const n = this.CONSOLE_TELAS.length;
      this.setState({ consoleIndice: (this.state.consoleIndice + 1) % n });
    }, this.INTERVALO_CONSOLE);
  };

  pararRotacao = () => {
    if (this._rotacao) {
      window.clearInterval(this._rotacao);
      this._rotacao = null;
    }
  };

  CHAVE_COOKIES = "prestare-click:consentimento";
  EMAIL = "suporte@clickprestarecondominios.com.br";
  ASSUNTO = "Orçamento do Prestare Gestão";

  TELAS = {
    "app-home": {
      src: "/sobre/assets/TelaInicio-dark.webp", srcClaro: "/sobre/assets/TelaInicio-light.webp", tipo: "App do morador", retrato: true, titulo: "Início",
      texto: "A primeira tela do morador: saudação, resumo do dia com visitas agendadas e encomendas aguardando retirada, e a lista dos condomínios em que ele tem unidade, cada um com o que está acontecendo lá agora. Abaixo, os eventos recentes de entrada e saída da própria unidade.",
      itens: ["Resumo geral do dia", "Situação de cada condomínio à vista", "Eventos recentes da unidade"]
    },
    "app-ia": {
      src: "/sobre/assets/app-ia.webp", tipo: "App do morador", retrato: true, titulo: "Prestare IA",
      texto: "O assistente dentro do app. O morador pergunta em português e recebe a resposta com os dados do próprio condomínio. Quando o assistente propõe uma ação, ela só é feita depois da confirmação do morador. As respostas podem conter erros.",
      itens: ["Perguntas sobre visitas, assembleias e portaria", "Ações só com a confirmação do morador", "Sugestões prontas para começar"]
    },
    "app-visitantes": {
      src: "/sobre/assets/TelaVisitantes-dark.webp", srcClaro: "/sobre/assets/TelaVisitantes-light.webp", tipo: "App do morador", retrato: true, titulo: "Visitantes e prestadores",
      texto: "O morador cadastra quem vai visitar antes de a pessoa chegar e acompanha o status: quem está no local, há quanto tempo entrou e se tem PIN. A visita é encerrada pelo próprio app, sem ligar para a portaria.",
      itens: ["Visitantes e prestadores em abas", "No local e Cadastrados separados", "Encerrar a visita pelo app"]
    },
    "app-encomendas": {
      src: "/sobre/assets/TelaEncomendas-dark.webp", srcClaro: "/sobre/assets/TelaEncomendas-light.webp", tipo: "App do morador", retrato: true, titulo: "Minhas encomendas",
      texto: "Tudo o que chegou na portaria em uma lista só: busca por remetente, separação entre o que aguarda retirada e o que já foi entregue, e a foto do volume quando a portaria registra. Cada item mostra bloco, apartamento, transportadora e a hora da chegada.",
      itens: ["Aguardando e Entregues separados", "Quem retirou fica registrado", "Foto do volume no recebimento"]
    },
    "app-financeiro": {
      src: "/sobre/assets/TelaFinanceiro-dark.webp", srcClaro: "/sobre/assets/TelaFinanceiro-light.webp", tipo: "App do morador", retrato: true, titulo: "Meu financeiro",
      texto: "A conta do condomínio na palma da mão: total pendente em destaque, mês a mês, e cada conta com o próprio status: Condomínio, Aluguel, Água, Luz e Internet.",
      itens: ["Total pendente do mês", "1 pendente · Nenhuma pendência", "Boleto direto na conta"]
    },
    "porteiro-inicio": {
      src: "/sobre/assets/porteiro-inicio.webp", tipo: "App da portaria", retrato: true, titulo: "Início do turno",
      texto: "A primeira tela de quem assume o posto: encomendas aguardando retirada, visitantes liberados no dia, quantas pessoas estão no condomínio agora e as ocorrências em aberto. Abaixo, o condomínio do turno com blocos, unidades e quantos estão no local.",
      itens: ["Quatro números que abrem o turno", "Quantos estão no condomínio agora", "Troca de condomínio no mesmo login"]
    },
    "porteiro-mudancas": {
      src: "/sobre/assets/porteiro-mudancas.webp", tipo: "App da portaria", retrato: true, titulo: "Agendamentos de mudança",
      texto: "O morador pede a data da mudança e a portaria aceita ou recusa na própria tela, sem bilhete no balcão. Cada pedido mostra apartamento, dia e hora, e fica com o estado à vista: pendente, aceito ou recusado.",
      itens: ["Aceitar ou recusar em um toque", "Pendentes destacados no topo", "Histórico do que já foi agendado"]
    },
    "porteiro-comunicados": {
      src: "/sobre/assets/porteiro-comunicados.webp", tipo: "App da portaria", retrato: true, titulo: "Comunicados",
      texto: "Os avisos do condomínio na mão de quem atende o portão: manutenção de piscina, interdição de quadra, limpeza de caixa d'água, convocação de assembleia. A portaria responde ao morador sem precisar procurar o síndico.",
      itens: ["Mesmo aviso que o morador recebe", "Publicação direto do celular", "Sem papel no mural da recepção"]
    },
    "porteiro-ocorrencias": {
      src: "/sobre/assets/porteiro-ocorrencias.webp", tipo: "App da portaria", retrato: true, titulo: "Abertura de ocorrências",
      texto: "Portão que não abre, vidro quebrado, lâmpada queimada: a portaria registra na hora, com filtro por situação e por mês. Cada ocorrência fica marcada como pública ou privada e mostra o autor e o prazo.",
      itens: ["Pendentes e Em andamento separados", "Pública ou privada por ocorrência", "Autor e prazo registrados"]
    },
    "web-autorizacao": {
      src: "/sobre/assets/web-autorizacao.webp", dim: [1919, 943], tipo: "Sistema web", titulo: "Autorização de acesso",
      texto: "A portaria toca em Solicitar e o pedido sai para o morador. Quando a resposta volta, o console mostra o estado na própria linha e oferece dois caminhos: registrar a entrada no sistema ou liberar a catraca e o portão físico.",
      itens: ["Solicitar direto da linha da pessoa", "Resposta do morador em tempo real", "Registrar entrada ou liberar catraca"]
    },
    "app-autorizacao": {
      src: "/sobre/assets/app-autorizacao.webp", tipo: "App do morador", retrato: true, titulo: "Liberação pelo morador",
      texto: "A notificação chega com a foto e o nome de quem está no portão. O morador responde de onde estiver: Negar, Autorizar, ou Autorizar e Dar Entrada de uma vez. Também pode deixar para decidir depois, sem travar a portaria.",
      itens: ["Foto e nome de quem está no portão", "Autorizar, negar ou decidir depois", "Resolve sem atender o interfone"]
    },
    "web-visitantes": {
      src: "/sobre/assets/web-visitantes-claro.webp", srcClaro: "/sobre/assets/web-visitantes-claro.webp", dim: [1600, 900], tipo: "Sistema web", titulo: "Visitantes",
      legenda: "Visitantes · controle de acesso, entrada e saída do condomínio",
      texto: "A tela que a portaria usa no turno inteiro. Ativos no local, liberados aguardando, quem saiu e o total registrado, com documento mascarado na tela, validação de PIN e baixa por apartamento.",
      itens: ["Ativos no local em tempo real", "Dar baixa e nova visita em um clique", "Documento mascarado na lista"]
    },
    "web-financeiro": {
      src: "/sobre/assets/web-financeiro.webp", dim: [1919, 944], tipo: "Sistema web", titulo: "Controle financeiro",
      legenda: "Financeiro · fluxo de caixa, pendências por apartamento e exportação em CSV",
      texto: "Fluxo de caixa, auditoria de pagamentos e inadimplência por bloco. O síndico abre um apartamento, vê o histórico de pendências e notifica o morador sem sair do painel.",
      itens: ["Receitas, despesas e saldo do período", "Inadimplência por bloco e apartamento", "Exportação em CSV"]
    },
    "web-dashboard": {
      src: "/sobre/assets/web-dashboard-claro.webp", srcClaro: "/sobre/assets/web-dashboard-claro.webp", dim: [1600, 894], tipo: "Sistema web", titulo: "Dashboard da operação",
      legenda: "Dashboard · o condomínio agora, com os últimos eventos em tempo real",
      texto: "A tela que o síndico abre para saber como o condomínio está agora: visitantes no local, encomendas aguardando retirada, ocorrências pendentes e prestadores ativos. Ao lado, o fluxo de entradas e saídas em tempo real e os atalhos que a portaria mais usa no turno.",
      itens: ["Quatro indicadores do dia em destaque", "Últimos eventos com filtro por tipo", "Atalhos: liberar visitante, validar PIN, dar baixa"]
    },
    "web-ocorrencias": {
      src: "/sobre/assets/web-ocorrencias-claro.webp", srcClaro: "/sobre/assets/web-ocorrencias-claro.webp", dim: [1600, 899], tipo: "Sistema web", titulo: "Ocorrências",
      legenda: "Ocorrências · registro, prioridade e resposta da administração",
      texto: "Cada ocorrência chega com categoria, prioridade e prazo. A administração responde na própria ficha, atribui um responsável, marca como ciente e solucionada, e conversa com quem abriu. Tudo fica no histórico.",
      itens: ["Pendentes, em andamento e solucionadas", "Resposta da administração na ficha", "Atribuição e conversa com o morador"]
    },
    "web-relatorios": {
      src: "/sobre/assets/web-relatorios-claro.webp", srcClaro: "/sobre/assets/web-relatorios-claro.webp", dim: [1600, 900], tipo: "Sistema web", titulo: "Relatórios e auditoria",
      legenda: "Relatórios · acessos, encomendas, ocorrências e balanço financeiro",
      texto: "Relatórios consolidados de acessos, encomendas, ocorrências e balanço financeiro, com filtro por período e saída em PDF ou planilha. O síndico também baixa uma exportação completa dos dados em arquivo .zip.",
      itens: ["Filtro por período", "PDF para imprimir ou planilha Excel", "Exportação completa dos dados em .zip"]
    }
  };

  // Telas com versão clara e escura seguem o tema (CSS decide qual aparece).
  // As duas imagens são lazy: a escondida (display:none) nem chega a baixar.
  imgTela = (t, alt, estilo) => {
    const dim = t.dim || (t.retrato ? (t.srcClaro ? [540, 1168] : [738, 1600]) : [1600, 900]);
    const css = estilo ? Object.keys(estilo).map((k) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()) + ":" + estilo[k]).join(";") : "";
    const img = (src, l, a, classe) => {
      const menor = t.retrato ? 360 : 800;
      const srcset = src.replace(".webp", "-" + menor + ".webp") + " " + menor + "w, " + src + " " + l + "w";
      const sizes = t.retrato ? "(max-width: 760px) 90vw, 400px" : "(max-width: 1180px) 94vw, 1180px";
      return '<img loading="lazy" decoding="async" srcset="' + esc(srcset) + '" sizes="' + sizes + '" src="' + esc(src) + '"' +
        (classe ? ' class="' + classe + '"' : "") + ' alt="' + esc(alt) + '"' + (css ? ' style="' + esc(css) + '"' : "") +
        ' width="' + l + '" height="' + a + '">';
    };
    if (!t.srcClaro || t.srcClaro === t.src) return img(t.src, dim[0], dim[1]);
    return img(t.src, dim[0], dim[1], "img-dark") + img(t.srcClaro, t.retrato ? 738 : dim[0], t.retrato ? 1600 : dim[1], "img-light");
  };

  alternarTema = () => {
    const raiz = document.documentElement;
    const atual = raiz.dataset.theme || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    const novo = atual === "light" ? "dark" : "light";
    raiz.dataset.theme = novo;
    try { localStorage.setItem("ps-theme", novo); } catch (_) { /* sem storage: vale só para esta visita */ }
  };

  // Movimento do layout: borda do topo, entrada suave das seções e traço das
  // etapas. O conteúdo fica visível em repouso; quem pede menos movimento não
  // recebe animação nenhuma.
  iniciarMovimento() {
    const topo = document.querySelector("header");
    this._aoRolar = () => { if (topo) topo.classList.toggle("scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", this._aoRolar, { passive: true });
    let reduzir = false;
    try { reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}
    const etapas = Array.from(document.querySelectorAll(".step"));
    if (reduzir || typeof IntersectionObserver === "undefined") {
      etapas.forEach((s) => s.classList.add("lit"));
      return;
    }
    this._obsReveal = new IntersectionObserver((itens) => itens.forEach((it) => {
      if (!it.isIntersecting) return;
      this._obsReveal.unobserve(it.target);
      if (it.target.getBoundingClientRect().top < window.innerHeight * 0.2) return;
      it.target.animate(
        [{ opacity: 0, transform: "translateY(28px)" }, { opacity: 1, transform: "none" }],
        { duration: 800, easing: "cubic-bezier(.2,.8,.2,1)" }
      );
    }), { threshold: 0.01 });
    document.querySelectorAll(".rv").forEach((el) => {
      if (el.getBoundingClientRect().top > window.innerHeight) this._obsReveal.observe(el);
    });
    this._obsEtapas = new IntersectionObserver((itens) => itens.forEach((it) => {
      if (!it.isIntersecting) return;
      etapas.forEach((s, i) => window.setTimeout(() => s.classList.add("lit"), i * 350));
      this._obsEtapas.disconnect();
    }), { threshold: 0.4 });
    const lista = document.querySelector(".steps");
    if (lista) this._obsEtapas.observe(lista);
  }

  // Dúvidas: uma aberta por vez, com abertura animada da altura.
  faqClique = (e) => {
    const sum = e.target && e.target.closest ? e.target.closest("summary") : null;
    if (!sum) return;
    const d = sum.parentElement;
    const reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduzir || !d.animate) {
      if (!d.open) document.querySelectorAll(".faq details[open]").forEach((o) => { if (o !== d) o.open = false; });
      return;
    }
    e.preventDefault();
    const a = d.querySelector(".ans");
    const fechar = (el) => {
      const r = el.querySelector(".ans");
      r.animate([{ height: r.offsetHeight + "px" }, { height: "0px" }], { duration: 280, easing: "ease" }).onfinish = () => { el.open = false; };
    };
    if (d.open) { fechar(d); return; }
    document.querySelectorAll(".faq details[open]").forEach((o) => { if (o !== d) fechar(o); });
    d.open = true;
    const h = a.offsetHeight;
    a.animate([{ height: "0px", opacity: 0 }, { height: h + "px", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" });
  };

  abrir = (id) => () => this.setState({ tela: id });
  fechar = () => this.setState({ tela: null });

  componentDidMount() {
    // Anúncios apontam para /sobre/?simular=1: leva direto ao simulador de
    // valor (parâmetro de busca em vez de #âncora, que pode quebrar o gclid).
    // ?ir=<seção> (sitelinks dos anúncios) tem prioridade sobre ?simular.
    try {
      const q = new URLSearchParams(location.search);
      const SECOES = ["sindico", "app", "console", "portaria-app", "reconhecimento-facial", "modulos", "baixar-app", "simulador", "seguranca", "duvidas", "contato"];
      const ir = q.get("ir");
      const alvo = SECOES.indexOf(ir) >= 0 ? ir : q.has("simular") ? "simulador" : null;
      if (alvo) {
        setTimeout(() => {
          const el = document.getElementById(alvo);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 400);
      }
    } catch (e) {}
    this._esc = (e) => {
      if (e.key !== "Escape") return;
      this.fechar();
      if (this.state.menuAberto) this.setState({ menuAberto: false });
      if (this.state.emailPainel) this.setState({ emailPainel: false });
    };
    window.addEventListener("keydown", this._esc);

    this.iniciarRotacao();
    this.observarBarra();
    this.iniciarMovimento();

    const c = this.lerConsentimento();
    if (c) this.setState({ cookieAnalytics: !!c.analytics, cookieMarketing: !!c.marketing });
    else this.setState({ cookieBanner: true });
  }

  // localStorage lanca em Safari privado e quando o usuario bloqueia storage —
  // nesse caso o banner simplesmente reaparece, em vez de a pagina quebrar.
  lerConsentimento() {
    try { return JSON.parse(window.localStorage.getItem(this.CHAVE_COOKIES) || "null"); }
    catch (_) { return null; }
  }

  gravarConsentimento(v) {
    try { window.localStorage.setItem(this.CHAVE_COOKIES, JSON.stringify(v)); }
    catch (_) { /* sem storage: a escolha vale so para esta visita */ }
  }

  // Le o que ja foi digitado no formulario ao lado, para o e-mail nascer
  // preenchido. O formulario nao e controlado, entao a leitura e pelo DOM; se
  // ele nao existir (apos o envio) ou estiver vazio, o corpo sai com os campos
  // em branco para a pessoa completar.
  dadosFormulario() {
    try {
      const el = document.getElementById("ps-form-demo");
      if (!el || el.closest("[hidden]")) return null;
      const f = new FormData(el);
      const d = {
        nome: String(f.get("nome") || "").trim(),
        condominio: String(f.get("condominio") || "").trim(),
        contato: String(f.get("contato") || "").trim(),
        unidades: String(f.get("unidades") || "").trim()
      };
      return (d.nome || d.condominio || d.contato || d.unidades) ? d : null;
    } catch (_) { return null; }
  }

  corpoEmail() {
    const d = this.dadosFormulario();
    return [
      "Olá! Gostaria de receber um orçamento do Prestare Gestão para o meu condomínio.",
      "",
      "Nome: " + (d ? this.tituloCaso(d.nome) : ""),
      "Condomínio: " + (d ? this.tituloCaso(d.condominio) : ""),
      "WhatsApp: " + (d ? this.formatarTelefone(d.contato) : ""),
      "Unidades: " + (d ? d.unidades : ""),
      "",
      "Enviado pelo site prestarecondominios.com.br/sobre"
    ].join("\n");
  }

  linkEmail(onde) {
    const to = encodeURIComponent(this.EMAIL);
    const su = encodeURIComponent(this.ASSUNTO);
    const bo = encodeURIComponent(this.corpoEmail());
    if (onde === "gmail") return "https://mail.google.com/mail/?view=cm&fs=1&to=" + to + "&su=" + su + "&body=" + bo;
    if (onde === "outlook") return "https://outlook.live.com/mail/0/deeplink/compose?to=" + to + "&subject=" + su + "&body=" + bo;
    return "mailto:" + this.EMAIL + "?subject=" + su + "&body=" + bo;
  }

  abrirEmail = (onde) => () => {
    const url = this.linkEmail(onde);
    // mailto: nao pode ir por window.open: se nao houver cliente registrado,
    // sobra uma aba em branco. No mesmo contexto o navegador so ignora.
    if (onde === "app") window.location.href = url;
    else window.open(url, "_blank", "noopener");
    this.setState({ emailPainel: false });
  };

  alternarEmailPainel = () => this.setState({ emailPainel: !this.state.emailPainel });

  copiarEmail = () => {
    const ok = () => {
      this.setState({ emailCopiado: true });
      window.setTimeout(() => this.setState({ emailCopiado: false }), 2400);
    };
    // clipboard.writeText exige contexto seguro (https) e pode ser negado;
    // o textarea + execCommand cobre http local e navegador antigo.
    const manual = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = this.EMAIL;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        ok();
      } catch (_) { /* sem copia: o endereco fica visivel abaixo do menu */ }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(this.EMAIL).then(ok, manual);
        return;
      }
    } catch (_) { /* cai no manual */ }
    manual();
  };

  decidirCookies = (analytics, marketing) => {
    this.gravarConsentimento({
      versao: 1, data: new Date().toISOString(),
      necessarios: true, analytics: analytics, marketing: marketing
    });
    if (window.psAplicarConsentimento) window.psAplicarConsentimento();
    this.setState({
      cookieAnalytics: analytics, cookieMarketing: marketing,
      cookieBanner: false, cookiePainel: false
    });
  };

  aceitarCookies = () => this.decidirCookies(true, true);
  rejeitarCookies = () => this.decidirCookies(false, false);
  salvarCookies = () => this.decidirCookies(this.state.cookieAnalytics, this.state.cookieMarketing);
  personalizarCookies = () => this.setState({ cookiePainel: true });
  abrirCookies = () => this.setState({ cookieBanner: true, cookiePainel: true });
  alternarAnalytics = () => this.setState({ cookieAnalytics: !this.state.cookieAnalytics });
  alternarMarketing = () => this.setState({ cookieMarketing: !this.state.cookieMarketing });

  componentWillUnmount() {
    window.removeEventListener("keydown", this._esc);
    this.pararRotacao();
    if (this._obsBarra) this._obsBarra.disconnect();
    if (this._obsReveal) this._obsReveal.disconnect();
    if (this._obsEtapas) this._obsEtapas.disconnect();
    if (this._aoRolar) window.removeEventListener("scroll", this._aoRolar);
  }

  // Partículas que não levam maiúscula no meio de um nome próprio.
  PARTICULAS = ["de", "da", "do", "das", "dos", "e", "di", "du", "del", "van", "von"];

  // O visitante digita como quer — "VINICIUS VILELA RUFINI" ou "acapulco".
  // Só normalizamos quando veio tudo em caixa alta ou tudo em minúscula; se a
  // pessoa capitalizou à mão, o que ela escreveu é respeitado.
  tituloCaso = (v) => {
    const t = String(v ?? "").trim().replace(/\s+/g, " ");
    if (!t) return "";
    if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
    return t.toLowerCase().split(" ").map((p, i) =>
      i > 0 && this.PARTICULAS.indexOf(p) !== -1 ? p : p.charAt(0).toUpperCase() + p.slice(1)
    ).join(" ");
  };

  // "17992559990" -> "(17) 99660-8148".
  formatarTelefone = (v) => {
    let d = String(v ?? "").replace(/\D/g, "");
    // Só tira o 55 do país quando sobra número demais para ser um DDD — o 55
    // também é o DDD de Santa Maria/RS, e não pode ser comido aqui.
    if (d.length > 11 && d.indexOf("55") === 0) d = d.slice(2);
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return String(v ?? "").trim();
  };

  irParaContato = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (this.state.menuAberto) this.fecharMenu();
    const el = document.getElementById("contato");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (window.history && window.history.pushState) {
        window.history.pushState(null, "", "#contato");
      }
    }
  };

  irParaSimulador = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const el = document.getElementById("simulador");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // A barra fixa do celular sai da frente enquanto o simulador ou o
  // formulário estão na tela: ali ela só cobriria os campos.
  observarBarra() {
    if (typeof IntersectionObserver === "undefined") return;
    const visiveis = new Set();
    this._obsBarra = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (en.isIntersecting) visiveis.add(en.target.id);
        else visiveis.delete(en.target.id);
      });
      const oculta = visiveis.size > 0;
      if (oculta !== this.state.barraOculta) this.setState({ barraOculta: oculta });
    }, { threshold: 0.15 });
    ["simulador", "contato"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) this._obsBarra.observe(el);
    });
  }

  // Tabela de preço em curva de U: as 30 primeiras unidades pagam o Compacto
  // (valor fixo) e cada unidade seguinte paga o preço da sua faixa.
  PLANOS = [
    { nome: "Compacto", ate: 30, incluso: "1 bloco · 1 terminal facial · suporte comercial" },
    { nome: "Padrão", ate: 60, incluso: "Até 2 blocos · 1 terminal facial" },
    { nome: "Plus", ate: 120, incluso: "Até 3 blocos · 2 terminais faciais" },
    { nome: "Corporativo", ate: Infinity, incluso: "Blocos ilimitados · terminais adicionais · gestor de conta · SLA prioritário · relatório mensal ao conselho" }
  ];
  IMPLANTACAO = 490;

  calcularPlano = (n) => {
    const faixa = (de, ate, valor) => Math.max(0, Math.min(n, ate) - de) * valor;
    const mensal = 298 + faixa(30, 60, 9.9) + faixa(60, 120, 8.9) + faixa(120, Infinity, 11.9);
    const plano = this.PLANOS.find((p) => n <= p.ate);
    return { plano: plano.nome, incluso: plano.incluso, mensal: Math.round(mensal * 100) / 100 };
  };

  brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  simAlterar = (e) => {
    const v = parseInt(String(e.target.value).replace(/\D/g, ""), 10);
    this.setState({ simUnidades: Number.isFinite(v) ? Math.min(v, 5000) : "" });
  };

  // Botões − e + do simulador: 10 unidades por vez, dentro dos limites do campo.
  simPasso = (passo) => () => {
    const atual = Number(this.state.simUnidades) || 0;
    this.setState({ simUnidades: Math.max(1, Math.min(5000, atual + passo)) });
  };

  simVals(num) {
    const n = Number(this.state.simUnidades);
    const ok = this.state.simUnidades !== "" && Number.isFinite(n) && n >= 1;
    const c = ok ? this.calcularPlano(n) : null;
    const resumo = ok ? n + " unidades · " + c.plano + " · " + this.brl(c.mensal) + "/mês" : "";
    const msg = ok
      ? "Olá! Simulei no site o plano " + c.plano + " para " + n + " unidades (" + this.brl(c.mensal) + "/mês) e quero uma proposta para o meu condomínio."
      : "Olá! Quero um orçamento do Prestare Gestão para o meu condomínio.";
    return {
      simUnidades: this.state.simUnidades,
      simSlider: ok ? Math.min(n, 300) : 1,
      simAlterar: this.simAlterar,
      simTemValor: ok,
      simSemValor: !ok,
      simForm: ok && !this.state.simEnviado,
      simConfirmado: ok && this.state.simEnviado,
      simPlano: c ? c.plano : "",
      simIncluso: c ? c.incluso : "",
      simMensal: c ? this.brl(c.mensal) : "",
      simPorUnidade: c ? this.brl(c.mensal / n) : "",
      simImplantacao: this.brl(this.IMPLANTACAO),
      simResumo: resumo,
      simLink: "https://wa.me/" + num + "?text=" + encodeURIComponent(msg)
    };
  }

  // Pedido feito no card do simulador: as unidades vêm da simulação e o lead
  // chega ao CRM como "80 unidades · Plus · R$ 773,00/mês".
  enviarSimulador = (e) => {
    e.preventDefault();
    if (this.state.simEnviado || this._enviandoSim) return;
    const form = e.target;
    const f = new FormData(form);
    const n = Number(this.state.simUnidades);
    if (!Number.isFinite(n) || n < 1) return;
    const c = this.calcularPlano(n);
    const resumo = n + " unidades · " + c.plano + " · " + this.brl(c.mensal) + "/mês";
    const num = (this.props.whatsapp ?? "5517996608148").replace(/\D/g, "");
    const ok = window.psEnviarPedido({
      form: form,
      obrigatorios: ["nome", "condominio", "contato"],
      lead: {
        nome: String(f.get("nome") || ""),
        condominio: String(f.get("condominio") || ""),
        unidades: resumo,
        whatsapp: String(f.get("contato") || ""),
        site: String(f.get("site") || ""),
        pagina: "/sobre/#simulador"
      },
      mensagem: window.psMensagemSimulador({
        nome: this.tituloCaso(f.get("nome")),
        condominio: this.tituloCaso(f.get("condominio")),
        whatsapp: this.formatarTelefone(f.get("contato")),
        resumo: resumo
      }),
      numero: num
    });
    if (!ok) return;
    this._enviandoSim = true;
    this.setState({ simEnviado: true });
  };

  enviar = (e) => {
    e.preventDefault();
    // Guarda contra duplo envio: dois cliques rapidos no botao (antes do
    // form sumir da tela, ja que o setState de "enviado" nao e sincrono)
    // nao podem abrir o WhatsApp duas vezes nem registrar dois leads.
    if (this.state.enviado || this._enviando) return;
    const form = e.target;
    const f = new FormData(form);
    const unidadesBruto = String(f.get("unidades") ?? "").trim();

    // Linha em branco entre os blocos e rótulo em negrito (*x* é a marcação do
    // WhatsApp): sem isso a mensagem chega como um parágrafo corrido.
    const linhas = [
      "*Pedido de orçamento — Prestare Gestão*",
      "",
      "Olá! Gostaria de receber um orçamento do Prestare Gestão para o meu condomínio.",
      "",
      "*Nome:* " + this.tituloCaso(f.get("nome")),
      "*Condomínio:* " + this.tituloCaso(f.get("condominio")),
      "*WhatsApp:* " + this.formatarTelefone(f.get("contato")),
      "*Unidades:* " + unidadesBruto,
      "",
      "_Enviado pelo site prestarecondominios.com.br/sobre_"
    ];

    const num = (this.props.whatsapp ?? "5517996608148").replace(/\D/g, "");
    // Validação, registro do lead e WhatsApp ficam em psEnviarPedido (no
    // <head>), compartilhado com o formulário do simulador.
    const ok = window.psEnviarPedido({
      form: form,
      obrigatorios: ["nome", "contato", "condominio", "unidades"],
      lead: {
        nome: String(f.get("nome") || ""),
        condominio: String(f.get("condominio") || ""),
        unidades: unidadesBruto,
        whatsapp: String(f.get("contato") || ""),
        site: String(f.get("site") || ""),
        pagina: "/sobre/#contato"
      },
      mensagem: linhas.join("\n"),
      numero: num
    });
    if (!ok) return;
    this._enviando = true;
    this.setState({ enviado: true });
  };

  renderVals() {
    const num = (this.props.whatsapp ?? "5517996608148").replace(/\D/g, "");
    const t = this.state.tela ? this.TELAS[this.state.tela] : null;
    const ci = this.state.consoleIndice;
    const chaveConsole = this.CONSOLE_TELAS[ci];
    const telaConsole = this.TELAS[chaveConsole];
    return {
      telaAberta: !!t,
      telaRetrato: !!t && !!t.retrato,
      modalLargura: !!t && t.retrato ? "fit-content" : "min(94vw, 1180px)",
      telaPaisagem: !!t && !t.retrato,
      telaImgRetrato: t ? this.imgTela(t, t.titulo, { width: "auto", maxWidth: "100%", maxHeight: "74vh", border: "1px solid var(--line-200)" }) : null,
      telaImgPaisagem: t ? this.imgTela(t, t.titulo, { width: "auto", maxWidth: "100%", maxHeight: "58vh", border: "1px solid var(--line-200)" }) : null,
      telaTipo: t ? t.tipo : "",
      telaTitulo: t ? t.titulo : "",
      telaTexto: t ? t.texto : "",
      telaItens: t ? t.itens : [],
      fecharTela: this.fechar,
      abrirAppHome: this.abrir("app-home"),
      abrirAppIa: this.abrir("app-ia"),
      abrirAppVisitantes: this.abrir("app-visitantes"),
      abrirAppEncomendas: this.abrir("app-encomendas"),
      abrirAppFinanceiro: this.abrir("app-financeiro"),
      abrirPorteiroInicio: this.abrir("porteiro-inicio"),
      abrirPorteiroMudancas: this.abrir("porteiro-mudancas"),
      abrirPorteiroComunicados: this.abrir("porteiro-comunicados"),
      abrirPorteiroOcorrencias: this.abrir("porteiro-ocorrencias"),
      abrirWebAutorizacao: this.abrir("web-autorizacao"),
      abrirAppAutorizacao: this.abrir("app-autorizacao"),
      consoleImg: this.imgTela(telaConsole, telaConsole.titulo + " no sistema web, com dados fictícios", { width: "100%" }),
      consoleAlt: telaConsole.titulo + " no sistema web. Clique para ampliar",
      consoleLegenda: telaConsole.legenda,
      consoleAbrir: this.abrir(chaveConsole),
      menuAberto: this.state.menuAberto,
      menuRotulo: this.state.menuAberto ? "Fechar o menu" : "Abrir o menu",
      menuFechado: !this.state.menuAberto,
      alternarTema: this.alternarTema,
      faqClique: this.faqClique,
      simMenos: this.simPasso(-10),
      simMais: this.simPasso(10),
      alternarMenu: this.alternarMenu,
      fecharMenu: this.fecharMenu,
      pararClique: this.pararClique,
      pausarConsole: this.pararRotacao,
      retomarConsole: this.iniciarRotacao,
      consoleAnterior: this.navegarConsole(-1),
      consoleProximo: this.navegarConsole(1),
      consoleIr0: this.irConsole(0),
      consoleIr1: this.irConsole(1),
      consoleIr2: this.irConsole(2),
      consoleIr3: this.irConsole(3),
      consoleCor0: ci === 0 ? "var(--brand)" : "var(--line-200)",
      consoleCor1: ci === 1 ? "var(--brand)" : "var(--line-200)",
      consoleCor2: ci === 2 ? "var(--brand)" : "var(--line-200)",
      consoleCor3: ci === 3 ? "var(--brand)" : "var(--line-200)",
      consoleLarg0: ci === 0 ? "28px" : "14px",
      consoleLarg1: ci === 1 ? "28px" : "14px",
      consoleLarg2: ci === 2 ? "28px" : "14px",
      consoleLarg3: ci === 3 ? "28px" : "14px",
      mostrarNumeros: this.props.mostrarNumeros ?? true,
      mostrarFaq: this.props.mostrarFaq ?? true,
      telefone: this.formatarTelefone(this.props.whatsapp ?? "5517996608148"),
      linkWhatsapp: "https://wa.me/" + num + "?text=" + encodeURIComponent("Olá! Quero um orçamento do Prestare Gestão para o meu condomínio."),
      ...this.simVals(num),
      simItens: this.simVals(num).simIncluso ? this.simVals(num).simIncluso.split(" · ").map((t) => t.charAt(0).toUpperCase() + t.slice(1)) : [],
      enviado: this.state.enviado,
      mostrarForm: !this.state.enviado,
      enviar: this.enviar,
      enviarSimulador: this.enviarSimulador,
      irParaContato: this.irParaContato,
      irParaSimulador: this.irParaSimulador,
      // Com o aviso de cookies aberto a barra sai: no celular o aviso ocupa o
      // lugar dela, e as duas juntas cobririam o preço do topo.
      barraTransform: this.state.barraOculta || this.state.cookieBanner ? "translateY(110%)" : "none",
      barraEventos: this.state.barraOculta || this.state.cookieBanner ? "none" : "auto",
      ano: new Date().getFullYear(),
      cookieBanner: this.state.cookieBanner,
      cookiePainel: this.state.cookiePainel,
      // O bloco de botoes alterna entre "Personalizar" e "Salvar preferencias",
      // entao precisa do inverso do painel como valor proprio: sc-if nao nega.
      cookieResumo: !this.state.cookiePainel,
      cookieBotao: !this.state.cookieBanner,
      cookieAnalytics: this.state.cookieAnalytics,
      cookieMarketing: this.state.cookieMarketing,
      aceitarCookies: this.aceitarCookies,
      rejeitarCookies: this.rejeitarCookies,
      salvarCookies: this.salvarCookies,
      personalizarCookies: this.personalizarCookies,
      abrirCookies: this.abrirCookies,
      alternarAnalytics: this.alternarAnalytics,
      alternarMarketing: this.alternarMarketing,
      emailPainel: this.state.emailPainel,
      rotuloCopiar: this.state.emailCopiado ? "Endereço copiado!" : "Copiar endereço",
      alternarEmailPainel: this.alternarEmailPainel,
      copiarEmail: this.copiarEmail,
      abrirGmail: this.abrirEmail("gmail"),
      abrirOutlook: this.abrirEmail("outlook"),
      abrirAppEmail: this.abrirEmail("app")
    };
  }
}

  // ---------------------------------------------------------------------------
  // Ligação com o HTML. A página chega pronta do servidor (texto, preços,
  // links do WhatsApp e ano já escritos); este trecho só mantém as partes
  // dinâmicas em dia. Marcadores usados no HTML:
  //   data-if="chave"         mostra/esconde o bloco (atributo hidden)
  //   data-t="chave"          texto do elemento
  //   data-html="chave"       HTML montado aqui (imagens das telas)
  //   data-attr="a:chave,..." atributos (value e checked viram propriedade)
  //   data-estilo="prop:chave,..." propriedades de estilo
  //   data-for="chave"        lista repetida a partir do <template> interno
  //   data-on-click / -submit / -change / -mouseenter / -mouseleave
  // ---------------------------------------------------------------------------
  function pares(txt) {
    return String(txt || "").split(",").filter(Boolean).map((p) => {
      const i = p.indexOf(":");
      return [p.slice(0, i), p.slice(i + 1)];
    });
  }

  function iniciar() {
    const pagina = new Pagina();
    let agendado = false;
    let vals = pagina.renderVals();

    function texto(v) { return v === null || v === undefined || v === false ? "" : String(v); }

    function atualizar() {
      agendado = false;
      vals = pagina.renderVals();
      document.querySelectorAll("[data-if]").forEach((el) => {
        const ver = !!vals[el.getAttribute("data-if")];
        if (el.hidden === ver) el.hidden = !ver;
      });
      document.querySelectorAll("[data-t]").forEach((el) => {
        const v = texto(vals[el.getAttribute("data-t")]);
        if (el.textContent !== v) el.textContent = v;
      });
      document.querySelectorAll("[data-html]").forEach((el) => {
        const v = texto(vals[el.getAttribute("data-html")]);
        if (el._psHtml !== v) { el.innerHTML = v; el._psHtml = v; }
      });
      document.querySelectorAll("[data-attr]").forEach((el) => {
        pares(el.getAttribute("data-attr")).forEach(([nome, chave]) => {
          const v = vals[chave];
          if (nome === "checked") { if (el.checked !== !!v) el.checked = !!v; return; }
          if (nome === "value") {
            const s = texto(v);
            // Não reescreve o que a pessoa está digitando (07 e 7 valem o mesmo).
            if (el.value !== s && !(document.activeElement === el && Number(el.value) === Number(s) && s !== "")) el.value = s;
            return;
          }
          const s = typeof v === "boolean" ? String(v) : texto(v);
          if (el.getAttribute(nome) !== s) el.setAttribute(nome, s);
        });
      });
      document.querySelectorAll("[data-estilo]").forEach((el) => {
        pares(el.getAttribute("data-estilo")).forEach(([prop, chave]) => {
          const s = texto(vals[chave]);
          if (el.style.getPropertyValue(prop) !== s) el.style.setProperty(prop, s);
        });
      });
      document.querySelectorAll("[data-for]").forEach((el) => {
        const lista = vals[el.getAttribute("data-for")] || [];
        const chave = JSON.stringify(lista);
        if (el._psLista === chave) return;
        el._psLista = chave;
        const modelo = el.querySelector(":scope > template");
        Array.from(el.children).forEach((c) => { if (c !== modelo) c.remove(); });
        lista.forEach((item) => {
          const novo = modelo.content.cloneNode(true);
          novo.querySelectorAll("[data-item]").forEach((s) => { s.textContent = texto(item); });
          el.appendChild(novo);
        });
      });
    }

    function agendar() {
      if (agendado) return;
      agendado = true;
      (window.queueMicrotask || ((f) => Promise.resolve().then(f)))(atualizar);
    }
    pagina._agendar = agendar;

    // O HTML já veio com estes valores: guarda o estado inicial sem refazer nada.
    document.querySelectorAll("[data-html]").forEach((el) => { el._psHtml = texto(vals[el.getAttribute("data-html")]); });
    document.querySelectorAll("[data-for]").forEach((el) => { el._psLista = JSON.stringify(vals[el.getAttribute("data-for")] || []); });

    function chamar(el, atributo, e) {
      const fn = vals[el.getAttribute(atributo)];
      if (typeof fn === "function") fn(e);
    }

    // Clique: percorre do alvo para cima, como a propagação faria; um
    // stopPropagation dentro do handler (pararClique) interrompe a subida.
    document.addEventListener("click", (e) => {
      for (let el = e.target; el && el !== document; el = el.parentElement) {
        if (el.hasAttribute && el.hasAttribute("data-on-click")) {
          chamar(el, "data-on-click", e);
          if (e.cancelBubble) break;
        }
      }
    });
    document.addEventListener("submit", (e) => {
      const f = e.target;
      if (f && f.hasAttribute && f.hasAttribute("data-on-submit")) chamar(f, "data-on-submit", e);
    });
    // onChange do React dispara a cada tecla em campo de texto/número/faixa.
    const mudou = (e) => {
      const el = e.target;
      if (!el || !el.hasAttribute || !el.hasAttribute("data-on-change")) return;
      const marcavel = el.type === "checkbox" || el.type === "radio";
      if ((e.type === "change") !== marcavel) return;
      chamar(el, "data-on-change", e);
    };
    document.addEventListener("input", mudou);
    document.addEventListener("change", mudou);
    document.querySelectorAll("[data-on-mouseenter]").forEach((el) => el.addEventListener("mouseenter", (e) => chamar(el, "data-on-mouseenter", e)));
    document.querySelectorAll("[data-on-mouseleave]").forEach((el) => el.addEventListener("mouseleave", (e) => chamar(el, "data-on-mouseleave", e)));

    atualizar();
    pagina.componentDidMount();
    document.documentElement.classList.add("ps-js");
  }

  raiz.PsPagina = Pagina;
  if (typeof document !== "undefined" && !raiz.__psSemIniciar) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
  }
})(typeof window !== "undefined" ? window : globalThis);
