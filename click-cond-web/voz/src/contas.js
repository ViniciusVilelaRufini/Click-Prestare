// Contas SIP dos faciais e monitores: a API é a fonte; o serviço gera
// /etc/asterisk/pjsip_prestare.conf (incluído pelo pjsip.conf) e recarrega o
// res_pjsip pela ARI só quando o conteúdo muda.

const CONTA_FACIAL = /^fac-?\d{1,10}$/;
const CONTA_MONITOR = /^mon-?\d{1,10}$/;
// Senha entra crua no .conf: nada de quebra de linha, ';' (comentário) ou espaço.
const SENHA = /^[A-Za-z0-9._~+=@!-]{12,64}$/;

function numeroDaConta(conta) {
  return Number(conta.replace(/^\D+/, ''));
}

function bloco(conta, senha, contexto, dtmf) {
  return [
    `[${conta}]`,
    'type=endpoint',
    `context=${contexto}`,
    'disallow=all',
    'allow=ulaw,alaw,h264',
    `dtmf_mode=${dtmf}`,
    'direct_media=no',
    'rtp_symmetric=yes',
    'force_rport=yes',
    'rewrite_contact=yes',
    // Sai pela mesma porta em que o aparelho registra (ver pjsip.conf).
    'transport=transport-udp-5080',
    `auth=${conta}`,
    `aors=${conta}`,
    '',
    `[${conta}]`,
    'type=auth',
    'auth_type=userpass',
    `username=${conta}`,
    `password=${senha}`,
    '',
    `[${conta}]`,
    'type=aor',
    'max_contacts=1',
    'remove_existing=yes',
    'qualify_frequency=30',
    '',
  ].join('\n');
}

function filtrar(lista, padrao, log) {
  if (!Array.isArray(lista)) throw new Error('Resposta de contas malformada');
  const vistas = new Set();
  return lista
    .filter((c) => {
      const ok = c && typeof c.conta === 'string' && padrao.test(c.conta)
        && typeof c.senha === 'string' && SENHA.test(c.senha) && !vistas.has(c.conta);
      if (!ok) log?.warn?.(`[contas] conta ignorada: ${c && typeof c.conta === 'string' ? c.conta.slice(0, 20) : '?'}`);
      else vistas.add(c.conta);
      return ok;
    })
    .sort((a, b) => numeroDaConta(a.conta) - numeroDaConta(b.conta));
}

export function renderizarPjsip(contas, log) {
  if (!contas || typeof contas !== 'object') throw new Error('Resposta de contas malformada');
  const faciais = filtrar(contas.faciais, CONTA_FACIAL, log);
  const monitores = filtrar(contas.monitores ?? [], CONTA_MONITOR, log);
  const partes = ['; Gerado pelo prestare-voz a partir da API. Não editar à mão.', ''];
  for (const f of faciais) {
    partes.push(bloco(f.conta, f.senha, 'prestare-facial', f.dtmf_modo === 'info' ? 'info' : 'rfc4733'));
  }
  for (const m of monitores) {
    partes.push(bloco(m.conta, m.senha, 'prestare-monitor', 'rfc4733'));
  }
  return partes.join('\n');
}

/**
 * Sincroniza as contas: lê da API, compara com o arquivo e com o que já foi
 * recarregado. Falha da API não toca no arquivo (mantém as contas atuais).
 */
export function criarSincronizador({ api, ler, escrever, recarregar, log = console }) {
  let recarregado = null;
  let rodando = null;

  async function uma() {
    let texto;
    try {
      texto = renderizarPjsip(await api.contas(), log);
    } catch (e) {
      log.warn(`[contas] sem contas da API, mantendo o arquivo atual: ${e.message}`);
      return { mudou: false, recarregou: false };
    }
    let atual = '';
    try { atual = await ler(); } catch { atual = ''; }
    const mudou = atual !== texto;
    if (mudou) await escrever(texto);
    let recarregou = false;
    if (recarregado !== texto) {
      try {
        await recarregar();
        recarregado = texto;
        recarregou = true;
        log.info(`[contas] res_pjsip recarregado${mudou ? ' (contas mudaram)' : ''}`);
      } catch (e) {
        log.warn(`[contas] recarga do res_pjsip falhou, tento no próximo ciclo: ${e.message}`);
      }
    }
    return { mudou, recarregou };
  }

  return {
    executar() {
      if (!rodando) rodando = uma().finally(() => { rodando = null; });
      return rodando;
    },
    iniciar(intervaloMs = 60_000) {
      this.executar();
      const t = setInterval(() => this.executar(), intervaloMs);
      t.unref?.();
      return () => clearInterval(t);
    },
  };
}
