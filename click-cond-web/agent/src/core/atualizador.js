'use strict';

/**
 * agent/src/core/atualizador.js — auto-atualização do executável (tarefa 8).
 *
 * PROTOCOLO (spec, decisão 6 + endurecimento da revisão)
 * --------------------------------------------------------
 * O agente consulta `GET /api/facial/agent/condo/:token/versao` na partida
 * (após o primeiro poll bem-sucedido) e a cada 6h. Se houver versão maior:
 *   1. só baixa se a instalação tiver um laço de reinício
 *      (`run-agent-service.cmd` com `goto loop` ao lado do exe) — sem ele,
 *      trocar o arquivo e sair NUNCA mais sobe o agente sozinho;
 *   2. baixa para `click-agent.new.exe`, só de origem permitida (ver
 *      `motivoUrlRecusada`: releases `agent-v*` do repositório do agente no
 *      github.com, o CDN de assets do GitHub SÓ como redirecionamento, ou o
 *      host da própria API) — na URL inicial E em cada redirecionamento — e
 *      com TLS validado de verdade (sem isso, o SHA-256 não vale nada: um
 *      MITM que engana o TLS pode servir seu próprio {url, sha256} e o
 *      agente baixaria e rodaria QUALQUER coisa);
 *   3. confere o SHA-256 contra o que a nuvem informou — divergente é
 *      DESCARTADO;
 *   4. grava `atualizacao.json` ({ de, para, tentativas: 0 }), renomeia o exe
 *      em uso para `click-agent.old.exe` (Windows deixa renomear um .exe em
 *      execução, só não deixa apagar/sobrescrever) e o novo para o mesmo nome
 *      do exe atual, e sai com código 0 — o laço de serviço reinicia sozinho.
 *      A saída não é imediata: `temReinicioPendente()` fica true e quem roda
 *      o laço de poll (index.js) chama `sairSeReinicioPendente()` no FIM da
 *      iteração, depois dos comandos em curso (um enroll pela metade não é
 *      cortado). Um teto de segurança sai mesmo assim se o laço travar.
 *      Se qualquer um dos dois renames falhar no meio, desfaz o que já tinha
 *      sido feito (nunca fica sem `click-agent.exe` no disco).
 *
 * Na PRÓXIMA partida, se `atualizacao.json` existe e `para` é a versão que
 * está rodando agora (comparação numérica, não string — ver `compararVersoes`),
 * incrementa `tentativas`. Se chegar a 3 (a versão nova não conseguiu nem
 * completar um poll 3 vezes seguidas), reverte sozinho: o exe atual (quebrado)
 * vira `click-agent.bad.exe` (fica no disco para inspeção, nunca é apagado) e
 * `click-agent.old.exe` volta a ser o exe — e a versão rejeitada fica marcada
 * em `versao-recusada.json`, para `verificar()` nunca mais tentar baixá-la
 * (senão, enquanto a nuvem continuar oferecendo essa mesma versão, o agente
 * entraria num looping infinito de baixar → trocar → falhar → reverter).
 *
 * Crash ANTES de main() (a versão nova nem chega a rodar este código) é
 * coberto pelo laço de serviço (run-agent-service.cmd): com
 * `atualizacao.json` presente, cada saída com código != 0 soma em
 * `atualizacao-falhas.txt`; na 3ª, o próprio .cmd troca os arquivos
 * (exe → .bad.exe, .old.exe → exe) e NÃO apaga `atualizacao.json` — o exe
 * antigo, ao subir, vê `para` diferente da própria versão e marca `para`
 * como recusada (mesmo caminho do parágrafo abaixo).
 *
 * O mesmo booby-trap (looping infinito) acontece se um release esquecer de
 * bumpar `AGENT_VERSION` em `src/versao.js`: o exe rodando é de fato o que
 * acabou de ser publicado, mas a constante por dentro não bate com
 * `atualizacao.json.para` nem com o que a nuvem anuncia — `verificarInicializacao`
 * e `confirmarSucesso` detectam essa incoerência, marcam a versão como
 * recusada e descartam o `atualizacao.json`, em vez de ficar tentando essa
 * "mesma" versão pra sempre.
 *
 * Depois do PRIMEIRO poll com HTTP 2xx (não só "não é 401/404" — um 5xx
 * repetido nunca confirma nada), `atualizacao.json` é apagado — a
 * atualização foi confirmada, não conta mais como tentativa. Um vigia
 * (`iniciarVigiaDeConfirmacao`) força a saída do processo se isso não
 * acontecer dentro de 10min, pra não ficar preso numa versão que conecta mas
 * nunca fecha um poll de verdade (sem isso, `tentativas` nunca avançaria e o
 * rollback nunca disparia).
 *
 * TESTABILIDADE (nota do controller)
 * -----------------------------------
 * Isto troca o executável de máquinas de clientes: errar aqui é grave. Cada
 * ponto de risco é injetável (`criarAtualizador(deps)`), para os testes
 * rodarem 100% num diretório temporário, sem tocar em arquivo real nem rede
 * real: `isSea` (nunca mexe em disco fora de um exe SEA de verdade),
 * `caminhoExe`/`diretorio` (onde vivem o exe e o `atualizacao.json`),
 * `buscarVersao`/`baixar` (a camada HTTP), `renomear` (pra simular falha no
 * meio da troca de arquivos) e `sair` (no lugar de `process.exit`, que
 * mataria o processo de teste).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { configDir } = require('./estado');
const { cloudRequest } = require('./nuvem');
const { AGENT_VERSION } = require('../versao');

const ARQ_ATUALIZACAO = 'atualizacao.json';
const ARQ_VERSAO_RECUSADA = 'versao-recusada.json';
const NOME_OLD = 'click-agent.old.exe';
const NOME_NEW = 'click-agent.new.exe';
const NOME_BAD = 'click-agent.bad.exe';
const NOME_LACO_SERVICO = 'run-agent-service.cmd';
const MAX_TENTATIVAS = 3;
const MAX_REDIRECTS = 5;
// 6h — mesmo valor da spec. Não veio de env: diferente do intervalo de
// telemetria (que já existia configurável antes desta tarefa), este é novo e
// a spec não pede override.
const INTERVALO_VERIFICACAO_MS = 6 * 60 * 60 * 1000;
// Se uma atualização ficar pendente (atualizacao.json gravado) sem confirmar
// nenhum poll 2xx dentro desse tempo, o processo se mata sozinho (exit 1) —
// o laço de serviço reinicia e ISSO conta como tentativa.
const WATCHDOG_CONFIRMACAO_MS = 10 * 60 * 1000;
// Timeout de INATIVIDADE do socket de download (reseta a cada byte recebido;
// não é um teto pro download inteiro) — sem isso, uma conexão travada trava
// o atualizador (e a verificação periódica) pra sempre.
const DOWNLOAD_TIMEOUT_MS = 60000;
// Troca feita, saída adiada até o fim da iteração do laço de poll — mas se
// o laço não chegar lá nesse prazo (travado), sai mesmo assim.
const TETO_REINICIO_PENDENTE_MS = 5 * 60 * 1000;

// Origens do download (checadas na URL inicial E em CADA redirecionamento).
// É o que faz o SHA-256 valer alguma coisa contra uma nuvem comprometida:
// mesmo que ela minta um {url, sha256} coerentes entre si, só buscamos o
// arquivo de um release do NOSSO repositório. Só o host "github.com" não
// bastava — qualquer repositório público do GitHub passaria.
//   - github.com: só releases com tag `agent-v*` do repositório do agente
//     (o dono aparece com os dois nomes que a conta já teve);
//   - CDN de assets do GitHub: só como REDIRECIONAMENTO (é para onde o
//     github.com manda o download) — nunca como URL inicial, senão um asset
//     de outro repositório entraria direto pelo CDN;
//   - o host da própria API (quem chama passa em `hostApi`).
const HOST_GITHUB = 'github.com';
const PREFIXOS_RELEASE_GITHUB = Object.freeze([
  '/Viniciusvile/Click-Prestare/releases/download/agent-v',
  '/ViniciusVilelaRufini/Click-Prestare/releases/download/agent-v',
]);
const HOSTS_CDN_GITHUB = Object.freeze([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

/**
 * Por que `urlStr` NÃO pode ser usada no download da atualização (string com
 * o motivo) — ou `null` se pode. `inicial` = é a URL que a nuvem mandou (não
 * um hop de redirecionamento). Nomes de dono/repositório do GitHub não
 * diferenciam maiúsculas, então o prefixo também não.
 */
function motivoUrlRecusada(urlStr, { inicial, hostApi } = {}) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    return `URL inválida: ${urlStr}`;
  }
  const host = url.hostname.toLowerCase();
  if (hostApi && host === String(hostApi).toLowerCase()) return null;
  if (host === HOST_GITHUB) {
    const caminho = url.pathname.toLowerCase();
    const ok = PREFIXOS_RELEASE_GITHUB.some((p) => caminho.startsWith(p.toLowerCase()));
    return ok
      ? null
      : `caminho não permitido no github.com (só releases agent-v* do repositório do agente): ${url.pathname}`;
  }
  if (HOSTS_CDN_GITHUB.includes(host)) {
    return inicial ? `host não permitido como URL inicial (só como redirecionamento): ${host}` : null;
  }
  return `host não permitido: ${host}`;
}

/** `node:sea` só existe a partir do Node 20 com o flag de build SEA; em Node
 *  mais velho, ou rodando `node index.js` direto (dev), `isSea()` não existe
 *  ou devolve false — os dois casos têm de significar "não mexe em disco". */
function isSeaReal() {
  try {
    // eslint-disable-next-line global-require
    const sea = require('node:sea');
    return typeof sea.isSea === 'function' && sea.isSea();
  } catch {
    return false;
  }
}

/**
 * Compara duas versões no formato `AAAA.MM.DD[.N]`: segmento a segmento,
 * numericamente (não como string — "10" > "9"), segmento faltando = 0 (então
 * "2026.09.24" e "2026.09.24.0" são iguais). Devolve >0 se `a` é mais nova
 * que `b`, <0 se mais velha, 0 se igual — mesma convenção de comparator do
 * `Array.prototype.sort`.
 */
function compararVersoes(a, b) {
  const segmentos = (v) =>
    String(v || '')
      .split('.')
      .map((n) => Number(n) || 0);
  const sa = segmentos(a);
  const sb = segmentos(b);
  const tamanho = Math.max(sa.length, sb.length);
  for (let i = 0; i < tamanho; i++) {
    const diff = (sa[i] || 0) - (sb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function lerJsonEm(diretorio, nome, padrao) {
  try {
    return JSON.parse(fs.readFileSync(path.join(diretorio, nome), 'utf8'));
  } catch {
    return padrao;
  }
}

function gravarJsonAtomicoEm(diretorio, nome, obj) {
  const destino = path.join(diretorio, nome);
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, destino);
}

function sha256DoArquivo(caminho) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const leitura = fs.createReadStream(caminho);
    leitura.on('data', (chunk) => hash.update(chunk));
    leitura.on('end', () => resolve(hash.digest('hex')));
    leitura.on('error', reject);
  });
}

function hostnameDe(urlStr) {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Baixa `urlStr` para `destino`, seguindo redirecionamentos (até
 * `opts.maxRedirects`, default 5 — os assets de release do GitHub redirecionam
 * para outro host). Duas travas de segurança, checadas na URL inicial E em
 * CADA hop de redirecionamento (não só na primeira):
 *   - esquema tem de ser `https://`;
 *   - se `opts.validarUrl(url, { inicial })` for passado, ele devolve o motivo
 *     da recusa (string) ou null — quem chama pela produção
 *     (`criarAtualizador`) sempre passa `motivoUrlRecusada`; testes que
 *     chamam `baixarArquivo` direto podem omitir pra continuar genérico.
 * TLS é validado de verdade (sem `rejectUnauthorized: false`) — é o SHA-256
 * conferido depois que garante a integridade do conteúdo, mas só faz sentido
 * se ninguém no meio do caminho puder trocar o {url, sha256} por um par seu
 * (daí a checagem de host) nem forjar a conexão (daí o TLS estrito).
 *
 * `opts.transporte` é injetável — é o que deixa os testes reaproveitarem
 * esta função de verdade contra um servidor local (fala HTTP por baixo dos
 * panos, sem precisar de certificado) sem pesar na validação de TLS real.
 */
function baixarArquivo(urlStr, destino, opts = {}) {
  const transporte = opts.transporte || https;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const validarUrl = opts.validarUrl || null;
  const timeoutMs = opts.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;

  function tentar(url, restantes) {
    return new Promise((resolve, reject) => {
      if (!/^https:\/\//i.test(url)) {
        reject(new Error(`Download de atualização precisa ser HTTPS: ${url}`));
        return;
      }
      if (validarUrl) {
        const motivo = validarUrl(url, { inicial: restantes === maxRedirects });
        if (motivo) {
          reject(new Error(`Download de atualização: ${motivo}`));
          return;
        }
      }
      let req;
      try {
        req = transporte.get(url, {}, (res) => {
          const { statusCode, headers } = res;
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            res.resume(); // descarta o corpo do redirect
            if (restantes <= 0) {
              reject(new Error('Download de atualização: excesso de redirecionamentos'));
              return;
            }
            const proxima = new URL(headers.location, url).toString();
            resolve(tentar(proxima, restantes - 1));
            return;
          }
          if (statusCode !== 200) {
            res.resume();
            reject(new Error(`Download de atualização falhou: HTTP ${statusCode}`));
            return;
          }
          const arquivo = fs.createWriteStream(destino);
          res.on('error', (err) => {
            arquivo.destroy();
            reject(err);
          });
          arquivo.on('error', reject);
          // Espera 'close' (não só 'finish'): no Windows, renomear o arquivo
          // logo em seguida (verificar()) falha se o descritor ainda estiver
          // aberto — 'finish' dispara antes do fd fechar de fato.
          arquivo.on('close', () => resolve());
          res.pipe(arquivo);
        });
      } catch (err) {
        reject(err);
        return;
      }
      req.on('error', reject);
      // Timeout de inatividade do socket — não de download inteiro (reseta
      // a cada byte). Uma conexão que trava no meio (ou nunca conecta) não
      // pode travar o atualizador pra sempre.
      req.setTimeout?.(timeoutMs, () => {
        req.destroy(new Error('Download de atualização: timeout'));
      });
    });
  }

  return tentar(urlStr, maxRedirects);
}

/** Consulta padrão (produção): a mesma rota que o portal usa para saber se
 *  há atualização, autenticada pelo token do condomínio (o `AGENT_TOKEN`
 *  já configurado em index.js). Falha de rede vira `null` — quem chama
 *  (`verificar`) trata como "nada disponível agora", não como erro fatal. */
async function buscarVersaoPadrao(token) {
  const res = await cloudRequest('GET', `/api/facial/agent/condo/${token}/versao`);
  return res && res.data && typeof res.data === 'object' ? res.data : null;
}

function temLacoDeReinicio(dirExe) {
  try {
    const conteudo = fs.readFileSync(path.join(dirExe, NOME_LACO_SERVICO), 'utf8');
    return /goto\s+loop/i.test(conteudo);
  } catch {
    return false;
  }
}

/**
 * Monta o atualizador com as dependências injetadas (produção usa os
 * defaults reais; os testes trocam `isSea`, `diretorio`, `caminhoExe`,
 * `buscarVersao`, `baixar`, `renomear`, `apiUrl` e `sair`).
 */
function criarAtualizador(deps = {}) {
  const {
    isSea = isSeaReal,
    diretorio = configDir,
    caminhoExe = () => process.execPath,
    buscarVersao = buscarVersaoPadrao,
    // apiUrl() entra na allowlist de hosts do download (além dos do GitHub) —
    // função (não string) porque em index.js API_URL pode mudar depois da
    // configuração inicial interativa (firstRunSetup), e este atualizador é
    // criado uma vez só, no boot do módulo.
    apiUrl = () => '',
    renomear = (de, para) => fs.renameSync(de, para),
    baixar = (urlStr, destino) =>
      baixarArquivo(urlStr, destino, {
        validarUrl: (url, { inicial }) => motivoUrlRecusada(url, { inicial, hostApi: hostApiAtual() }),
      }),
    sair = (codigo) => process.exit(codigo),
    log = console,
    // Teto de segurança da saída adiada (ver `sairSeReinicioPendente`).
    tetoReinicioMs = TETO_REINICIO_PENDENTE_MS,
  } = deps;

  // Verificação em curso: o setInterval de agendarVerificacaoPeriodica não
  // pode empilhar uma segunda chamada por cima de um download ainda em
  // andamento (rede lenta, exe grande) — reentrar no meio bagunçaria o
  // click-agent.new.exe compartilhado.
  let emAndamento = false;
  // Evita logar o mesmo aviso de "versão recusada" a cada verificação (6h em
  // 6h) enquanto a nuvem continuar anunciando essa versão — loga uma vez por
  // versão nova encontrada nessa situação.
  let ultimoAvisoRejeitada = null;

  // Arquivos já trocados, esperando o laço de poll terminar a iteração em
  // curso para sair (ver `sairSeReinicioPendente`).
  let reinicioPendente = false;

  function hostApiAtual() {
    try {
      return hostnameDe(apiUrl() || '');
    } catch {
      return null; /* apiUrl() não configurada ainda — só as origens do GitHub */
    }
  }

  function marcarVersaoRecusada(dir, versao) {
    try {
      gravarJsonAtomicoEm(dir, ARQ_VERSAO_RECUSADA, { versao, em: new Date().toISOString() });
    } catch (err) {
      log.error(`[agente] falha ao gravar ${ARQ_VERSAO_RECUSADA}: ${err.message || err}`);
    }
  }

  /** Uma troca de arquivos pode falhar NO MEIO (renomeou o 1º, o 2º deu
   *  erro) — sem desfazer, `click-agent.exe` some do disco e o laço de
   *  serviço não encontra mais nada pra rodar na próxima subida. Tenta
   *  devolver `nomeOrigemUndo` (ao lado do exe) pro lugar do exe, best-effort
   *  (só loga se também falhar — não há mais nada a fazer por código aqui). */
  function desfazerTrocaParcial(dirExe, exeAtual, nomeOrigemUndo) {
    try {
      if (!fs.existsSync(exeAtual) && fs.existsSync(path.join(dirExe, nomeOrigemUndo))) {
        renomear(path.join(dirExe, nomeOrigemUndo), exeAtual);
        log.error(`[agente] troca incompleta revertida: ${path.basename(exeAtual)} restaurado a partir de ${nomeOrigemUndo}`);
      }
    } catch (err) {
      log.error(`[agente] falha ao desfazer troca incompleta: ${err.message || err}`);
    }
  }

  /** Log de diagnóstico (não corrige sozinho — Task 9 ensina o
   *  run-agent-service.cmd a fazer isso antes de tentar subir o exe): se
   *  `click-agent.exe` não existe mas `click-agent.old.exe` sim, uma troca
   *  anterior ficou pela metade. O PROCESSO ATUAL pode muito bem ser
   *  exatamente esse exe renomeado (Windows deixa um exe em execução ser
   *  renomeado/movido sem derrubar o processo) — daí dar pra rodar este
   *  código e notar a inconsistência mesmo "sendo" o arquivo desaparecido. */
  function checarExeFaltando() {
    const exe = caminhoExe();
    const dirExe = path.dirname(exe);
    if (!fs.existsSync(exe) && fs.existsSync(path.join(dirExe, NOME_OLD))) {
      log.error(
        `[agente] ${path.basename(exe)} não existe nesta pasta, mas ${NOME_OLD} sim — uma troca de atualização não terminou. Renomeie ${NOME_OLD} de volta para ${path.basename(exe)} (ou reinstale pelo portal) para o serviço voltar a subir sozinho.`,
      );
    }
  }

  /**
   * Chamado uma vez, na partida do processo — ANTES de qualquer poll. Nunca
   * lança (Important 4): um erro inesperado aqui não pode derrubar `main()`
   * antes do agente sequer tentar falar com a nuvem.
   */
  function verificarInicializacao() {
    try {
      verificarInicializacaoInterna();
    } catch (err) {
      log.error(
        `[agente] atualizador: falha inesperada ao verificar atualização pendente na partida: ${err.message || err} — seguindo em frente`,
      );
    }
  }

  function verificarInicializacaoInterna() {
    if (!isSea()) {
      log.log('[agente] atualizador: fora de um executável SEA — não mexe em arquivos');
      return;
    }
    checarExeFaltando();

    const dir = diretorio();
    const estado = lerJsonEm(dir, ARQ_ATUALIZACAO, null);
    if (!estado) return;

    // Comparação NUMÉRICA (não `!==` de string): "2026.09.24" e
    // "2026.09.24.0" são a mesma versão.
    if (compararVersoes(estado.para, AGENT_VERSION) !== 0) {
      // Dois casos, mesmo remédio (marcar `para` como recusada):
      //  - o laço de serviço (run-agent-service.cmd) reverteu uma versão
      //    nova que caía antes de main() — quem roda agora é o exe ANTIGO;
      //  - um release esqueceu de bumpar AGENT_VERSION — o exe rodando é o
      //    trocado, mas a constante por dentro não bate.
      // Sem marcar como recusada, verificar() tentaria baixar essa versão
      // pra sempre (a nuvem nunca vai anunciar outra coisa).
      if (estado.para) {
        log.error(
          `[agente] atualizacao.json aponta para ${estado.para}, mas a versão rodando é ${AGENT_VERSION} — marcando ${estado.para} como recusada (revertida pelo laço de serviço, ou release sem AGENT_VERSION atualizado)`,
        );
        marcarVersaoRecusada(dir, estado.para);
      }
      try {
        fs.unlinkSync(path.join(dir, ARQ_ATUALIZACAO));
      } catch {
        /* já não existia */
      }
      return;
    }

    const tentativas = (Number(estado.tentativas) || 0) + 1;
    if (tentativas >= MAX_TENTATIVAS) {
      log.error(
        `[agente] atualização ${estado.de} → ${estado.para} falhou ${tentativas}x seguidas sem completar um poll — revertendo para ${estado.de}`,
      );
      const dirExe = path.dirname(caminhoExe());
      try {
        renomear(caminhoExe(), path.join(dirExe, NOME_BAD));
        renomear(path.join(dirExe, NOME_OLD), caminhoExe());
      } catch (err) {
        log.error(`[agente] falha ao reverter a atualização: ${err.message || err}`);
        desfazerTrocaParcial(dirExe, caminhoExe(), NOME_BAD);
      }
      marcarVersaoRecusada(dir, estado.para);
      try {
        fs.unlinkSync(path.join(dir, ARQ_ATUALIZACAO));
      } catch {
        /* já não existia */
      }
      sair(0);
      return;
    }

    gravarJsonAtomicoEm(dir, ARQ_ATUALIZACAO, { ...estado, tentativas });
    log.log(
      `[agente] atualização ${estado.de} → ${estado.para}: tentativa ${tentativas}/${MAX_TENTATIVAS} de completar um poll`,
    );
  }

  /** Chamado só quando o poll respondeu 2xx de verdade (não qualquer coisa
   *  "diferente de 401/404" — um 5xx não confirma nada): a versão atual
   *  provou que fala com a nuvem, então a atualização (se havia uma em
   *  curso) está confirmada. Nunca lança (Important 4). */
  function confirmarSucesso() {
    try {
      if (!isSea()) return;
      const dir = diretorio();
      const estado = lerJsonEm(dir, ARQ_ATUALIZACAO, null);
      if (estado && estado.para && compararVersoes(estado.para, AGENT_VERSION) !== 0) {
        // Mesmo booby-trap do início do arquivo: confirmar um poll não
        // significa que a versão bate com o que foi anunciado. Marca como
        // recusada pra verificar() não insistir nela pra sempre.
        log.error(
          `[agente] poll confirmado, mas a versão rodando (${AGENT_VERSION}) não é a esperada (${estado.para}) — release esqueceu de atualizar AGENT_VERSION? Marcando como recusada.`,
        );
        marcarVersaoRecusada(dir, estado.para);
      }
      try {
        fs.unlinkSync(path.join(dir, ARQ_ATUALIZACAO));
      } catch {
        /* nada pendente — caminho normal (sem atualização em curso) */
      }
    } catch (err) {
      log.error(`[agente] atualizador: falha inesperada ao confirmar sucesso: ${err.message || err}`);
    }
  }

  /** Consulta se há versão mais nova e, se houver, baixa/confere/troca. Nunca
   *  lança — falha de rede, hash divergente etc. só logam e devolvem sem
   *  efeito (a próxima verificação, em 6h, tenta de novo). */
  async function verificar(token) {
    if (emAndamento) {
      log.log('[agente] atualizador: já há uma verificação em andamento — pulando esta chamada');
      return;
    }
    emAndamento = true;
    try {
      await verificarInterna(token);
    } catch (err) {
      log.error(`[agente] atualizador: falha inesperada ao verificar atualização: ${err.message || err}`);
    } finally {
      emAndamento = false;
    }
  }

  async function verificarInterna(token) {
    if (!isSea()) {
      log.log('[agente] atualizador: fora de um executável SEA — não verifica atualização automática');
      return;
    }

    let info;
    try {
      info = await buscarVersao(token);
    } catch (err) {
      log.error(`[agente] falha ao consultar versão disponível: ${err.message || err}`);
      return;
    }
    if (!info || !info.versao || !info.url || !info.sha256) return; // nada publicado, ou a nuvem falhou

    if (compararVersoes(info.versao, AGENT_VERSION) <= 0) return; // já está na versão mais nova (ou mais nova ainda)

    const dir = diretorio();
    const rejeitada = lerJsonEm(dir, ARQ_VERSAO_RECUSADA, null);
    if (rejeitada && rejeitada.versao && compararVersoes(info.versao, rejeitada.versao) <= 0) {
      if (ultimoAvisoRejeitada !== info.versao) {
        ultimoAvisoRejeitada = info.versao;
        log.error(
          `[agente] versão ${info.versao} já foi tentada e revertida antes (ver ${ARQ_VERSAO_RECUSADA}) — ignorando até uma versão mais nova ser publicada`,
        );
      }
      return;
    }

    const dirExe = path.dirname(caminhoExe());
    if (!temLacoDeReinicio(dirExe)) {
      log.error(
        '[agente] instalação sem laço de reinício — reinstale pelo portal para receber atualizações automáticas',
      );
      return;
    }

    log.log(`[agente] nova versão disponível: ${AGENT_VERSION} → ${info.versao} — baixando`);
    const novo = path.join(dirExe, NOME_NEW);

    try {
      await baixar(info.url, novo);
    } catch (err) {
      log.error(`[agente] falha ao baixar atualização: ${err.message || err}`);
      try {
        fs.unlinkSync(novo);
      } catch {
        /* nada baixado ainda */
      }
      return;
    }

    let hash;
    try {
      hash = await sha256DoArquivo(novo);
    } catch (err) {
      log.error(`[agente] falha ao conferir hash da atualização: ${err.message || err}`);
      try {
        fs.unlinkSync(novo);
      } catch {
        /* nada a apagar */
      }
      return;
    }
    if (hash.toLowerCase() !== String(info.sha256).toLowerCase()) {
      log.error(
        `[agente] hash da atualização não confere (esperado ${info.sha256}, obtido ${hash}) — descartando`,
      );
      try {
        fs.unlinkSync(novo);
      } catch {
        /* nada a apagar */
      }
      return;
    }

    const exeAtual = caminhoExe();
    try {
      gravarJsonAtomicoEm(dir, ARQ_ATUALIZACAO, {
        de: AGENT_VERSION,
        para: info.versao,
        tentativas: 0,
      });
      renomear(exeAtual, path.join(dirExe, NOME_OLD));
      renomear(novo, exeAtual);
    } catch (err) {
      log.error(`[agente] falha ao trocar o executável pela versão nova: ${err.message || err}`);
      desfazerTrocaParcial(dirExe, exeAtual, NOME_OLD);
      try {
        fs.unlinkSync(path.join(dir, ARQ_ATUALIZACAO));
      } catch {
        /* pode nem ter chegado a gravar */
      }
      return;
    }

    // Não sai aqui: esta verificação roda em paralelo ao laço de poll, que
    // pode estar no meio de um comando no aparelho (enroll, remoção em
    // lote...). O laço chama `sairSeReinicioPendente()` no fim da iteração.
    reinicioPendente = true;
    log.log(`[agente] atualizado para ${info.versao} — reiniciando ao fim do ciclo de comandos em curso`);
    // Teto de segurança: se o laço travar (nuvem pendurada etc.), sai mesmo
    // assim — os arquivos já foram trocados e só um reinício aplica a versão.
    const teto = setTimeout(() => sairSeReinicioPendente(), tetoReinicioMs);
    teto.unref?.();
  }

  /** Há uma troca de exe feita esperando a saída do processo? */
  function temReinicioPendente() {
    return reinicioPendente;
  }

  /** Sai com código 0 (o laço de serviço sobe a versão nova) SE `verificar()`
   *  já trocou os arquivos. Chame no fim de cada iteração do laço de poll,
   *  depois dos comandos. Sem troca pendente, não faz nada (devolve false). */
  function sairSeReinicioPendente() {
    if (!reinicioPendente) return false;
    reinicioPendente = false;
    log.log('[agente] saindo para o laço de serviço subir a versão nova');
    sair(0);
    return true;
  }

  /** Verificação imediata (chame só depois do primeiro poll OK — ver
   *  index.js) + repetição a cada 6h. Mesmo padrão de
   *  `core/telemetria.js#iniciarTelemetria`: devolve o timer (com `unref()`)
   *  para o chamador guardar o handle. */
  function agendarVerificacaoPeriodica(token, intervaloMs = INTERVALO_VERIFICACAO_MS) {
    void verificar(token);
    const timer = setInterval(() => void verificar(token), intervaloMs);
    timer.unref?.();
    return timer;
  }

  /**
   * Vigia (Important 3): se `atualizacao.json` está pendente (uma
   * atualização acabou de trocar os arquivos) e nenhum poll 2xx confirma
   * isso dentro de `ms` (default 10min), força a saída (código 1) — o laço
   * de serviço reinicia o processo, e essa reinicialização CONTA como
   * tentativa em `verificarInicializacao`. Sem isso, uma versão nova que
   * conecta mas nunca fecha um poll de verdade (trava, erro silencioso etc.)
   * ficaria presa pra sempre sem o contador de tentativas avançar. Chame uma
   * vez, logo depois de `verificarInicializacao()`, no boot do processo.
   */
  function iniciarVigiaDeConfirmacao(ms = WATCHDOG_CONFIRMACAO_MS) {
    if (!isSea()) return null;
    let dir;
    try {
      dir = diretorio();
      if (!fs.existsSync(path.join(dir, ARQ_ATUALIZACAO))) return null; // nada pendente agora
    } catch {
      return null;
    }
    const timer = setTimeout(() => {
      try {
        if (fs.existsSync(path.join(dir, ARQ_ATUALIZACAO))) {
          log.error(
            `[agente] atualização pendente sem confirmar um poll em ${Math.round(ms / 60000)}min — reiniciando para contar como tentativa`,
          );
          sair(1);
        }
      } catch (err) {
        log.error(`[agente] atualizador: falha no vigia de confirmação: ${err.message || err}`);
      }
    }, ms);
    timer.unref?.();
    return timer;
  }

  return {
    verificarInicializacao,
    confirmarSucesso,
    verificar,
    temReinicioPendente,
    sairSeReinicioPendente,
    agendarVerificacaoPeriodica,
    iniciarVigiaDeConfirmacao,
  };
}

module.exports = {
  compararVersoes,
  baixarArquivo,
  criarAtualizador,
  INTERVALO_VERIFICACAO_MS,
  WATCHDOG_CONFIRMACAO_MS,
  ARQ_ATUALIZACAO,
  ARQ_VERSAO_RECUSADA,
  NOME_LACO_SERVICO,
  PREFIXOS_RELEASE_GITHUB,
  HOSTS_CDN_GITHUB,
  motivoUrlRecusada,
};
