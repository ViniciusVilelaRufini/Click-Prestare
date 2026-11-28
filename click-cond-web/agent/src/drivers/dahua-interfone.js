'use strict';

/**
 * agent/src/drivers/dahua-interfone.js — comando `interfone_config` no
 * Intelbras/Dahua: grava a conta SIP e a lista telefônica do facial.
 *
 * NÃO VALIDADO em aparelho. Nomes da "API of HTTP Protocol Specification" da
 * Dahua V3.26 (2023-02-28), cap. 13 (Intelligent Building APIs):
 *
 *   Conta SIP: GET configManager.cgi?action=getConfig&name=SIP
 *              (linhas `table.SIP.<Campo>=<valor>`)
 *              GET configManager.cgi?action=setConfig&SIP.<Campo>=<valor>&... → "OK"
 *   Lista:     GET recordFinder.cgi?action=getQuerySize|find&name=VideoTalkContact
 *              GET recordUpdater.cgi?action=insert|update|remove&name=VideoTalkContact
 *
 * Regras (revisão do G1):
 *   - conta SIP de OUTRO servidor (a do instalador) não é sobrescrita sem
 *     `forcar` — devolve `sip_de_outro_servidor` com o servidor atual;
 *   - só mexe nos contatos com `Notes=prestare` (os nossos); contato manual
 *     com o mesmo número fica e vira `conflitos`;
 *   - lista vazia não remove nada sem `remover:true`;
 *   - lê a lista paginada (offset) e não altera nada se não conseguir ler
 *     inteira;
 *   - prazo total ≤ 22 s (e dentro do que sobra do prazo da nuvem) e no
 *     máximo LOTE_MAX gravações por vez: o resto volta como
 *     `parcial:true, restantes:N` e repetir o comando continua dali;
 *   - conferência depois de gravar é tolerante: só os campos que o aparelho
 *     mostra, servidor normalizado (domínio ou IP), senha não comparada;
 *     divergência vira aviso;
 *   - a senha SIP não aparece em log, resultado nem mensagem de erro.
 */

const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { parseDahuaINI } = require('../lib/dahua-formato');
const { lerJson, gravarJsonAtomico } = require('../core/estado');
const { sleep } = require('../lib/http');

/** Campos da conta SIP que o agente administra (o resto fica como está no aparelho). */
const CAMPOS_SIP = ['SIPServer', 'SIPServerPort', 'UserID', 'AuthID', 'UserEnable'];
/** Sem estes na leitura, não é a tabela que conhecemos: não grava nada. */
const CAMPOS_SIP_OBRIGATORIOS = ['SIPServer', 'UserID'];
/** Marca dos contatos gravados pelo agente: só esses são alterados ou removidos. */
const MARCA_CONTATO = 'prestare';
/** Teto de contatos (Interface Web 2.0: até 1500 ramais). */
const MAX_CONTATOS = 2000;
/** Tamanho da página na leitura da lista (firmwares limitam o `count`). */
const PAGINA = 100;
/** Gravações de contato por execução; o resto fica para a próxima. */
const LOTE_MAX = 30;
/** Teto do comando inteiro: abaixo dos 25 s que a nuvem espera. */
const PRAZO_MAX_MS = 22000;
/** Caracteres que o manual Intelbras diz não aceitar na senha SIP. */
const SENHA_SIP_PROIBIDA = /['":;&]/;
/** Usuário SIP: o manual Intelbras aceita só letras, números e '#', até 32. */
const CONTA_SIP_VALIDA = /^[A-Za-z0-9#]{1,32}$/;

let arquivoSip = 'interfone-sip.json';
let esperaConferenciaMs = 1500;
let margemMs = 2500;

/** Ajustes (testes): `arquivoSip: null` = só memória; espera antes de conferir; folga do prazo. */
function configurar({ arquivoSip: a, esperaConferenciaMs: e, margemMs: m } = {}) {
  if (a !== undefined) {
    arquivoSip = a;
    memoria = null;
  }
  if (Number.isFinite(e) && e >= 0) esperaConferenciaMs = e;
  if (Number.isFinite(m) && m >= 0) margemMs = m;
}

// ---------- Memória da conta gravada ----------
//
// deviceId → { impressao, senhaLida, lidoDepois }:
//   impressao  = sha256(servidor|porta|conta|senha) da última gravação OK;
//   senhaLida  = sha256 do que o aparelho mostrou como senha logo depois
//                (firmware que cifra a senha na leitura) ou null;
//   lidoDepois = o que o aparelho mostrou em cada campo logo depois de
//                gravar (firmware que normaliza o valor).
// Sem isso, firmware que esconde/cifra a senha ou normaliza um campo faria
// o agente regravar a conta (e derrubar o registro) a cada execução.
let memoria = null;
function mem() {
  if (!memoria) {
    const lido = arquivoSip ? lerJson(arquivoSip, {}) : {};
    memoria = new Map(Object.entries(lido && typeof lido === 'object' ? lido : {}));
  }
  return memoria;
}
function lembrar(deviceId, valor) {
  mem().set(String(deviceId), valor);
  if (!arquivoSip) return;
  try {
    gravarJsonAtomico(arquivoSip, Object.fromEntries(mem()));
  } catch (e) {
    console.error(`[agente] falha ao salvar ${arquivoSip}: ${e.message || e}`);
  }
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const impressaoDe = ({ servidor, porta, conta, senha }) => sha(`${servidor}|${porta}|${conta}|${senha}`);

// ---------- Utilidades ----------

/** Tira a senha (crua e codificada) e qualquer `AuthPassword=...` de um texto. */
function semSenha(texto, senha) {
  let t = String(texto ?? '');
  if (senha) {
    for (const s of new Set([senha, encodeURIComponent(senha)])) t = t.split(s).join('***');
  }
  // Qualquer "senha" que venha no corpo do aparelho (Password=, pwd=, secret=...).
  return t.replace(/(pass\w*|pwd\w*|secret\w*)=[^&\s"']*/gi, '$1=***');
}

/** Nome na tela do facial: sem acento, "·" vira "-", só [A-Za-z0-9 _-], até 32. */
function nomeParaAparelho(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[·•|/]/g, '-')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
    .trim();
}

/** Senha de registro do contato (obrigatória no VideoTalkContact; só serve a monitor registrado NO facial). */
function senhaDoContato(senhaConta, numero) {
  return sha(`${senhaConta}:${numero}`).slice(0, 12);
}

/** "sip:Voz.Exemplo.com:5060." → "voz.exemplo.com". */
function normalizarServidor(v) {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^sips?:/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

const cacheDns = new Map(); // nome → { ips, em }
async function ipsDe(nome) {
  const c = cacheDns.get(nome);
  if (c && Date.now() - c.em < 5 * 60 * 1000) return c.ips;
  let ips = [];
  try {
    ips = (await dns.lookup(nome, { all: true })).map((r) => r.address);
  } catch {
    /* sem DNS: só a comparação por texto vale */
  }
  cacheDns.set(nome, { ips, em: Date.now() });
  return ips;
}

/** O servidor do aparelho é o nosso? Texto normalizado ou IP do nosso domínio. */
async function mesmoServidor(doAparelho, nosso) {
  const a = normalizarServidor(doAparelho);
  const b = normalizarServidor(nosso);
  if (!a) return false;
  if (a === b) return true;
  if (net.isIP(a) && !net.isIP(b)) return (await ipsDe(b)).includes(a);
  return false;
}

function mesmoValor(campo, lido, desejado) {
  if (campo === 'UserEnable') {
    const v = String(lido ?? '').trim().toLowerCase();
    return (v === 'true' || v === '1') === (desejado === 'true');
  }
  return String(lido ?? '').trim() === desejado;
}

/** Senha que dá para comparar: vazia ou só asteriscos = o firmware escondeu. */
function senhaLegivel(v) {
  return typeof v === 'string' && v !== '' && !/^\*+$/.test(v);
}

/** Começo do corpo cru, para o erro dizer o que o aparelho respondeu. */
function trecho(res) {
  const raw = String((res && res.raw) || '').replace(/\s+/g, ' ').trim();
  return raw ? `"${raw.slice(0, 80)}"` : '(corpo vazio)';
}

const ok2xx = (res) => res && res.status >= 200 && res.status < 300;

// ---------- Entrada ----------

function validar(c) {
  if (!c || typeof c !== 'object') return { erro: 'comando sem os dados do interfone' };
  const servidor = typeof c.servidor === 'string' ? c.servidor.trim() : '';
  if (!servidor || !/^[A-Za-z0-9.-]{1,253}$/.test(servidor)) return { erro: 'servidor SIP inválido' };
  const porta = Number(c.porta);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return { erro: 'porta SIP inválida' };
  const conta = typeof c.conta === 'string' ? c.conta.trim() : '';
  if (!CONTA_SIP_VALIDA.test(conta)) return { erro: 'conta SIP inválida (só letras, números e #, até 32)' };
  const senha = typeof c.senha === 'string' ? c.senha : '';
  if (!senha || senha.length > 64 || SENHA_SIP_PROIBIDA.test(senha)) {
    return { erro: 'senha SIP inválida (vazia, longa demais ou com caractere que o aparelho não aceita)' };
  }
  if (!Array.isArray(c.contatos) || c.contatos.length > MAX_CONTATOS) return { erro: 'lista de contatos inválida' };
  const contatos = [];
  const vistos = new Set();
  for (const k of c.contatos) {
    const numero = String((k && k.numero) ?? '').trim();
    if (!/^\d{1,10}$/.test(numero)) return { erro: `contato com número inválido: "${numero.slice(0, 12)}"` };
    if (vistos.has(numero)) return { erro: `número repetido na lista: ${numero}` };
    vistos.add(numero);
    contatos.push({ numero, nome: nomeParaAparelho(k.nome) || numero, bloco: nomeParaAparelho(k.bloco) });
  }
  return {
    cfg: { servidor, porta, conta, senha, contatos, forcar: c.forcar === true, remover: c.remover === true },
  };
}

// ---------- Prazo ----------

function criarRelogio(restanteDoPrazo, lanTimeoutMs) {
  const inicio = Date.now();
  const externo = typeof restanteDoPrazo === 'function' ? restanteDoPrazo() : null;
  const fim = inicio + (Number.isFinite(externo) ? Math.min(PRAZO_MAX_MS, externo) : PRAZO_MAX_MS);
  const restante = () => fim - Date.now();
  return {
    restante,
    /** Dá para começar mais uma operação (uma ou duas idas e voltas)? */
    temTempo: () => restante() > margemMs,
    timeout: () => Math.max(200, Math.min(lanTimeoutMs, restante())),
  };
}

// ---------- Conta SIP ----------

function lerTabelaSip(raw) {
  const out = {};
  for (const linha of String(raw || '').split(/\r?\n/)) {
    const m = linha.match(/^table\.SIP\.([A-Za-z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function lerSip(req) {
  const res = await req('GET', '/cgi-bin/configManager.cgi?action=getConfig&name=SIP');
  const tabela = lerTabelaSip(res.raw);
  if (!ok2xx(res) || Object.keys(tabela).length === 0) {
    return {
      erro: `o aparelho não devolveu a configuração SIP (configManager name=SIP, HTTP ${res.status}): ${trecho(res)} — configure a conta à mão`,
    };
  }
  const faltam = CAMPOS_SIP_OBRIGATORIOS.filter((k) => !(k in tabela));
  if (faltam.length) {
    return { erro: `a configuração SIP do aparelho não tem ${faltam.join(', ')} (formato desconhecido) — configure a conta à mão` };
  }
  return { tabela };
}

/** Campo a campo: igual ao desejado, ou igual ao que o aparelho mostrou depois da nossa última gravação. */
async function camposDiferentes(tabela, desejado, cfg, anterior) {
  const diferentes = [];
  const avisos = [];
  for (const k of Object.keys(desejado)) {
    const lido = tabela[k];
    const igual =
      k === 'SIPServer' ? await mesmoServidor(lido, desejado[k]) : mesmoValor(k, lido, desejado[k]);
    if (igual) continue;
    if (anterior && anterior.lidoDepois && anterior.lidoDepois[k] === lido) {
      avisos.push(`conta SIP: o aparelho mostra ${k}="${lido}" (enviado "${desejado[k]}")`);
      continue;
    }
    diferentes.push(k);
  }
  return { diferentes, avisos };
}

function senhaDiferente(tabela, cfg, anterior) {
  const mesmaConta = !!anterior && anterior.impressao === impressaoDe(cfg);
  if (!('AuthPassword' in tabela)) return !mesmaConta;
  const atual = tabela.AuthPassword;
  if (senhaLegivel(atual) && atual === cfg.senha) return false;
  if (!mesmaConta) return true;
  if (!senhaLegivel(atual)) return false; // escondida: vale o que gravamos
  return !(anterior.senhaLida && anterior.senhaLida === sha(atual)); // cifrada: igual à de depois da gravação
}

async function configurarContaSip(req, relogio, device, cfg) {
  const lido = await lerSip(req);
  if (lido.erro) return { erro: lido.erro };
  const { tabela } = lido;

  // Conta "em uso por outra central": servidor preenchido (não vazio nem
  // 0.0.0.0), conta ativada e servidor diferente do nosso. Conta de fábrica
  // (servidor vazio/0.0.0.0) ou desativada pode ser gravada.
  const servidorAtual = tabela.SIPServer || '';
  const semUso =
    ['', '0.0.0.0'].includes(normalizarServidor(servidorAtual)) ||
    ('UserEnable' in tabela && !mesmoValor('UserEnable', tabela.UserEnable, 'true'));
  if (!semUso && !cfg.forcar && !(await mesmoServidor(servidorAtual, cfg.servidor))) {
    return { outroServidor: servidorAtual };
  }

  // Só os campos que o aparelho mostra: firmware sem AuthID/UserEnable não
  // recebe (nem é cobrado por) um campo que não tem.
  const todos = {
    SIPServer: cfg.servidor,
    SIPServerPort: String(cfg.porta),
    UserID: cfg.conta,
    AuthID: cfg.conta,
    UserEnable: 'true',
  };
  const desejado = Object.fromEntries(CAMPOS_SIP.filter((k) => k in tabela).map((k) => [k, todos[k]]));
  const anterior = mem().get(String(device.id)) || null;
  const mesmaConta = !!anterior && anterior.impressao === impressaoDe(cfg);
  const { diferentes, avisos } = await camposDiferentes(tabela, desejado, cfg, mesmaConta ? anterior : null);
  const senhaMudou = senhaDiferente(tabela, cfg, anterior);
  if (diferentes.length === 0 && !senhaMudou && !cfg.forcar) {
    return { alterado: false, campos: [], avisos };
  }

  // A conta inteira (o que a doc marca como obrigatório no setConfig), não
  // só o que mudou: firmware que exige o bloco não fica com a conta pela metade.
  const query = [...Object.entries(desejado), ['AuthPassword', cfg.senha]]
    .map(([k, v]) => `SIP.${k}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await req('GET', `/cgi-bin/configManager.cgi?action=setConfig&${query}`);
  if (!ok2xx(res) || !/^\s*OK\b/i.test(String(res.raw || ''))) {
    return { erro: `o aparelho recusou a conta SIP (HTTP ${res.status}): ${trecho(res)}` };
  }

  // Confere depois de um respiro (firmware que aplica com atraso). Divergência
  // vira aviso — e o que o aparelho mostrou fica lembrado para a próxima vez
  // não regravar em laço.
  const espera = Math.min(esperaConferenciaMs, Math.max(0, relogio.restante() - margemMs));
  if (espera > 0) await sleep(espera);
  const depois = await lerSip(req);
  const avisosDepois = [];
  const lidoDepois = {};
  let senhaLida = null;
  if (depois.erro) {
    avisosDepois.push('conta SIP gravada, mas não deu para conferir lendo de volta');
  } else {
    for (const k of Object.keys(desejado)) {
      lidoDepois[k] = depois.tabela[k];
      const igual =
        k === 'SIPServer' ? await mesmoServidor(depois.tabela[k], desejado[k]) : mesmoValor(k, depois.tabela[k], desejado[k]);
      if (!igual) avisosDepois.push(`conta SIP: o aparelho mostra ${k}="${depois.tabela[k] ?? ''}" (enviado "${desejado[k]}")`);
    }
    if (senhaLegivel(depois.tabela.AuthPassword)) senhaLida = sha(depois.tabela.AuthPassword);
  }
  lembrar(device.id, { impressao: impressaoDe(cfg), senhaLida, lidoDepois });
  return { alterado: true, campos: senhaMudou ? [...diferentes, 'AuthPassword'] : diferentes, avisos: avisosDepois };
}

// ---------- Lista telefônica ----------

function numeroDe(raw, chave) {
  const m = String(raw || '').match(new RegExp(`^\\s*${chave}=(\\d+)`, 'im'));
  return m ? Number(m[1]) : null;
}

async function totalDeContatos(req) {
  const res = await req('GET', '/cgi-bin/recordFinder.cgi?action=getQuerySize&name=VideoTalkContact');
  return ok2xx(res) ? numeroDe(res.raw, 'count') : null;
}

/**
 * Lê a lista inteira, paginando por `offset` (o `count` costuma ser limitado
 * pelo firmware). Não confia só no `totalCount`: confere com o
 * getQuerySize; sem total, pagina até vir página vazia; percebe firmware que
 * ignora o offset (a página repete). Na dúvida, erro — remover "o que não
 * veio" apagaria contatos que só não foram lidos.
 */
async function lerContatos(req, relogio) {
  let total = await totalDeContatos(req);
  const lidos = new Map();
  let offset = 0;
  let offsetIgnorado = false;
  for (let volta = 0; volta <= MAX_CONTATOS; volta++) {
    if (!relogio.temTempo()) return { semTempo: true };
    const res = await req(
      'GET',
      `/cgi-bin/recordFinder.cgi?action=find&name=VideoTalkContact&count=${PAGINA}&offset=${offset}`,
    );
    const raw = String(res.raw || '');
    const found = numeroDe(raw, 'found');
    if (!ok2xx(res) || found === null) {
      return { erro: `o aparelho não devolveu a lista telefônica (VideoTalkContact, HTTP ${res.status}): ${trecho(res)}` };
    }
    const pagina = parseDahuaINI(raw);
    if (pagina.length !== found) return { erro: `resposta da lista telefônica não interpretável (found=${found}, lidos ${pagina.length})` };
    const totalCount = numeroDe(raw, 'totalCount');
    if (total === null && totalCount !== null) total = totalCount;
    if (pagina.length === 0) break;
    const chave = (r) => (r.RecNo !== undefined ? `r${r.RecNo}` : JSON.stringify(r));
    if (offset > 0 && pagina.every((r) => lidos.has(chave(r)))) {
      offsetIgnorado = true;
      break;
    }
    for (const r of pagina) lidos.set(chave(r), r);
    if (lidos.size > MAX_CONTATOS) return { erro: `a lista telefônica do aparelho passa de ${MAX_CONTATOS} contatos; nada foi alterado` };
    offset += pagina.length;
    // Total conhecido: para ao alcançá-lo. Sem total: só a página VAZIA
    // encerra (firmware que corta o count abaixo de PAGINA devolveria uma
    // página "menor" sem a lista ter acabado).
    if (total !== null && lidos.size >= total) break;
  }
  if ((total !== null && lidos.size < total) || (offsetIgnorado && total === null)) {
    return {
      erro: `a lista telefônica do aparelho não pôde ser lida inteira (${lidos.size} de ${total ?? '?'}${
        offsetIgnorado ? '; o aparelho ignora o offset' : ''
      }); nada foi alterado`,
    };
  }
  return { registros: [...lidos.values()] };
}

// ---------- Memória dos contatos gravados ----------
//
// `contatos:<deviceId>` → { <numero>: { e, l } }:
//   e = assinatura (nome|bloco) do que o agente GRAVOU por último;
//   l = assinatura do que o aparelho MOSTROU logo depois (lido de volta).
// Firmware que corta o nome ou converte o bloco mostraria sempre "diferente";
// sem esta memória o agente regravaria todo contato a cada execução e o
// comando ficaria em "parcial" para sempre. Com ela, a diferença que é só do
// firmware vira aviso; se alguém mudar o contato à mão no aparelho (o que ele
// mostra deixa de ser `l`), o agente grava de novo.
const assinatura = (nome, bloco) => sha(`${nome ?? ''}|${bloco ?? ''}`);
function memContatos(deviceId) {
  const m = mem().get(`contatos:${deviceId}`);
  return m && typeof m === 'object' ? { ...m } : {};
}

/**
 * Planeja as mudanças: só os nossos; manual com o mesmo número vira conflito.
 * As operações saem INTERCALADAS (inclusão, remoção, alteração, inclusão...):
 * num lote cortado pelo prazo ou pelo limite, inclusões e remoções andam
 * mesmo com muitas alterações pendentes.
 */
function planejar(registros, cfg, memoriaContatos) {
  const avisos = [];
  const conflitos = [];
  const nossosPorNumero = new Map();
  const manuais = new Set();
  const filas = { insert: [], remove: [], update: [] };
  let iguais = 0;
  for (const r of registros) {
    const numero = String(r.VTShortNumber ?? '').trim();
    const nosso = String(r.Notes ?? '').trim() === MARCA_CONTATO;
    if (!nosso) {
      manuais.add(numero);
      continue;
    }
    if (!/^\d+$/.test(String(r.RecNo ?? ''))) {
      avisos.push(`contato ${numero || '?'} sem RecNo numérico: não foi alterado`);
      manuais.add(numero); // ocupa o número; não insere outro por cima
      continue;
    }
    if (!nossosPorNumero.has(numero)) nossosPorNumero.set(numero, []);
    nossosPorNumero.get(numero).push(r);
  }
  const desejados = new Set(cfg.contatos.map((c) => c.numero));
  for (const c of cfg.contatos) {
    if (manuais.has(c.numero)) {
      conflitos.push(c.numero);
      continue;
    }
    const [r, ...repetidos] = nossosPorNumero.get(c.numero) || [];
    for (const d of repetidos) filas.remove.push({ tipo: 'remove', numero: c.numero, params: { recno: d.RecNo } });
    if (!r) {
      filas.insert.push({ tipo: 'insert', numero: c.numero, contato: c });
      continue;
    }
    const queremos = { FirstName: c.nome, VTOBuilding: c.bloco };
    const mudam = Object.entries(queremos).filter(([k, v]) => String(r[k] ?? '') !== v);
    if (mudam.length === 0) {
      iguais++;
      continue;
    }
    const lembrado = memoriaContatos[c.numero];
    if (lembrado && lembrado.e === assinatura(c.nome, c.bloco) && lembrado.l === assinatura(r.FirstName, r.VTOBuilding)) {
      // Já gravamos exatamente isto e o aparelho mostra o mesmo de logo depois: é o firmware.
      iguais++;
      avisos.push(`contato ${c.numero}: o aparelho mostra "${r.FirstName ?? ''}"${r.VTOBuilding ? ` / bloco "${r.VTOBuilding}"` : ''} (enviado "${c.nome}")`);
      continue;
    }
    filas.update.push({ tipo: 'update', numero: c.numero, contato: c, params: { recno: r.RecNo, ...Object.fromEntries(mudam) } });
  }
  const saem = [];
  for (const [numero, lista] of nossosPorNumero) if (!desejados.has(numero)) saem.push(...lista.map((r) => ({ numero, r })));
  if (saem.length && cfg.contatos.length === 0 && !cfg.remover) {
    avisos.push(`lista vazia: ${saem.length} contato(s) do Prestare ficaram no aparelho (mande remover:true para tirar)`);
  } else {
    for (const { numero, r } of saem) filas.remove.push({ tipo: 'remove', numero, params: { recno: r.RecNo } });
  }
  const ops = [];
  while (filas.insert.length || filas.remove.length || filas.update.length) {
    for (const t of ['insert', 'remove', 'update']) if (filas[t].length) ops.push(filas[t].shift());
  }
  return { ops, iguais, conflitos, avisos };
}

async function gravarContato(req, op, cfg) {
  const params =
    op.tipo === 'insert'
      ? {
          FirstName: op.contato.nome,
          VTShortNumber: op.contato.numero,
          VTOBuilding: op.contato.bloco,
          Notes: MARCA_CONTATO,
          Type: 'VTH',
          RegisterType: 'public',
          VTHPassword: senhaDoContato(cfg.senha, op.contato.numero),
        }
      : op.params;
  const q = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await req('GET', `/cgi-bin/recordUpdater.cgi?action=${op.tipo}&name=VideoTalkContact&${q}`);
  const esperado = op.tipo === 'insert' ? /RecNo=\d+/ : /^\s*OK\b/i;
  if (!ok2xx(res) || !esperado.test(String(res.raw || ''))) {
    return { erro: `o aparelho recusou ${op.tipo} na lista telefônica (HTTP ${res.status}): ${trecho(res)}` };
  }
  return {};
}

/** Depois de gravar: o que o aparelho mostra para este número (null se não deu para ler). */
async function lerDeVolta(req, numero) {
  try {
    const res = await req(
      'GET',
      `/cgi-bin/recordFinder.cgi?action=find&name=VideoTalkContact&count=10&condition.VTShortNumber=${encodeURIComponent(numero)}`,
    );
    if (!ok2xx(res)) return null;
    const r = parseDahuaINI(String(res.raw || '')).find(
      (x) => String(x.VTShortNumber ?? '').trim() === numero && String(x.Notes ?? '').trim() === MARCA_CONTATO,
    );
    return r ? assinatura(r.FirstName, r.VTOBuilding) : null;
  } catch {
    return null;
  }
}

// ---------- Comando ----------

const ERRO_PORTA_ESPERANDO = 'interrompido: há um comando de porta esperando neste facial; tente de novo em instantes';

/**
 * `ctx`: `lanRequest(device, method, path, opts)` do driver, `lanTimeoutMs`,
 * `restanteDoPrazo()` (ms que sobram do prazo da nuvem, ou null) e
 * `haUrgenteNaFila()` (true = abrir porta esperando atrás deste comando).
 * Resultado: `{ ok, parcial, restantes, sip: { alterado, campos }, contatos:
 * { inseridos, atualizados, removidos, iguais }, conflitos, avisos }`, ou
 * `{ ok:false, error }` (`error:'sip_de_outro_servidor'` vem com
 * `servidor_atual`). `restantes` = operações de contato que faltam.
 */
async function configurarInterfone(device, entrada, ctx) {
  const senha = entrada && typeof entrada.senha === 'string' ? entrada.senha : '';
  try {
    const r = await executar(device, entrada, ctx);
    if (r.error) r.error = semSenha(r.error, senha);
    if (Array.isArray(r.avisos)) r.avisos = r.avisos.map((a) => semSenha(a, senha));
    return r;
  } catch (e) {
    return { ok: false, error: `interfone: ${semSenha((e && e.message) || e, senha)}` };
  }
}

async function executar(device, entrada, { lanRequest, lanTimeoutMs = 8000, restanteDoPrazo, haUrgenteNaFila } = {}) {
  const v = validar(entrada);
  if (v.erro) return { ok: false, error: `interfone: ${v.erro} — nada foi enviado ao aparelho` };
  const { cfg } = v;
  const relogio = criarRelogio(restanteDoPrazo, lanTimeoutMs);
  const req = (method, path, opts = {}) => lanRequest(device, method, path, { ...opts, timeout: relogio.timeout() });
  const portaEsperando = () => {
    try {
      return typeof haUrgenteNaFila === 'function' && haUrgenteNaFila() === true;
    } catch {
      return false;
    }
  };

  // Porta esperando: nem começa (a conta SIP é a parte que não dá para cortar no meio).
  if (portaEsperando()) return { ok: false, error: `interfone: ${ERRO_PORTA_ESPERANDO}` };
  const sip = await configurarContaSip(req, relogio, device, cfg);
  if (sip.outroServidor) {
    return {
      ok: false,
      error: 'sip_de_outro_servidor',
      servidor_atual: sip.outroServidor,
    };
  }
  if (sip.erro) return { ok: false, error: `interfone: ${sip.erro}` };
  const sipResumo = { alterado: sip.alterado, campos: sip.campos };
  const avisos = [...sip.avisos];
  const contatos = { inseridos: 0, atualizados: 0, removidos: 0, iguais: 0 };
  const estado = sip.alterado ? 'gravada' : 'já estava certa';

  if (portaEsperando()) return { ok: false, error: `interfone: conta SIP ${estado}; ${ERRO_PORTA_ESPERANDO}`, sip: sipResumo };
  const lido = await lerContatos(req, relogio);
  if (lido.semTempo) {
    return {
      ok: false,
      error: `interfone: conta SIP ${estado}; lista grande demais para o prazo (a leitura da lista telefônica não coube no tempo do comando); nada foi alterado na lista`,
      sip: sipResumo,
    };
  }
  if (lido.erro) return { ok: false, error: `interfone: conta SIP ${estado}; ${lido.erro}`, sip: sipResumo };

  const memoriaContatos = memContatos(device.id);
  const plano = planejar(lido.registros, cfg, memoriaContatos);
  avisos.push(...plano.avisos);
  contatos.iguais = plano.iguais;
  const conta = { insert: 'inseridos', update: 'atualizados', remove: 'removidos' };
  let feitos = 0;
  let memoriaMudou = false;
  const salvarMemoria = () => {
    if (memoriaMudou) lembrar(`contatos:${device.id}`, memoriaContatos);
  };
  for (const op of plano.ops) {
    if (feitos >= LOTE_MAX || !relogio.temTempo()) break;
    if (portaEsperando()) {
      avisos.push('pausado para abrir a porta deste facial: clique de novo para continuar');
      break;
    }
    const g = await gravarContato(req, op, cfg);
    if (g.erro) {
      salvarMemoria();
      return {
        ok: false,
        error: `interfone: ${g.erro} (até aqui: ${JSON.stringify(contatos)})`,
        sip: sipResumo,
        contatos,
      };
    }
    contatos[conta[op.tipo]]++;
    feitos++;
    memoriaMudou = true;
    if (op.tipo === 'remove') delete memoriaContatos[op.numero];
    else {
      memoriaContatos[op.numero] = {
        e: assinatura(op.contato.nome, op.contato.bloco),
        l: await lerDeVolta(req, op.numero),
      };
    }
  }
  salvarMemoria();
  const restantes = plano.ops.length - feitos;
  console.log(
    `[agente] ${device.nome}: interfone ${restantes ? 'parcial' : 'configurado'} (conta SIP ${sip.alterado ? 'gravada' : 'sem mudança'}; ` +
      `contatos +${contatos.inseridos} ~${contatos.atualizados} -${contatos.removidos} =${contatos.iguais}` +
      `${restantes ? `; faltam ${restantes}` : ''}${plano.conflitos.length ? `; conflitos ${plano.conflitos.join(',')}` : ''})`,
  );
  return {
    ok: true,
    parcial: restantes > 0,
    restantes,
    sip: sipResumo,
    contatos,
    conflitos: plano.conflitos,
    avisos,
  };
}

module.exports = {
  configurar,
  configurarInterfone,
  // Expostos para teste.
  nomeParaAparelho,
  normalizarServidor,
  semSenha,
  LOTE_MAX,
  PRAZO_MAX_MS,
};
