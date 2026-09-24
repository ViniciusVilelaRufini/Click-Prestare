'use strict';

/**
 * agent/src/core/estado.js — estado persistido em disco, AO LADO do
 * executável (não em cwd): diretório de config, leitura/gravação de JSON e a
 * marca d'água (baseline) de cada device.
 */

const fs = require('fs');
const path = require('path');

/**
 * Fora do SEA: o bundle vive em `agent/dist/click-agent.cjs` (build-bundle.mjs),
 * mas o .env e o estado ficam em `agent/` — ao lado do package.json, onde o
 * operador sempre os deixou. Então, se o diretório do código é um `dist`,
 * sobe um nível; qualquer outro diretório (fonte, cópia do harness) é usado
 * como está.
 */
function dirDeConfigFora(dirDoCodigo) {
  return path.basename(dirDoCodigo) === 'dist' ? path.dirname(dirDoCodigo) : dirDoCodigo;
}

/**
 * Diretório onde procurar o .env e o estado do agente (baselines, fila
 * offline). Quando empacotado como executável (Node SEA), __dirname aponta
 * para um caminho virtual interno — então usamos a pasta do próprio .exe
 * (process.execPath). Rodando via `node`, usa __dirname (ver `dirDeConfigFora`).
 */
function configDir() {
  try {
    // eslint-disable-next-line global-require
    const sea = require('node:sea');
    if (typeof sea.isSea === 'function' && sea.isSea()) {
      return path.dirname(process.execPath);
    }
  } catch {
    /* node:sea não existe em Node antigo — segue com __dirname */
  }
  return dirDeConfigFora(__dirname);
}

/**
 * Lê um JSON de `configDir()/nome`. Devolve `padrao` se o arquivo não existe
 * ainda (primeiro boot) ou está corrompido — nunca lança.
 */
function lerJson(nome, padrao) {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir(), nome), 'utf8'));
  } catch {
    return padrao;
  }
}

/**
 * Grava um JSON em `configDir()/nome` de forma atômica: escreve em
 * `nome.tmp` e renomeia por cima do destino. Um processo morto no meio da
 * escrita deixa o `.tmp` incompleto, mas o arquivo final ANTERIOR continua
 * íntegro (rename é atômico no SO) — um `writeFileSync` direto interrompido
 * no meio, em vez disso, corrompe o arquivo do qual os drivers dependem para
 * não reprocessar (ou pular) histórico de acesso.
 */
function gravarJsonAtomico(nome, obj) {
  const destino = path.join(configDir(), nome);
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, destino);
}

// ---------- Marca d'água (baseline) de cada device ----------

const BASELINES_FILE = 'device-baselines.json';

// deviceId → maior RecNo/serialNo/ID de log de acesso já processado no
// dispositivo. Persistido em disco: sem isso, reiniciar o agente zerava a
// marca d'água e o primeiro reconnect reprocessava (ou pulava) o histórico
// inteiro.
const deviceBaselines = new Map();

function baselinesPath() {
  return path.join(configDir(), BASELINES_FILE);
}

function loadBaselines() {
  const obj = lerJson(BASELINES_FILE, {});
  for (const [k, v] of Object.entries(obj)) deviceBaselines.set(Number(k), v);
}

function setBaseline(deviceId, val) {
  deviceBaselines.set(deviceId, val);
  try {
    gravarJsonAtomico(BASELINES_FILE, Object.fromEntries(deviceBaselines));
  } catch (e) {
    console.error(`[agente] falha ao salvar baseline: ${e.message || e}`);
  }
}

module.exports = {
  configDir,
  dirDeConfigFora,
  lerJson,
  gravarJsonAtomico,
  deviceBaselines,
  baselinesPath,
  loadBaselines,
  setBaseline,
};
