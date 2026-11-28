// Serviço de chamadas: recebe os canais que o dialplan entrega ao Stasis
// `prestare`, conversa com a API e executa as ações da máquina de estados
// (chamada.js) no Asterisk pela ARI (adaptador em ari.js).
//
// Argumentos do Stasis (extensions.conf):
//   facial,<conta>,<numero>   facial registrado discou um ramal
//   entrar,<token>            app/console entrou por WebRTC (sip:entrar@...)
//   monitor,<conta>,<id>      monitor IP originado por nós atendeu
import { randomUUID } from 'node:crypto';
import { criarChamada } from './chamada.js';
import { verificarTokenVoz } from './token.js';

const CONTA_FACIAL = /^fac-\d{1,10}$/;
const CONTA_MONITOR = /^mon-\d{1,10}$/;
const NUMERO = /^\d{1,10}$/;
const TIPOS_DE_ORIGEM = new Set(['portaria_unidade', 'unidade_portaria']);

const MENSAGEM_POR_MOTIVO = {
  nao_encontrado: 'apto-nao-encontrado',
  indisponivel: 'servico-indisponivel',
  limite: 'aguarde-para-chamar',
};

const som = (nome) => `sound:prestare/${nome}`;

const TEMPORIZADOR_REAL = {
  agendar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (h) => clearTimeout(h),
};

export function criarServico({
  ari,
  api,
  segredo,
  relogio = Date.now,
  temporizador = TEMPORIZADOR_REAL,
  log = console,
  toquePadraoS = 30,
  toquePortariaPadraoS = 45,
}) {
  if (!segredo) throw new Error('VOZ_TOKEN_SECRET ausente');

  const chamadas = new Map(); // id -> registro da chamada
  const porCanal = new Map(); // canal -> { id, papel: 'origem'|'participante'|'monitor' }
  const aguardando = new Set(); // canais esperando resposta da API
  const mortos = new Set(); // canais que caíram enquanto esperavam
  const portariaPendente = new Set(); // /portaria chegou antes de sabermos o id
  let criandoFacial = 0;
  const emAndamento = new Set();

  function rastrear(p) {
    const q = Promise.resolve(p)
      .catch((e) => log.error(`[servico] ${e?.stack ?? e}`))
      .finally(() => emAndamento.delete(q));
    emAndamento.add(q);
    return q;
  }

  const desligar = (canal, motivo = 'normal') =>
    Promise.resolve(ari.hangup(canal, motivo)).catch(() => {});

  async function mensagemEDesligar(canal, nome) {
    try {
      await ari.answer(canal);
      await ari.tocar(canal, som(nome));
    } catch (e) {
      log.warn(`[servico] mensagem ${nome} não tocou: ${e.message}`);
    }
    await desligar(canal);
  }

  // ---------------------------------------------------------------- registro

  function registrar(maquina) {
    const c = {
      id: maquina.id,
      maquina,
      origem: maquina.canalOrigem,
      monitores: new Map(), // canal -> conta (tocando)
      ponte: null,
      timers: new Map(),
      atendidos: new Set(),
      fila: Promise.resolve(),
    };
    chamadas.set(c.id, c);
    porCanal.set(c.origem, { id: c.id, papel: 'origem' });
    log.info(`[chamada ${c.id}] ${maquina.tipo} criada (${maquina.estado})`);
    return c;
  }

  function limpar(c) {
    for (const h of c.timers.values()) temporizador.cancelar(h);
    c.timers.clear();
    for (const [canal, ref] of porCanal) if (ref.id === c.id) porCanal.delete(canal);
    if (chamadas.get(c.id) === c) chamadas.delete(c.id);
    log.info(`[chamada ${c.id}] encerrada`);
  }

  function processar(c, acoes) {
    if (!acoes?.length) return;
    c.fila = c.fila.then(() => executar(c, acoes));
    rastrear(c.fila);
  }

  async function executar(c, acoes) {
    for (const a of acoes) {
      try {
        await executarAcao(c, a);
      } catch (e) {
        log.warn(`[chamada ${c.id}] ação ${a.acao} falhou: ${e.message}`);
        if (a.acao === 'ponte') processar(c, c.maquina.falhou());
      }
    }
    if (c.maquina.estado === 'encerrada' && chamadas.get(c.id) === c) limpar(c);
  }

  // ------------------------------------------------------------------ ações

  async function atender(c, canal) {
    if (c.atendidos.has(canal)) return;
    c.atendidos.add(canal);
    await ari.answer(canal);
  }

  function cancelarTimer(c, nome) {
    const h = c.timers.get(nome);
    if (h !== undefined) {
      temporizador.cancelar(h);
      c.timers.delete(nome);
    }
  }

  function desligarMonitores(c) {
    for (const canal of c.monitores.keys()) {
      porCanal.delete(canal);
      desligar(canal);
    }
    c.monitores.clear();
  }

  async function executarAcao(c, a) {
    switch (a.acao) {
      case 'tocar_origem':
        await ari.ring(c.origem);
        return;
      case 'atender_origem':
        await atender(c, c.origem);
        return;
      case 'atender_canal':
        await atender(c, a.canal);
        return;
      case 'ponte':
        if (!c.ponte) c.ponte = await ari.criarPonte();
        await ari.adicionarNaPonte(c.ponte, a.canais);
        return;
      case 'cancelar_toques':
        cancelarTimer(c, 'toque');
        cancelarTimer(c, 'toque_portaria');
        return;
      case 'desligar_monitores':
        desligarMonitores(c);
        return;
      case 'agendar':
        cancelarTimer(c, a.nome);
        c.timers.set(a.nome, temporizador.agendar(() => {
          c.timers.delete(a.nome);
          processar(c, c.maquina.expirou(a.nome));
        }, a.s * 1000));
        return;
      case 'evento':
        enviarEvento(c, a);
        return;
      case 'ligar_monitor': {
        if (!CONTA_MONITOR.test(a.conta)) return;
        const canal = `prestare-mon-${c.id}-${randomUUID().slice(0, 8)}`;
        c.monitores.set(canal, a.conta);
        porCanal.set(canal, { id: c.id, papel: 'monitor' });
        try {
          await ari.originar({ endpoint: `PJSIP/${a.conta}`, appArgs: `monitor,${a.conta},${c.id}`, timeoutS: c.maquina.toqueS, canal });
        } catch (e) {
          c.monitores.delete(canal);
          porCanal.delete(canal);
          log.warn(`[chamada ${c.id}] monitor ${a.conta} não tocou: ${e.message}`);
        }
        return;
      }
      case 'recusar_canal':
        porCanal.delete(a.canal);
        await desligar(a.canal, 'busy');
        return;
      case 'tocar_mensagem':
        try {
          await atender(c, c.origem);
          await ari.tocar(c.origem, som(a.som));
        } catch (e) {
          log.warn(`[chamada ${c.id}] mensagem ${a.som} não tocou: ${e.message}`);
        }
        return;
      case 'tocar_mensagem_ponte':
        if (c.ponte) rastrear(ari.tocarNaPonte(c.ponte, som(a.som)));
        return;
      case 'desligar_tudo': {
        for (const h of c.timers.values()) temporizador.cancelar(h);
        c.timers.clear();
        desligarMonitores(c);
        const canais = [c.origem, c.maquina.canalAtendido].filter(Boolean);
        await Promise.all(canais.map((canal) => desligar(canal)));
        if (c.ponte) {
          await Promise.resolve(ari.destruirPonte(c.ponte)).catch(() => {});
          c.ponte = null;
        }
        return;
      }
      default:
        log.warn(`[chamada ${c.id}] ação desconhecida ${a.acao}`);
    }
  }

  function enviarEvento(c, a) {
    const { acao: _acao, ...ev } = a;
    if (ev.evento === 'toque_esgotado') {
      // A resposta decide o próximo passo; API fora = encerra (não deixa o
      // visitante preso no toque).
      rastrear(
        Promise.resolve()
          .then(() => api.evento(c.id, ev))
          .then((r) => (r?.proximo === 'portaria' ? 'portaria' : 'encerrar'), (e) => {
            log.warn(`[chamada ${c.id}] toque_esgotado sem resposta da API: ${e.message}`);
            return 'encerrar';
          })
          .then((proximo) => processar(c, c.maquina.resposta(proximo))),
      );
      return;
    }
    rastrear(
      Promise.resolve()
        .then(() => api.evento(c.id, ev))
        .catch((e) => log.warn(`[chamada ${c.id}] evento ${ev.evento} não chegou à API: ${e.message}`)),
    );
  }

  // ------------------------------------------------------- entrada de canais

  async function facial(canal, conta, numero) {
    if (!CONTA_FACIAL.test(conta ?? '')) return desligar(canal);
    if (!NUMERO.test(numero ?? '')) return mensagemEDesligar(canal, 'apto-nao-encontrado');

    aguardando.add(canal);
    criandoFacial += 1;
    let r = null;
    try {
      r = await api.novaChamada(conta, numero);
    } catch (e) {
      log.warn(`[servico] novaChamada ${conta}/${numero} falhou: ${e.message}`);
    } finally {
      criandoFacial -= 1;
    }

    if (!r || r.ok !== true || !Number.isInteger(r.id) || chamadas.has(r.id)) {
      aguardando.delete(canal);
      const morreu = mortos.delete(canal);
      if (morreu) return undefined;
      const nome = (r && r.ok === false && MENSAGEM_POR_MOTIVO[r.motivo]) || 'servico-indisponivel';
      return mensagemEDesligar(canal, nome);
    }

    let dados = null;
    try {
      dados = await api.chamada(r.id);
    } catch (e) {
      log.warn(`[chamada ${r.id}] sem dados da API, usando tempos padrão: ${e.message}`);
    }

    const c = registrar(criarChamada({
      id: r.id,
      tipo: 'facial_unidade',
      toqueS: Number(r.toque_s) || toquePadraoS,
      toquePortariaS: Number(dados?.toque_portaria_s) || toquePortariaPadraoS,
      canalOrigem: canal,
      monitores: Array.isArray(r.monitores) ? r.monitores : [],
      relogio,
    }));
    aguardando.delete(canal);
    processar(c, c.maquina.iniciar());
    // Unidade sem app: a API manda para a portaria antes de nos dar o id.
    if (portariaPendente.delete(r.id) || dados?.estado === 'portaria') {
      processar(c, c.maquina.forcarPortaria());
    }
    if (mortos.delete(canal)) {
      porCanal.delete(canal);
      processar(c, c.maquina.origemDesligou());
    }
    return undefined;
  }

  async function entrar(canal, token) {
    const claims = verificarTokenVoz(token, segredo, Math.floor(relogio() / 1000));
    if (!claims) return desligar(canal);

    if (claims.papel === 'origem') {
      if (chamadas.has(claims.cid)) return desligar(canal);
      aguardando.add(canal);
      let dados = null;
      try {
        dados = await api.chamada(claims.cid);
      } catch (e) {
        log.warn(`[chamada ${claims.cid}] origem sem dados da API: ${e.message}`);
      }
      aguardando.delete(canal);
      const morreu = mortos.delete(canal);
      if (!dados || !TIPOS_DE_ORIGEM.has(dados.tipo) || dados.estado === 'encerrada' || chamadas.has(claims.cid)) {
        return morreu ? undefined : desligar(canal);
      }
      const c = registrar(criarChamada({
        id: claims.cid,
        tipo: dados.tipo,
        toqueS: Number(dados.toque_s) || toquePadraoS,
        toquePortariaS: Number(dados.toque_portaria_s) || toquePortariaPadraoS,
        canalOrigem: canal,
        monitores: Array.isArray(dados.monitores) ? dados.monitores : [],
        relogio,
      }));
      processar(c, c.maquina.iniciar());
      if (morreu) {
        porCanal.delete(canal);
        processar(c, c.maquina.origemDesligou());
      }
      return undefined;
    }

    const c = chamadas.get(claims.cid);
    if (!c) return desligar(canal);
    const acoes = c.maquina.entrou({ papel: claims.papel, uid: claims.uid, canal });
    if (c.maquina.canalAtendido === canal) porCanal.set(canal, { id: c.id, papel: 'participante' });
    processar(c, acoes);
    return undefined;
  }

  function monitor(canal, conta, idTexto) {
    const c = chamadas.get(Number(idTexto));
    if (!c || !c.monitores.has(canal)) return desligar(canal);
    c.monitores.delete(canal);
    porCanal.delete(canal);
    const acoes = c.maquina.monitorAtendeu(conta, canal);
    if (c.maquina.canalAtendido === canal) {
      porCanal.set(canal, { id: c.id, papel: 'participante' });
      c.atendidos.add(canal);
    }
    processar(c, acoes);
    return undefined;
  }

  function aoIniciar({ canal, args }) {
    const [tipo, a, b] = args ?? [];
    if (tipo === 'facial') return facial(canal, a, b);
    if (tipo === 'entrar') return entrar(canal, a);
    if (tipo === 'monitor') return monitor(canal, a, b);
    return desligar(canal);
  }

  function aoFim({ canal }) {
    if (aguardando.has(canal)) {
      mortos.add(canal);
      return;
    }
    const ref = porCanal.get(canal);
    if (!ref) return;
    porCanal.delete(canal);
    const c = chamadas.get(ref.id);
    if (!c) return;
    if (ref.papel === 'origem') processar(c, c.maquina.origemDesligou());
    else if (ref.papel === 'participante') processar(c, c.maquina.participanteDesligou(canal));
    else if (ref.papel === 'monitor') c.monitores.delete(canal);
  }

  ari.aoIniciar((ev) => rastrear(aoIniciar(ev)));
  ari.aoFim((ev) => rastrear(aoFim(ev)));

  // ------------------------------------------------- comandos do controle

  return {
    forcarPortaria(id) {
      const c = chamadas.get(id);
      if (c) {
        processar(c, c.maquina.forcarPortaria());
        return true;
      }
      if (criandoFacial > 0) {
        portariaPendente.add(id);
        temporizador.agendar(() => portariaPendente.delete(id), 60_000);
        return true;
      }
      return false;
    },

    async dtmf(id, digitos) {
      const c = chamadas.get(id);
      if (!c || c.maquina.estado === 'encerrada') return false;
      try {
        await ari.enviarDtmf(c.origem, digitos);
        return true;
      } catch (e) {
        log.warn(`[chamada ${id}] dtmf falhou: ${e.message}`);
        return false;
      }
    },

    encerrar(id) {
      const c = chamadas.get(id);
      if (!c) return false;
      processar(c, c.maquina.encerrar());
      return true;
    },

    ativas: () => chamadas.size,

    /** Espera todo o trabalho assíncrono em curso (testes e desligamento). */
    async ocioso() {
      while (emAndamento.size) await Promise.all([...emAndamento]);
    },
  };
}
