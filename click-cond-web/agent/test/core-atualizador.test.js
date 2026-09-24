'use strict';

/**
 * agent/src/core/atualizador.js — auto-atualização (tarefa 8): comparação de
 * versões, download com checagem de SHA-256, troca de arquivos e o
 * protocolo de rollback (atualizacao.json + tentativas). Tudo roda num
 * diretório temporário com um servidor HTTP local — nunca toca em arquivo
 * real nem em rede real (ver comentário de testabilidade no próprio módulo).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const { compararVersoes, baixarArquivo, criarAtualizador, ARQ_ATUALIZACAO } = require('../src/core/atualizador');
const { AGENT_VERSION } = require('../src/versao');
const { request } = require('../src/lib/http');

// ---------- compararVersoes ----------

test('compararVersoes(): mesma versão é 0', () => {
  assert.equal(compararVersoes('2026.09.24', '2026.09.24'), 0);
});

test('compararVersoes(): segmento faltando conta como 0 (2026.09.24 == 2026.09.24.0)', () => {
  assert.equal(compararVersoes('2026.09.24', '2026.09.24.0'), 0);
  assert.equal(compararVersoes('2026.09.24.0', '2026.09.24'), 0);
});

test('compararVersoes(): compara numericamente, não como string (10 > 9)', () => {
  assert.equal(compararVersoes('2026.09.10', '2026.09.9'), 1);
  assert.equal(compararVersoes('2026.09.9', '2026.09.10'), -1);
});

test('compararVersoes(): dia maior vence', () => {
  assert.ok(compararVersoes('2026.09.25', '2026.09.24') > 0);
  assert.ok(compararVersoes('2026.09.24', '2026.09.25') < 0);
});

test('compararVersoes(): sufixo .N desempata quando o resto é igual', () => {
  assert.ok(compararVersoes('2026.09.24.1', '2026.09.24') > 0);
  assert.ok(compararVersoes('2026.09.24', '2026.09.24.1') < 0);
});

// ---------- baixarArquivo ----------

// Transporte fake: fala com o servidor de teste por HTTP de verdade, mas
// aceita URLs "https://" (é o que baixarArquivo exige) — só troca o esquema
// na hora de chamar http.get. Assim reaproveita a função de produção de
// verdade (redirecionamento, streaming) sem precisar de certificado TLS.
const transporteViaHttp = {
  get: (url, opts, cb) => http.get(url.replace(/^https:/, 'http:'), cb),
};

function comServidorHttp(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `https://127.0.0.1:${port}`, // esquema falso — o shim troca por http
        fechar: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// `verificar()` faz DUAS chamadas contra o mesmo servidor de teste: a
// consulta de versão (via `request()` genérico da lib/http — precisa de uma
// URL http:// de verdade) e o download do binário (via `baixarArquivo` +
// `transporteViaHttp` — precisa de uma URL "https://", que o shim troca de
// volta por http por baixo dos panos). Por isso este helper devolve as duas
// formas da mesma origem.
function comServidorReal(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        urlHttps: `https://127.0.0.1:${port}`,
        fechar: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function dirTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'click-agente-atualizador-'));
}

test('baixarArquivo(): recusa URL não-HTTPS antes de abrir qualquer conexão', async () => {
  const destino = path.join(dirTemp(), 'saida.bin');
  await assert.rejects(
    baixarArquivo('http://127.0.0.1:1/arquivo', destino, { transporte: transporteViaHttp }),
    /HTTPS/,
  );
  assert.equal(fs.existsSync(destino), false);
});

test('baixarArquivo(): baixa o conteúdo certo, seguindo um redirecionamento', async () => {
  const conteudo = Buffer.from('conteudo-do-exe-de-teste-12345');
  const { url, fechar } = await comServidorHttp((req, res) => {
    if (req.url === '/primeiro') {
      res.writeHead(302, { Location: '/final' });
      res.end();
      return;
    }
    if (req.url === '/final') {
      res.writeHead(200);
      res.end(conteudo);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const destino = path.join(dirTemp(), 'saida.bin');
    await baixarArquivo(`${url}/primeiro`, destino, { transporte: transporteViaHttp });
    assert.deepEqual(fs.readFileSync(destino), conteudo);
  } finally {
    await fechar();
  }
});

test('baixarArquivo(): estoura o limite de redirecionamentos', async () => {
  const { url, fechar } = await comServidorHttp((req, res) => {
    res.writeHead(302, { Location: req.url }); // redireciona para si mesmo — loop infinito
    res.end();
  });
  try {
    const destino = path.join(dirTemp(), 'saida.bin');
    await assert.rejects(
      baixarArquivo(`${url}/loop`, destino, { transporte: transporteViaHttp, maxRedirects: 2 }),
      /redirecionamento/,
    );
  } finally {
    await fechar();
  }
});

test('baixarArquivo(): HTTP diferente de 200/3xx rejeita', async () => {
  const { url, fechar } = await comServidorHttp((req, res) => {
    res.writeHead(404);
    res.end('não achei');
  });
  try {
    const destino = path.join(dirTemp(), 'saida.bin');
    await assert.rejects(
      baixarArquivo(`${url}/nada`, destino, { transporte: transporteViaHttp }),
      /404/,
    );
  } finally {
    await fechar();
  }
});

// ---------- criarAtualizador(): fixture de diretório temporário ----------

/** Monta um atualizador de teste: diretório temporário isolado, exe falso já
 *  no lugar (com o conteúdo `conteudoExeAtual`), `sair` é um espião (nunca
 *  mata o processo de teste) e `log` captura as mensagens em vez de sujar a
 *  saída do `node --test`. */
function montarFixture({ isSea = true, conteudoExeAtual = 'binario-atual' } = {}) {
  const dir = dirTemp();
  const caminhoExeVal = path.join(dir, 'click-agent.exe');
  fs.writeFileSync(caminhoExeVal, conteudoExeAtual);
  const saidas = [];
  const logs = { log: [], error: [] };
  const logger = {
    log: (m) => logs.log.push(m),
    error: (m) => logs.error.push(m),
  };
  const atualizador = criarAtualizador({
    isSea: () => isSea,
    diretorio: () => dir,
    caminhoExe: () => caminhoExeVal,
    sair: (codigo) => saidas.push(codigo),
    log: logger,
  });
  return { dir, caminhoExeVal, saidas, logs, logger, atualizador };
}

function lerAtualizacaoJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ARQ_ATUALIZACAO), 'utf8'));
}

// ---------- verificarInicializacao() / confirmarSucesso(): rollback ----------

test('verificarInicializacao(): sem atualizacao.json, não faz nada', () => {
  const f = montarFixture();
  f.atualizador.verificarInicializacao();
  assert.equal(f.saidas.length, 0);
});

test('verificarInicializacao(): atualizacao.json de outra versão (não é a que está rodando) é ignorado', () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2020.01.01', para: '2020.01.02', tentativas: 1 }),
  );
  f.atualizador.verificarInicializacao();
  assert.equal(f.saidas.length, 0);
  assert.deepEqual(lerAtualizacaoJson(f.dir), { de: '2020.01.01', para: '2020.01.02', tentativas: 1 });
});

test('verificarInicializacao(): incrementa tentativas a cada partida até 3, depois reverte', () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2026.01.01', para: AGENT_VERSION, tentativas: 0 }),
  );
  // Precisa existir para a reversão devolver o exe antigo.
  fs.writeFileSync(path.join(f.dir, 'click-agent.old.exe'), 'binario-antigo');

  f.atualizador.verificarInicializacao();
  assert.equal(lerAtualizacaoJson(f.dir).tentativas, 1);
  assert.equal(f.saidas.length, 0, 'não reverte ainda (1ª tentativa)');

  f.atualizador.verificarInicializacao();
  assert.equal(lerAtualizacaoJson(f.dir).tentativas, 2);
  assert.equal(f.saidas.length, 0, 'não reverte ainda (2ª tentativa)');

  f.atualizador.verificarInicializacao();
  // 3ª tentativa: reverte — apaga o json, exe atual vira .bad.exe, .old.exe volta a ser o exe.
  assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), false);
  assert.equal(fs.readFileSync(f.caminhoExeVal, 'utf8'), 'binario-antigo');
  assert.equal(fs.readFileSync(path.join(f.dir, 'click-agent.bad.exe'), 'utf8'), 'binario-atual');
  assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.old.exe')), false);
  assert.deepEqual(f.saidas, [0]);
});

test('verificarInicializacao(): fora de SEA não mexe em nada, mesmo com json de rollback pendente', () => {
  const f = montarFixture({ isSea: false });
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2026.01.01', para: AGENT_VERSION, tentativas: 2 }),
  );
  f.atualizador.verificarInicializacao();
  assert.equal(lerAtualizacaoJson(f.dir).tentativas, 2, 'não incrementou');
  assert.equal(f.saidas.length, 0);
});

test('confirmarSucesso(): apaga atualizacao.json quando existe', () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2026.01.01', para: AGENT_VERSION, tentativas: 1 }),
  );
  f.atualizador.confirmarSucesso();
  assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), false);
});

test('confirmarSucesso(): sem json pendente, não lança', () => {
  const f = montarFixture();
  assert.doesNotThrow(() => f.atualizador.confirmarSucesso());
});

test('confirmarSucesso(): fora de SEA não apaga (nem tenta)', () => {
  const f = montarFixture({ isSea: false });
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2026.01.01', para: AGENT_VERSION, tentativas: 1 }),
  );
  f.atualizador.confirmarSucesso();
  assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), true);
});

// ---------- verificar(): consulta + download + troca ----------

/** buscarVersao/baixar de teste: consulta e download apontam para o mesmo
 *  servidor local (a rota /versao devolve a URL do binário já resolvida). */
function depsHttpDoServidor(baseUrl) {
  return {
    buscarVersao: async (token) => {
      const res = await request(`${baseUrl}/api/facial/agent/condo/${token}/versao`);
      return res.data;
    },
    baixar: (urlStr, destino) => baixarArquivo(urlStr, destino, { transporte: transporteViaHttp }),
  };
}

test('verificar(): sem versão nova (igual à atual), não baixa nada', async () => {
  const f = montarFixture();
  const { url, urlHttps, fechar } = await comServidorReal((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ versao: AGENT_VERSION, url: `${urlHttps}/click-agent.exe`, sha256: 'x' }));
  });
  try {
    const at = criarAtualizador({
      isSea: () => true,
      diretorio: () => f.dir,
      caminhoExe: () => f.caminhoExeVal,
      sair: (c) => f.saidas.push(c),
      log: f.logger,
      ...depsHttpDoServidor(url),
    });
    await at.verificar('token-x');
    assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.new.exe')), false);
    assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), false);
    assert.equal(f.saidas.length, 0);
  } finally {
    await fechar();
  }
});

test('verificar(): fora de SEA não consulta nem baixa nada', async () => {
  const f = montarFixture({ isSea: false });
  let consultou = false;
  const at = criarAtualizador({
    isSea: () => false,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    buscarVersao: async () => {
      consultou = true;
      return { versao: '9999.01.01', url: 'https://exemplo/click-agent.exe', sha256: 'x' };
    },
  });
  await at.verificar('token-x');
  assert.equal(consultou, false);
  assert.equal(f.saidas.length, 0);
});

test('verificar(): falha ao consultar a nuvem não lança e não faz nada', async () => {
  const f = montarFixture();
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    buscarVersao: async () => {
      throw new Error('nuvem fora do ar');
    },
  });
  await assert.doesNotReject(at.verificar('token-x'));
  assert.equal(f.saidas.length, 0);
});

test('verificar(): hash divergente é descartado, sem trocar arquivos', async () => {
  const f = montarFixture();
  const conteudoExe = Buffer.from('conteudo-novo-exe');
  const { url, urlHttps, fechar } = await comServidorReal((req, res) => {
    if (req.url.endsWith('/versao')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          versao: '9999.01.01',
          url: `${urlHttps}/click-agent.exe`,
          sha256: 'hash-errado-de-proposito',
        }),
      );
      return;
    }
    if (req.url === '/click-agent.exe') {
      res.writeHead(200);
      res.end(conteudoExe);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const at = criarAtualizador({
      isSea: () => true,
      diretorio: () => f.dir,
      caminhoExe: () => f.caminhoExeVal,
      sair: (c) => f.saidas.push(c),
      log: f.logger,
      ...depsHttpDoServidor(url),
    });
    await at.verificar('token-x');
    assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.new.exe')), false, 'arquivo baixado foi descartado');
    assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), false, 'não gravou atualizacao.json');
    assert.equal(fs.readFileSync(f.caminhoExeVal, 'utf8'), 'binario-atual', 'exe atual não foi trocado');
    assert.equal(f.saidas.length, 0);
    assert.ok(f.logs.error.some((m) => m.includes('hash')), JSON.stringify(f.logs.error));
  } finally {
    await fechar();
  }
});

test('verificar(): versão nova com hash certo troca os arquivos e sai(0)', async () => {
  const f = montarFixture();
  const conteudoExe = Buffer.from('conteudo-novo-exe-valido');
  const shaCorreto = crypto.createHash('sha256').update(conteudoExe).digest('hex');
  const { url, urlHttps, fechar } = await comServidorReal((req, res) => {
    if (req.url.endsWith('/versao')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          versao: '9999.01.01',
          url: `${urlHttps}/click-agent.exe`,
          sha256: shaCorreto.toUpperCase(),
        }),
      );
      return;
    }
    if (req.url === '/click-agent.exe') {
      res.writeHead(200);
      res.end(conteudoExe);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const at = criarAtualizador({
      isSea: () => true,
      diretorio: () => f.dir,
      caminhoExe: () => f.caminhoExeVal,
      sair: (c) => f.saidas.push(c),
      log: f.logger,
      ...depsHttpDoServidor(url),
    });
    await at.verificar('token-x');

    assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.new.exe')), false, 'renomeado, não sobra new.exe');
    assert.deepEqual(fs.readFileSync(f.caminhoExeVal), conteudoExe, 'exe atual agora é o binário novo');
    assert.equal(
      fs.readFileSync(path.join(f.dir, 'click-agent.old.exe'), 'utf8'),
      'binario-atual',
      'exe antigo foi preservado como .old.exe',
    );
    assert.deepEqual(lerAtualizacaoJson(f.dir), {
      de: AGENT_VERSION,
      para: '9999.01.01',
      tentativas: 0,
    });
    assert.deepEqual(f.saidas, [0]);
  } finally {
    await fechar();
  }
});
