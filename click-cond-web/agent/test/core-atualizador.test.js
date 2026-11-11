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

const {
  compararVersoes,
  baixarArquivo,
  criarAtualizador,
  ARQ_ATUALIZACAO,
  ARQ_VERSAO_RECUSADA,
  NOME_LACO_SERVICO,
  motivoUrlRecusada,
  erroParaEstado,
} = require('../src/core/atualizador');
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
 *  saída do `node --test`. Por padrão já cria `run-agent-service.cmd` com
 *  `goto loop` ao lado do exe (Important 2 da revisão: sem esse arquivo,
 *  `verificar()` recusa a troca) — passe `comLacoDeReinicio: false` para
 *  testar justamente essa recusa. `renomear` é injetável para simular falha
 *  no meio de uma troca de arquivos (Critical 2). */
function montarFixture({
  isSea = true,
  conteudoExeAtual = 'binario-atual',
  comLacoDeReinicio = true,
  renomear,
  apiUrl,
} = {}) {
  const dir = dirTemp();
  const caminhoExeVal = path.join(dir, 'click-agent.exe');
  fs.writeFileSync(caminhoExeVal, conteudoExeAtual);
  if (comLacoDeReinicio) {
    fs.writeFileSync(path.join(dir, NOME_LACO_SERVICO), '@echo off\n:loop\nclick-agent.exe\ngoto loop\n');
  }
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
    ...(renomear ? { renomear } : {}),
    ...(apiUrl ? { apiUrl } : {}),
  });
  return { dir, caminhoExeVal, saidas, logs, logger, atualizador };
}

function lerAtualizacaoJson(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ARQ_ATUALIZACAO), 'utf8'));
}

function lerVersaoRecusada(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, ARQ_VERSAO_RECUSADA), 'utf8'));
}

// ---------- verificarInicializacao() / confirmarSucesso(): rollback ----------

test('verificarInicializacao(): sem atualizacao.json, não faz nada', () => {
  const f = montarFixture();
  f.atualizador.verificarInicializacao();
  assert.equal(f.saidas.length, 0);
});

test('verificarInicializacao(): atualizacao.json que não bate com a versão rodando é descartado e marcado como recusado (Important 1)', () => {
  // Sintoma de um release que esqueceu de atualizar AGENT_VERSION: o
  // atualizacao.json.para não é a versão que está rodando agora. Sem
  // marcar como recusada, verificar() tentaria baixar essa "mesma" versão
  // pra sempre (a nuvem nunca vai anunciar outra coisa).
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2020.01.01', para: '2020.01.02', tentativas: 1 }),
  );
  f.atualizador.verificarInicializacao();
  assert.equal(f.saidas.length, 0);
  assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), false, 'json descartado');
  assert.deepEqual(lerVersaoRecusada(f.dir).versao, '2020.01.02');
  assert.ok(
    f.logs.error.some((m) => m.includes('2020.01.02') && m.includes(AGENT_VERSION)),
    JSON.stringify(f.logs.error),
  );
});

test('verificarInicializacao(): exe ANTIGO restaurado pelo laço de serviço (versão nova caía antes de main) marca a nova como recusada (I5)', () => {
  // O run-agent-service.cmd, depois de 3 saídas != 0 com atualizacao.json
  // presente, troca os arquivos (exe → .bad.exe, .old.exe → exe) e deixa o
  // atualizacao.json no lugar. Quem sobe agora é o exe antigo (esta
  // versão, AGENT_VERSION = `de`), que tem de reconhecer que `para` foi
  // revertida e nunca mais baixá-la.
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: AGENT_VERSION, para: '9999.12.31', tentativas: 0 }),
  );
  f.atualizador.verificarInicializacao();
  assert.equal(f.saidas.length, 0, 'segue rodando normalmente (é a versão boa)');
  assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), false, 'json consumido');
  assert.equal(lerVersaoRecusada(f.dir).versao, '9999.12.31');
  assert.ok(
    f.logs.error.some((m) => m.includes('9999.12.31') && m.includes('revertida pelo laço de serviço')),
    JSON.stringify(f.logs.error),
  );
});

test('verificar(): depois do rollback pelo laço de serviço, a versão revertida não é baixada de novo (I5)', async () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: AGENT_VERSION, para: '9999.12.31', tentativas: 0 }),
  );
  let baixou = false;
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    buscarVersao: async () => ({ versao: '9999.12.31', url: 'https://x/y', sha256: 'a'.repeat(64) }),
    baixar: async () => {
      baixou = true;
    },
  });
  at.verificarInicializacao();
  await at.verificar('token-x');
  assert.equal(baixou, false);
  assert.equal(at.temReinicioPendente(), false);
});

test('verificarInicializacao(): compara versão NUMERICAMENTE, não como string ("para" com sufixo .0 ainda é a versão rodando)', () => {
  // Important 1: era `estado.para !== AGENT_VERSION` (string estrita) — uma
  // versão escrita como "AGENT_VERSION.0" é a MESMA versão e devia ser
  // tratada como tal (incrementa tentativas), não como incoerência.
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2020.01.01', para: `${AGENT_VERSION}.0`, tentativas: 0 }),
  );
  f.atualizador.verificarInicializacao();
  assert.equal(lerAtualizacaoJson(f.dir).tentativas, 1, 'reconheceu como a mesma versão e incrementou');
  assert.equal(fs.existsSync(path.join(f.dir, ARQ_VERSAO_RECUSADA)), false);
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
  // Critical 3: a versão rejeitada fica marcada, pra verificar() nunca mais
  // tentar baixá-la de novo enquanto a nuvem continuar oferecendo ela.
  assert.equal(lerVersaoRecusada(f.dir).versao, AGENT_VERSION);
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

test('verificarInicializacao(): reversão incompleta (2º rename falha) desfaz o 1º — nunca fica sem click-agent.exe (Critical 2)', () => {
  const f = montarFixture({
    // 1º rename (exe atual → .bad.exe) funciona; o 2º (.old.exe → exe) falha
    // de propósito — simula disco cheio/antivírus travando no meio da troca.
    renomear: (() => {
      let chamadas = 0;
      return (de, para) => {
        chamadas += 1;
        if (chamadas === 2) throw new Error('EBUSY: simulado');
        fs.renameSync(de, para);
      };
    })(),
  });
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2026.01.01', para: AGENT_VERSION, tentativas: 2 }),
  );
  fs.writeFileSync(path.join(f.dir, 'click-agent.old.exe'), 'binario-antigo');

  f.atualizador.verificarInicializacao();

  // O exe NUNCA pode sumir do disco: o 1º rename (exe → bad.exe) foi
  // desfeito assim que o 2º falhou.
  assert.equal(fs.readFileSync(f.caminhoExeVal, 'utf8'), 'binario-atual', 'exe original restaurado');
  assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.bad.exe')), false, 'bad.exe desfeito');
  assert.ok(
    f.logs.error.some((m) => m.includes('falha ao reverter')),
    JSON.stringify(f.logs.error),
  );
});

test('verificarInicializacao(): loga quando o exe sumiu mas .old.exe existe (self-heal — Critical 2)', () => {
  const f = montarFixture();
  fs.unlinkSync(f.caminhoExeVal); // simula: troca anterior renomeou o exe pra .old mas nunca completou
  fs.writeFileSync(path.join(f.dir, 'click-agent.old.exe'), 'binario-antigo');

  f.atualizador.verificarInicializacao();

  assert.ok(
    f.logs.error.some((m) => m.includes('click-agent.old.exe') || m.includes('não existe')),
    JSON.stringify(f.logs.error),
  );
  assert.equal(f.saidas.length, 0, 'só loga — não mexe em arquivo sozinho (Task 9 cuida do .cmd)');
});

test('verificarInicializacao(): nunca lança mesmo se uma dependência falhar inesperadamente (Important 4)', () => {
  const f = montarFixture();
  const atualizadorFragil = criarAtualizador({
    isSea: () => true,
    diretorio: () => {
      throw new Error('disco corrompido, simulado');
    },
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
  });
  assert.doesNotThrow(() => atualizadorFragil.verificarInicializacao());
  assert.ok(
    f.logs.error.some((m) => m.includes('falha inesperada')),
    JSON.stringify(f.logs.error),
  );
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

test('confirmarSucesso(): versão rodando não bate com atualizacao.json.para — marca como recusada, não re-tenta (Important 1)', () => {
  // Poll confirmou (a versão fala com a nuvem), mas AGENT_VERSION não é a
  // esperada — sintoma de release sem bump de versão. Sem marcar como
  // recusada, verificar() ia tentar baixar essa "mesma" versão de novo a
  // cada 6h, pra sempre.
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2020.01.01', para: '2020.01.02', tentativas: 0 }),
  );
  f.atualizador.confirmarSucesso();
  assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), false);
  assert.equal(lerVersaoRecusada(f.dir).versao, '2020.01.02');
  assert.ok(f.logs.error.some((m) => m.includes('2020.01.02')), JSON.stringify(f.logs.error));
});

test('confirmarSucesso(): nunca lança mesmo se uma dependência falhar inesperadamente (Important 4)', () => {
  const f = montarFixture();
  const atualizadorFragil = criarAtualizador({
    isSea: () => true,
    diretorio: () => {
      throw new Error('disco corrompido, simulado');
    },
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
  });
  assert.doesNotThrow(() => atualizadorFragil.confirmarSucesso());
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

test('verificar(): versão nova com hash certo troca os arquivos e sai(0) — só quando o laço de poll pede (fim do ciclo)', async () => {
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
    // M3 da revisão final: verificar() roda em paralelo ao laço de poll —
    // sair() aqui cortaria um enroll em curso. Só marca e espera o laço.
    assert.equal(f.saidas.length, 0, 'não sai no meio de um possível comando em curso');
    assert.equal(at.temReinicioPendente(), true);
    assert.equal(at.sairSeReinicioPendente(), true, 'o laço de poll pede a saída no fim da iteração');
    assert.deepEqual(f.saidas, [0]);
    assert.equal(at.temReinicioPendente(), false);
    assert.equal(at.sairSeReinicioPendente(), false, 'segunda chamada não sai de novo');
    assert.deepEqual(f.saidas, [0]);
  } finally {
    await fechar();
  }
});

test('verificar(): troca incompleta (2º rename falha) desfaz o 1º — nunca fica sem click-agent.exe (Critical 2)', async () => {
  const f = montarFixture();
  // 1º rename (exe atual → .old.exe) funciona; o 2º (novo → exe) falha —
  // simula permissão/antivírus travando bem no meio da troca.
  let chamadas = 0;
  const renomear = (de, para) => {
    chamadas += 1;
    if (chamadas === 2) throw new Error('EACCES: simulado');
    fs.renameSync(de, para);
  };
  const conteudoExe = Buffer.from('conteudo-novo-exe-valido');
  const shaCorreto = crypto.createHash('sha256').update(conteudoExe).digest('hex');
  const { url, urlHttps, fechar } = await comServidorReal((req, res) => {
    if (req.url.endsWith('/versao')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ versao: '9999.01.01', url: `${urlHttps}/click-agent.exe`, sha256: shaCorreto }));
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
      renomear,
      ...depsHttpDoServidor(url),
    });
    await at.verificar('token-x');

    assert.equal(fs.readFileSync(f.caminhoExeVal, 'utf8'), 'binario-atual', 'exe original restaurado, nunca sumiu');
    assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.old.exe')), false, '.old.exe desfeito de volta');
    assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), false, 'não deixa atualizacao.json órfão');
    assert.equal(f.saidas.length, 0, 'não reiniciou numa troca que não completou');
    assert.ok(f.logs.error.some((m) => m.includes('falha ao trocar o executável')), JSON.stringify(f.logs.error));
  } finally {
    await fechar();
  }
});

test('verificar(): sem laço de reinício (run-agent-service.cmd sem "goto loop") pula a troca e loga (Important 2)', async () => {
  const f = montarFixture({ comLacoDeReinicio: false });
  const conteudoExe = Buffer.from('conteudo-novo-exe-valido');
  const shaCorreto = crypto.createHash('sha256').update(conteudoExe).digest('hex');
  const { url, urlHttps, fechar } = await comServidorReal((req, res) => {
    if (req.url.endsWith('/versao')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ versao: '9999.01.01', url: `${urlHttps}/click-agent.exe`, sha256: shaCorreto }));
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
    assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.new.exe')), false, 'nem chegou a baixar');
    assert.equal(fs.readFileSync(f.caminhoExeVal, 'utf8'), 'binario-atual', 'exe não trocado');
    assert.equal(f.saidas.length, 0);
    assert.ok(f.logs.error.some((m) => m.includes('laço de reinício')), JSON.stringify(f.logs.error));
  } finally {
    await fechar();
  }
});

test('verificar(): com run-agent-service.cmd tendo o laço, procede normalmente (Important 2, caminho feliz)', async () => {
  // Mesmo cenário da troca bem-sucedida, só confirmando que
  // `comLacoDeReinicio: true` (default) não é o motivo de nenhum dos testes
  // anteriores "passarem à toa".
  const f = montarFixture({ comLacoDeReinicio: true });
  assert.ok(fs.readFileSync(path.join(f.dir, NOME_LACO_SERVICO), 'utf8').includes('goto loop'));
});

// ---------- versao-recusada.json: nunca reoferecer uma versão já revertida (Critical 3) ----------

test('verificar(): versão já rejeitada antes (rollback) não é baixada de novo, mesmo se a nuvem continuar oferecendo', async () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_VERSAO_RECUSADA),
    JSON.stringify({ versao: '9999.01.01', em: new Date().toISOString() }),
  );
  let baixouAlgo = false;
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    buscarVersao: async () => ({
      versao: '9999.01.01',
      url: 'https://github.com/click-agent.exe',
      sha256: 'a'.repeat(64),
    }),
    baixar: async () => {
      baixouAlgo = true;
    },
  });
  await at.verificar('token-x');
  assert.equal(baixouAlgo, false, 'nem tentou baixar');
  assert.equal(f.saidas.length, 0);
  assert.ok(
    f.logs.error.some((m) => m.includes('já foi tentada e revertida')),
    JSON.stringify(f.logs.error),
  );
});

test('verificar(): versão MENOR OU IGUAL à rejeitada continua bloqueada; MAIS NOVA que ela é baixada normalmente', async () => {
  const f = montarFixture();
  fs.writeFileSync(path.join(f.dir, ARQ_VERSAO_RECUSADA), JSON.stringify({ versao: '2000.01.01', em: 'x' }));
  const conteudoExe = Buffer.from('conteudo-novo-pos-rejeicao');
  const shaCorreto = crypto.createHash('sha256').update(conteudoExe).digest('hex');
  const { url, urlHttps, fechar } = await comServidorReal((req, res) => {
    if (req.url.endsWith('/versao')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // 2026.12.01 é maior que a rejeitada (2000.01.01) — tem que passar.
      res.end(JSON.stringify({ versao: '2026.12.01', url: `${urlHttps}/click-agent.exe`, sha256: shaCorreto }));
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
    assert.equal(at.temReinicioPendente(), true, 'versão mais nova que a rejeitada passou normalmente');
    at.sairSeReinicioPendente();
    assert.deepEqual(f.saidas, [0]);
    assert.deepEqual(fs.readFileSync(f.caminhoExeVal), conteudoExe);
  } finally {
    await fechar();
  }
});

test('verificar(): loga o aviso de versão rejeitada só uma vez, mesmo chamando duas vezes seguidas', async () => {
  const f = montarFixture();
  fs.writeFileSync(path.join(f.dir, ARQ_VERSAO_RECUSADA), JSON.stringify({ versao: '9999.01.01', em: 'x' }));
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    buscarVersao: async () => ({
      versao: '9999.01.01',
      url: 'https://github.com/click-agent.exe',
      sha256: 'a'.repeat(64),
    }),
    baixar: async () => {},
  });
  await at.verificar('token-x');
  await at.verificar('token-x');
  const avisos = f.logs.error.filter((m) => m.includes('já foi tentada e revertida'));
  assert.equal(avisos.length, 1, JSON.stringify(f.logs.error));
});

// ---------- host allowlist do download (Critical 1) ----------

test('baixarArquivo(): recusa URL que o validador recusa, antes de conectar', async () => {
  const destino = path.join(dirTemp(), 'saida.bin');
  await assert.rejects(
    baixarArquivo('https://evil.example.com/click-agent.exe', destino, {
      validarUrl: (url) => motivoUrlRecusada(url, { inicial: true }),
    }),
    /host não permitido/,
  );
  assert.equal(fs.existsSync(destino), false);
});

test('motivoUrlRecusada(): github.com só aceita releases agent-v* do repositório do agente (I6)', () => {
  const ok = (u, inicial = true) => motivoUrlRecusada(u, { inicial, hostApi: 'api.clickprestarecondominios.com.br' });
  // Os dois nomes do dono que a conta já teve (e sem diferenciar maiúsculas,
  // como o próprio GitHub).
  assert.equal(ok('https://github.com/Viniciusvile/Click-Prestare/releases/download/agent-v2026.09.25/click-agent.exe'), null);
  assert.equal(ok('https://github.com/ViniciusVilelaRufini/Click-Prestare/releases/download/agent-v2026.09.25/click-agent.exe'), null);
  assert.equal(ok('https://github.com/viniciusvile/click-prestare/releases/download/agent-v2026.09.25/click-agent.exe'), null);
  // Outro repositório, outra tag, ou outro caminho do nosso: recusados.
  assert.match(ok('https://github.com/atacante/Click-Prestare/releases/download/agent-v2026.09.25/click-agent.exe'), /caminho não permitido/);
  assert.match(ok('https://github.com/Viniciusvile/Outro-Repo/releases/download/agent-v1/click-agent.exe'), /caminho não permitido/);
  assert.match(ok('https://github.com/Viniciusvile/Click-Prestare/releases/download/v2026.09.25/click-agent.exe'), /caminho não permitido/);
  assert.match(ok('https://github.com/Viniciusvile/Click-Prestare/raw/master/click-agent.exe'), /caminho não permitido/);
  // "../" não fura o prefixo: o parser de URL normaliza antes da checagem.
  assert.match(
    ok('https://github.com/Viniciusvile/Click-Prestare/releases/download/agent-v1/../../../../atacante/x/releases/download/agent-v1/a.exe'),
    /caminho não permitido/,
  );
  // Nem subdomínio nem host parecido.
  assert.match(ok('https://github.com.evil.example/Viniciusvile/Click-Prestare/releases/download/agent-v1/a.exe'), /host não permitido/);
});

test('motivoUrlRecusada(): CDN de assets do GitHub só como redirecionamento, nunca como URL inicial (I6)', () => {
  for (const host of ['objects.githubusercontent.com', 'release-assets.githubusercontent.com']) {
    const url = `https://${host}/github-production-release-asset/123/abc?x=1`;
    assert.match(motivoUrlRecusada(url, { inicial: true }), /só como redirecionamento/, host);
    assert.equal(motivoUrlRecusada(url, { inicial: false }), null, host);
  }
});

test('motivoUrlRecusada(): host da própria API continua permitido (inicial e hop)', () => {
  const hostApi = 'api.clickprestarecondominios.com.br';
  assert.equal(motivoUrlRecusada(`https://${hostApi}/downloads/click-agent.exe`, { inicial: true, hostApi }), null);
  assert.equal(motivoUrlRecusada(`https://${hostApi}/downloads/click-agent.exe`, { inicial: false, hostApi }), null);
  assert.match(motivoUrlRecusada('https://evil.example.com/a.exe', { inicial: true, hostApi }), /host não permitido/);
  assert.match(motivoUrlRecusada('https://evil.example.com/a.exe', { inicial: true }), /host não permitido/);
});

test('baixarArquivo(): recusa origem fora da allowlist também no hop de redirecionamento', async () => {
  const { url, fechar } = await comServidorHttp((req, res) => {
    res.writeHead(302, { Location: 'https://evil.example.com/final' });
    res.end();
  });
  try {
    const destino = path.join(dirTemp(), 'saida.bin');
    await assert.rejects(
      baixarArquivo(`${url}/primeiro`, destino, {
        transporte: transporteViaHttp,
        validarUrl: (u, { inicial }) => motivoUrlRecusada(u, { inicial, hostApi: '127.0.0.1' }),
      }),
      /host não permitido: evil\.example\.com/,
    );
  } finally {
    await fechar();
  }
});

test('baixarArquivo(): o validador recebe inicial=true só na 1ª URL e false nos hops', async () => {
  const { url, fechar } = await comServidorHttp((req, res) => {
    if (req.url === '/a') {
      res.writeHead(302, { Location: '/b' });
      res.end();
      return;
    }
    res.writeHead(200);
    res.end('ok');
  });
  try {
    const vistas = [];
    await baixarArquivo(`${url}/a`, path.join(dirTemp(), 'saida.bin'), {
      transporte: transporteViaHttp,
      validarUrl: (u, { inicial }) => {
        vistas.push([new URL(u).pathname, inicial]);
        return null;
      },
    });
    assert.deepEqual(vistas, [['/a', true], ['/b', false]]);
  } finally {
    await fechar();
  }
});

test('baixarArquivo(): host presente na allowlist passa normalmente', async () => {
  const conteudo = Buffer.from('ok-dentro-da-allowlist');
  const { url, fechar } = await comServidorHttp((req, res) => {
    res.writeHead(200);
    res.end(conteudo);
  });
  try {
    const destino = path.join(dirTemp(), 'saida.bin');
    await baixarArquivo(url, destino, {
      transporte: transporteViaHttp,
      validarUrl: (u, { inicial }) => motivoUrlRecusada(u, { inicial, hostApi: '127.0.0.1' }),
    });
    assert.deepEqual(fs.readFileSync(destino), conteudo);
  } finally {
    await fechar();
  }
});

test('verificar(): com o baixar padrão, asset de OUTRO repositório do github.com é recusado sem conectar (I6)', async () => {
  const f = montarFixture();
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    apiUrl: () => 'https://api.clickprestarecondominios.com.br',
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    buscarVersao: async () => ({
      versao: '9999.01.01',
      url: 'https://github.com/atacante/malware/releases/download/agent-v9999.01.01/click-agent.exe',
      sha256: 'a'.repeat(64),
    }),
  });
  await at.verificar('token-x');
  assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.new.exe')), false);
  assert.equal(at.temReinicioPendente(), false);
  assert.ok(
    f.logs.error.some((m) => m.includes('falha ao baixar atualização') && m.includes('caminho não permitido')),
    JSON.stringify(f.logs.error),
  );
});

test('verificar(): com o baixar padrão (sem override), recusa host fora da allowlist sem tentar conectar', async () => {
  const f = montarFixture();
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    apiUrl: () => 'https://api.clickprestarecondominios.com.br',
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    buscarVersao: async () => ({
      versao: '9999.01.01',
      url: 'https://evil.example.com/click-agent.exe',
      sha256: 'a'.repeat(64),
    }),
    // `baixar` NÃO é sobrescrito aqui: usa o wrapper padrão de
    // criarAtualizador, que aplica motivoUrlRecusada() de verdade.
  });
  await at.verificar('token-x');
  assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.new.exe')), false);
  assert.equal(f.saidas.length, 0);
  assert.ok(
    f.logs.error.some((m) => m.includes('falha ao baixar atualização') && m.includes('host não permitido')),
    JSON.stringify(f.logs.error),
  );
});

// ---------- Minor: timeout de download + reentrância ----------

test('baixarArquivo(): timeout de inatividade do socket rejeita (conexão que nunca responde)', async () => {
  const server = http.createServer(() => {
    /* nunca responde — conexão fica pendurada de propósito */
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const destino = path.join(dirTemp(), 'saida.bin');
    await assert.rejects(
      baixarArquivo(`https://127.0.0.1:${port}/x`, destino, { transporte: transporteViaHttp, timeoutMs: 60 }),
      /timeout/,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('verificar(): uma verificação em andamento evita reentrar numa segunda chamada concorrente', async () => {
  const f = montarFixture();
  let chamadasBuscarVersao = 0;
  let liberar;
  const espera = new Promise((r) => {
    liberar = r;
  });
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    buscarVersao: async () => {
      chamadasBuscarVersao += 1;
      await espera;
      return null; // sem versão nova — termina rápido assim que liberarmos
    },
  });
  const p1 = at.verificar('token-x'); // entra em buscarVersao e trava
  await new Promise((r) => setImmediate(r)); // deixa a 1ª chamada realmente começar
  const p2 = at.verificar('token-x'); // tem que ser ignorada (emAndamento)
  liberar();
  await Promise.all([p1, p2]);
  assert.equal(chamadasBuscarVersao, 1, 'a 2ª chamada não reentrou em buscarVersao');
  assert.ok(
    f.logs.log.some((m) => m.includes('já há uma verificação em andamento')),
    JSON.stringify(f.logs.log),
  );
});

// ---------- iniciarVigiaDeConfirmacao() (Important 3) ----------

test('iniciarVigiaDeConfirmacao(): sem atualizacao.json pendente, não agenda nada', () => {
  const f = montarFixture();
  const timer = f.atualizador.iniciarVigiaDeConfirmacao(50);
  assert.equal(timer, null);
});

test('iniciarVigiaDeConfirmacao(): fora de SEA, não agenda nada', () => {
  const f = montarFixture({ isSea: false });
  fs.writeFileSync(path.join(f.dir, ARQ_ATUALIZACAO), JSON.stringify({ de: 'x', para: 'y', tentativas: 0 }));
  const timer = f.atualizador.iniciarVigiaDeConfirmacao(50);
  assert.equal(timer, null);
});

test('iniciarVigiaDeConfirmacao(): atualizacao.json pendente sem confirmar no prazo força sair(1)', async () => {
  const f = montarFixture();
  fs.writeFileSync(path.join(f.dir, ARQ_ATUALIZACAO), JSON.stringify({ de: 'x', para: 'y', tentativas: 0 }));
  f.atualizador.iniciarVigiaDeConfirmacao(20);
  await new Promise((r) => setTimeout(r, 90));
  assert.deepEqual(f.saidas, [1]);
});

test('iniciarVigiaDeConfirmacao(): se confirmarSucesso() apagar o json antes do prazo, não sai', async () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: 'x', para: AGENT_VERSION, tentativas: 0 }),
  );
  f.atualizador.iniciarVigiaDeConfirmacao(30);
  f.atualizador.confirmarSucesso(); // confirma antes do timer dispar
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(f.saidas.length, 0);
});

// ---------- estadoDaAtualizacao() + aoMudarEstado: o que a tela vê ----------

/** Atualizador com TODOS os estados capturados pelo callback `aoMudarEstado`
 *  (cada entrada é o objeto recebido). `extra` sobrescreve qualquer dep. */
function atualizadorComEstados(f, extra = {}) {
  const estados = [];
  const at = criarAtualizador({
    isSea: () => true,
    diretorio: () => f.dir,
    caminhoExe: () => f.caminhoExeVal,
    sair: (c) => f.saidas.push(c),
    log: f.logger,
    aoMudarEstado: (e) => estados.push(e),
    ...extra,
  });
  return { at, estados };
}

const CONTEUDO_NOVO = Buffer.from('conteudo-novo-exe-para-estado');
const SHA_NOVO = crypto.createHash('sha256').update(CONTEUDO_NOVO).digest('hex');
const versaoNova = (extra = {}) => async () => ({
  versao: '9999.01.01',
  url: 'https://exemplo.invalid/click-agent.exe',
  sha256: SHA_NOVO,
  ...extra,
});
const baixarOk = async (urlStr, destino) => fs.writeFileSync(destino, CONTEUDO_NOVO);

test('estadoDaAtualizacao(): começa "ocioso", sem versão alvo nem erro, com `em` ISO', () => {
  const f = montarFixture();
  const e = f.atualizador.estadoDaAtualizacao();
  assert.equal(e.estado, 'ocioso');
  assert.equal(e.versao_alvo, null);
  assert.equal(e.erro, null);
  assert.equal(new Date(e.em).toISOString(), e.em);
});

test('estado: verificação sem versão nova passa por "verificando" e termina "em_dia"', async () => {
  const f = montarFixture();
  const instantes = ['2026-11-11T10:00:00.000Z', '2026-11-11T10:00:01.000Z', '2026-11-11T10:00:02.000Z'];
  let i = 0;
  const { at, estados } = atualizadorComEstados(f, {
    agora: () => new Date(instantes[Math.min(i++, instantes.length - 1)]),
    buscarVersao: async () => ({ versao: AGENT_VERSION, url: 'https://exemplo.invalid/x', sha256: 'x' }),
  });
  await at.verificar('token-x');
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'em_dia']);
  assert.deepEqual(at.estadoDaAtualizacao(), {
    estado: 'em_dia',
    versao_alvo: null,
    erro: null,
    em: '2026-11-11T10:00:02.000Z', // instante da ÚLTIMA mudança (o 1º foi o estado inicial)
  });
  assert.equal(estados[0].em, '2026-11-11T10:00:01.000Z');
});

test('estado: caminho de sucesso — verificando → baixando → instalando, com a versão alvo', async () => {
  const f = montarFixture();
  const { at, estados } = atualizadorComEstados(f, { buscarVersao: versaoNova(), baixar: baixarOk });
  await at.verificar('token-x');
  assert.deepEqual(
    estados.map((e) => [e.estado, e.versao_alvo, e.erro]),
    [
      ['verificando', null, null],
      ['baixando', '9999.01.01', null],
      ['instalando', '9999.01.01', null],
    ],
  );
  assert.equal(at.temReinicioPendente(), true);
  assert.equal(at.estadoDaAtualizacao().estado, 'instalando');
});

test('estado: "instalando" só depois do download e do SHA-256 conferidos, e antes da troca do exe', async () => {
  const f = montarFixture();
  const naHoraDeInstalar = [];
  const { at } = atualizadorComEstados(f, {
    buscarVersao: versaoNova(),
    baixar: baixarOk,
    aoMudarEstado: (e) => {
      if (e.estado !== 'instalando') return;
      naHoraDeInstalar.push({
        baixado: fs.existsSync(path.join(f.dir, 'click-agent.new.exe')),
        exeAindaAntigo: fs.readFileSync(f.caminhoExeVal, 'utf8') === 'binario-atual',
      });
    },
  });
  await at.verificar('token-x');
  assert.deepEqual(naHoraDeInstalar, [{ baixado: true, exeAindaAntigo: true }]);
});

test('estado: SHA-256 divergente termina "falhou" com erro curto', async () => {
  const f = montarFixture();
  const { at, estados } = atualizadorComEstados(f, {
    buscarVersao: versaoNova({ sha256: 'f'.repeat(64) }),
    baixar: baixarOk,
  });
  await at.verificar('token-x');
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'baixando', 'falhou']);
  const fim = at.estadoDaAtualizacao();
  assert.equal(fim.versao_alvo, '9999.01.01');
  assert.match(fim.erro, /SHA-256/);
  assert.equal(at.temReinicioPendente(), false);
});

test('estado: falha de rede no download termina "falhou" — erro sem token, sem credencial de URL e com no máximo 200 caracteres', async () => {
  const f = montarFixture();
  const { at, estados } = atualizadorComEstados(f, {
    buscarVersao: versaoNova(),
    baixar: async () => {
      throw new Error(
        `ECONNRESET em https://usuario:senha-secreta@exemplo.invalid/api/facial/agent/condo/token-super-secreto/versao?X-Amz-Signature=assinatura-secreta ${'x'.repeat(400)}`,
      );
    },
  });
  await at.verificar('token-super-secreto');
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'baixando', 'falhou']);
  const { erro } = at.estadoDaAtualizacao();
  assert.match(erro, /ECONNRESET/);
  assert.ok(erro.length <= 200, `erro com ${erro.length} caracteres`);
  assert.ok(!erro.includes('token-super-secreto'), erro);
  assert.ok(!erro.includes('senha-secreta'), erro);
  assert.ok(!erro.includes('assinatura-secreta'), erro);
});

test('estado: falha ao CONSULTAR a nuvem (rede) volta para "ocioso" — não é "falhou"; o motivo fica só no log (I1)', async () => {
  const f = montarFixture();
  const { at, estados } = atualizadorComEstados(f, {
    buscarVersao: async () => {
      throw new Error('nuvem fora do ar');
    },
  });
  await at.verificar('tok-123-abc');
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'ocioso']);
  const fim = at.estadoDaAtualizacao();
  assert.equal(fim.versao_alvo, null);
  assert.equal(fim.erro, null, 'sem alerta na tela: o agente pode estar em dia');
  assert.ok(f.logs.error.some((m) => m.includes('nuvem fora do ar')), JSON.stringify(f.logs.error));
});

test('estado: nuvem sem versão (campos nulos / consulta vazia) volta para "ocioso" — não é "falhou" nem finge "em_dia" (I1)', async () => {
  const f = montarFixture();
  for (const info of [null, { versao: null, url: null, sha256: null }]) {
    f.logs.error.length = 0;
    const { at, estados } = atualizadorComEstados(f, { buscarVersao: async () => info });
    await at.verificar('token-x');
    assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'ocioso']);
    assert.equal(at.estadoDaAtualizacao().erro, null);
    assert.ok(f.logs.error.some((m) => m.includes('não informou')), JSON.stringify(f.logs.error));
  }
});

test('estado: consulta que falha DEPOIS de uma falha real preserva o aviso (não apaga "falhou" com versão alvo)', async () => {
  const f = montarFixture();
  let consulta = versaoNova({ url: 'https://evil.example.com/click-agent.exe' });
  const { at } = atualizadorComEstados(f, {
    apiUrl: () => 'https://api.clickprestarecondominios.com.br',
    buscarVersao: (t) => consulta(t),
  });
  await at.verificar('token-x');
  const falha = at.estadoDaAtualizacao();
  assert.equal(falha.estado, 'falhou');
  assert.ok(falha.versao_alvo, 'a falha real tem versão alvo');

  // A consulta seguinte nem chega a saber se há versão nova: o aviso da falha
  // anterior continua valendo (é o que o dono precisa ver na tela).
  consulta = async () => {
    throw new Error('nuvem fora do ar');
  };
  await at.verificar('token-x');
  const depois = at.estadoDaAtualizacao();
  assert.equal(depois.estado, 'falhou');
  assert.equal(depois.versao_alvo, falha.versao_alvo);
  assert.equal(depois.erro, falha.erro);

  consulta = async () => null;
  await at.verificar('token-x');
  assert.equal(at.estadoDaAtualizacao().estado, 'falhou');
});

test('estado: origem de download não permitida (baixar padrão) termina "falhou"', async () => {
  const f = montarFixture();
  const { at, estados } = atualizadorComEstados(f, {
    apiUrl: () => 'https://api.clickprestarecondominios.com.br',
    buscarVersao: versaoNova({ url: 'https://evil.example.com/click-agent.exe' }),
  });
  await at.verificar('token-x');
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'baixando', 'falhou']);
  assert.match(at.estadoDaAtualizacao().erro, /host não permitido/);
});

test('estado: versão já recusada (revertida antes) termina "falhou" explicando, sem baixar', async () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_VERSAO_RECUSADA),
    JSON.stringify({ versao: '9999.01.01', em: new Date().toISOString() }),
  );
  let baixou = false;
  const { at, estados } = atualizadorComEstados(f, {
    buscarVersao: versaoNova(),
    baixar: async () => {
      baixou = true;
    },
  });
  await at.verificar('token-x');
  assert.equal(baixou, false);
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'falhou']);
  const fim = at.estadoDaAtualizacao();
  assert.equal(fim.versao_alvo, '9999.01.01');
  assert.match(fim.erro, /9999\.01\.01/);
  assert.match(fim.erro, /revertida/);
});

test('estado: fora de SEA a verificação reporta "indisponivel" com o motivo (não falha em silêncio) e não consulta a nuvem', async () => {
  const f = montarFixture({ isSea: false });
  let consultou = false;
  const { at, estados } = atualizadorComEstados(f, {
    isSea: () => false,
    buscarVersao: async () => {
      consultou = true;
      return null;
    },
  });
  await at.verificar('token-x');
  assert.equal(consultou, false);
  assert.deepEqual(estados.map((e) => e.estado), ['indisponivel']);
  const fim = at.estadoDaAtualizacao();
  assert.equal(fim.versao_alvo, null);
  assert.ok(fim.erro && fim.erro.length > 0 && fim.erro.length <= 200, String(fim.erro));
  // Repetir a verificação não é mudança de estado: não dispara o callback de novo.
  await at.verificar('token-x');
  assert.equal(estados.length, 1);
});

test('estado: instalação sem laço de reinício reporta "indisponivel" com a versão alvo', async () => {
  const f = montarFixture({ comLacoDeReinicio: false });
  const { at, estados } = atualizadorComEstados(f, { buscarVersao: versaoNova(), baixar: baixarOk });
  await at.verificar('token-x');
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'indisponivel']);
  const fim = at.estadoDaAtualizacao();
  assert.equal(fim.versao_alvo, '9999.01.01');
  assert.match(fim.erro, /laço de reinício/);
});

test('estado: falha ao trocar o executável (depois de "instalando") termina "falhou"', async () => {
  const f = montarFixture();
  let chamadas = 0;
  const { at, estados } = atualizadorComEstados(f, {
    buscarVersao: versaoNova(),
    baixar: baixarOk,
    renomear: (de, para) => {
      chamadas += 1;
      if (chamadas === 2) throw new Error('EACCES: simulado');
      fs.renameSync(de, para);
    },
  });
  await at.verificar('token-x');
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'baixando', 'instalando', 'falhou']);
  assert.match(at.estadoDaAtualizacao().erro, /EACCES/);
  assert.equal(fs.readFileSync(f.caminhoExeVal, 'utf8'), 'binario-atual');
});

test('estado: falha inesperada no meio da verificação (dependência que lança) também termina "falhou"', async () => {
  const f = montarFixture();
  const { at, estados } = atualizadorComEstados(f, {
    buscarVersao: versaoNova(),
    diretorio: () => {
      throw new Error('disco corrompido, simulado');
    },
  });
  await assert.doesNotReject(at.verificar('token-x'));
  assert.deepEqual(estados.map((e) => e.estado), ['verificando', 'falhou']);
  assert.match(at.estadoDaAtualizacao().erro, /disco corrompido/);
  assert.equal(at.verificacaoEmAndamento(), false);
});

test('estado: reversão automática (3 falhas) deixa "falhou" explicando qual versão foi revertida', () => {
  const f = montarFixture();
  const { at, estados } = atualizadorComEstados(f);
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: '2026.01.01', para: AGENT_VERSION, tentativas: 2 }),
  );
  fs.writeFileSync(path.join(f.dir, 'click-agent.old.exe'), 'binario-antigo');
  at.verificarInicializacao();
  assert.deepEqual(f.saidas, [0]);
  const fim = at.estadoDaAtualizacao();
  assert.equal(fim.estado, 'falhou');
  assert.equal(fim.versao_alvo, AGENT_VERSION);
  assert.ok(fim.erro.includes(AGENT_VERSION), fim.erro);
  assert.match(fim.erro, /revertida/);
  assert.deepEqual(estados.map((e) => e.estado), ['falhou']);
});

test('estado: o exe ANTIGO, ao subir depois de uma reversão, já começa "falhou" dizendo que a versão X foi revertida', () => {
  // Quem reverteu foi o processo da versão nova (3ª tentativa) ou o laço de
  // serviço; os dois deixam a versão em versao-recusada.json. O exe antigo
  // sobe em seguida e é ELE que fala com a tela.
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_VERSAO_RECUSADA),
    JSON.stringify({ versao: '9999.12.31', em: new Date().toISOString() }),
  );
  const { at } = atualizadorComEstados(f);
  at.verificarInicializacao();
  const e = at.estadoDaAtualizacao();
  assert.equal(e.estado, 'falhou');
  assert.equal(e.versao_alvo, '9999.12.31');
  assert.match(e.erro, /9999\.12\.31/);
  assert.match(e.erro, /revertida/);
  assert.equal(f.saidas.length, 0);
});

test('estado: reversão pelo laço de serviço (atualizacao.json de outra versão) também começa "falhou"', () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_ATUALIZACAO),
    JSON.stringify({ de: AGENT_VERSION, para: '9999.12.31', tentativas: 0 }),
  );
  const { at } = atualizadorComEstados(f);
  at.verificarInicializacao();
  const e = at.estadoDaAtualizacao();
  assert.equal(e.estado, 'falhou');
  assert.equal(e.versao_alvo, '9999.12.31');
});

test('estado: versão recusada ANTIGA (já superada pela que roda) não suja o estado inicial', () => {
  const f = montarFixture();
  fs.writeFileSync(
    path.join(f.dir, ARQ_VERSAO_RECUSADA),
    JSON.stringify({ versao: '2000.01.01', em: new Date().toISOString() }),
  );
  const { at, estados } = atualizadorComEstados(f);
  at.verificarInicializacao();
  assert.equal(at.estadoDaAtualizacao().estado, 'ocioso');
  assert.equal(estados.length, 0);
});

test('aoMudarEstado: callback que lança ou rejeita não atrapalha a atualização', async () => {
  for (const aoMudarEstado of [
    () => {
      throw new Error('telemetria quebrou (síncrono)');
    },
    () => Promise.reject(new Error('telemetria quebrou (assíncrono)')),
  ]) {
    const f = montarFixture();
    const { at } = atualizadorComEstados(f, { buscarVersao: versaoNova(), baixar: baixarOk, aoMudarEstado });
    await assert.doesNotReject(at.verificar('token-x'));
    assert.equal(at.temReinicioPendente(), true, 'a troca aconteceu apesar do callback');
    assert.equal(at.estadoDaAtualizacao().estado, 'instalando');
    assert.deepEqual(fs.readFileSync(f.caminhoExeVal), CONTEUDO_NOVO);
  }
});

test('estadoDaAtualizacao() e aoMudarEstado entregam CÓPIAS — mexer nelas não altera o estado interno', async () => {
  const f = montarFixture();
  const { at, estados } = atualizadorComEstados(f, {
    buscarVersao: async () => ({ versao: AGENT_VERSION, url: 'https://exemplo.invalid/x', sha256: 'x' }),
  });
  await at.verificar('token-x');
  at.estadoDaAtualizacao().estado = 'adulterado';
  estados[estados.length - 1].estado = 'adulterado';
  assert.equal(at.estadoDaAtualizacao().estado, 'em_dia');
});

test('verificacaoEmAndamento(): true só enquanto uma verificação roda', async () => {
  const f = montarFixture();
  let liberar;
  const espera = new Promise((r) => {
    liberar = r;
  });
  const { at } = atualizadorComEstados(f, {
    buscarVersao: async () => {
      await espera;
      return { versao: AGENT_VERSION, url: 'https://exemplo.invalid/x', sha256: 'x' };
    },
  });
  assert.equal(at.verificacaoEmAndamento(), false);
  const p = at.verificar('token-x');
  assert.equal(at.verificacaoEmAndamento(), true);
  assert.equal(at.estadoDaAtualizacao().estado, 'verificando');
  liberar();
  await p;
  assert.equal(at.verificacaoEmAndamento(), false);
});

// ---------- C1: troca concluída esperando o reinício — nada de segundo ciclo ----------

test('C1: verificar() de novo com reinício pendente não faz nada — não baixa, não mexe em atualizacao.json nem no .old.exe, estado segue "instalando"', async () => {
  const f = montarFixture();
  let downloads = 0;
  let consultas = 0;
  const { at, estados } = atualizadorComEstados(f, {
    buscarVersao: async () => {
      consultas += 1;
      return versaoNova()();
    },
    baixar: async (urlStr, destino) => {
      downloads += 1;
      fs.writeFileSync(destino, CONTEUDO_NOVO);
    },
  });
  await at.verificar('token-x');
  assert.equal(at.temReinicioPendente(), true);
  const jsonAntes = fs.readFileSync(path.join(f.dir, ARQ_ATUALIZACAO), 'utf8');
  const estadoAntes = at.estadoDaAtualizacao();
  const mudancasAntes = estados.length;

  await at.verificar('token-x'); // periódica/forçada ANTES de o laço de poll chamar sair

  assert.equal(downloads, 1, 'não baixou de novo');
  assert.equal(consultas, 1, 'nem consultou a nuvem de novo');
  assert.equal(fs.readFileSync(path.join(f.dir, ARQ_ATUALIZACAO), 'utf8'), jsonAntes, 'atualizacao.json intacto');
  assert.equal(
    fs.readFileSync(path.join(f.dir, 'click-agent.old.exe'), 'utf8'),
    'binario-atual',
    '.old.exe continua sendo a versão anterior',
  );
  assert.equal(fs.existsSync(path.join(f.dir, 'click-agent.new.exe')), false);
  assert.deepEqual(at.estadoDaAtualizacao(), estadoAntes, 'estado não mudou (segue "instalando")');
  assert.equal(at.estadoDaAtualizacao().estado, 'instalando');
  assert.equal(estados.length, mudancasAntes, 'nenhuma mudança de estado avisada');
  assert.equal(at.temReinicioPendente(), true);
  assert.equal(f.saidas.length, 0);
});

test('C1: verificacaoEmAndamento() é true com reinício pendente (a troca já foi feita)', async () => {
  const f = montarFixture();
  const { at } = atualizadorComEstados(f, { buscarVersao: versaoNova(), baixar: baixarOk });
  await at.verificar('token-x');
  assert.equal(at.temReinicioPendente(), true);
  assert.equal(at.verificacaoEmAndamento(), true);
});

test('C1 (defesa em profundidade): falha na troca DEPOIS de uma troca já concluída neste processo não apaga atualizacao.json nem toca no .old.exe', async () => {
  const f = montarFixture();
  let trocaFeita = false;
  const { at } = atualizadorComEstados(f, {
    buscarVersao: versaoNova(),
    baixar: baixarOk,
    renomear: (de, para) => {
      // Depois da 1ª troca, o .old.exe é a imagem em execução: o Windows
      // recusa renomear por cima dele.
      if (trocaFeita) throw new Error(`EPERM: operation not permitted, rename '${de}' -> '${para}'`);
      fs.renameSync(de, para);
    },
  });
  await at.verificar('token-x');
  trocaFeita = true;
  const jsonAntes = fs.readFileSync(path.join(f.dir, ARQ_ATUALIZACAO), 'utf8');
  // Fura a trava de `verificar` de propósito: a saída foi pedida, mas o
  // processo (aqui, o espião `sair`) segue vivo e uma verificação entra.
  assert.equal(at.sairSeReinicioPendente(), true);
  await at.verificar('token-x');

  assert.ok(f.logs.error.some((m) => m.includes('falha ao trocar o executável')), JSON.stringify(f.logs.error));
  assert.equal(fs.existsSync(path.join(f.dir, ARQ_ATUALIZACAO)), true, 'atualizacao.json não pode sumir');
  assert.equal(fs.readFileSync(path.join(f.dir, ARQ_ATUALIZACAO), 'utf8'), jsonAntes);
  assert.equal(fs.readFileSync(path.join(f.dir, 'click-agent.old.exe'), 'utf8'), 'binario-atual');
  assert.deepEqual(fs.readFileSync(f.caminhoExeVal), CONTEUDO_NOVO);
});

// ---------- M1/M2: erroParaEstado ----------

test('M1: erroParaEstado() com 200 KB de texto termina em menos de 100 ms', () => {
  for (const texto of ['a'.repeat(200 * 1024), 'https://'.repeat(25 * 1024), `x://${'a.'.repeat(100 * 1024)}`]) {
    const inicio = process.hrtime.bigint();
    const saida = erroParaEstado(texto, 'token-x');
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    assert.ok(ms < 100, `levou ${ms.toFixed(1)} ms`);
    assert.ok(saida.length <= 200);
  }
});

test('M2: erroParaEstado() troca caminho absoluto do Windows pelo nome do arquivo (não vaza a pasta do usuário)', () => {
  const saida = erroParaEstado(
    "EPERM: operation not permitted, rename 'C:\\Users\\Fulano\\ClickAgente\\click-agent.exe' -> 'C:\\Users\\Fulano\\ClickAgente\\click-agent.old.exe'",
  );
  assert.equal(saida, "EPERM: operation not permitted, rename 'click-agent.exe' -> 'click-agent.old.exe'");
  // pasta com espaço, barra normal e caminho sem aspas
  assert.equal(
    erroParaEstado("ENOENT: no such file or directory, open 'C:\\Users\\Fulano de Tal\\Click Agente\\atualizacao.json'"),
    "ENOENT: no such file or directory, open 'atualizacao.json'",
  );
  assert.equal(erroParaEstado('falha em D:/Dados/Fulano/click-agent.new.exe agora'), 'falha em click-agent.new.exe agora');
});

test('M2: erroParaEstado() troca caminho absoluto POSIX pelo nome do arquivo e não estraga URL', () => {
  assert.equal(
    erroParaEstado("EACCES: permission denied, rename '/home/fulano/click agente/click-agent.exe' -> '/home/fulano/click agente/click-agent.old.exe'"),
    "EACCES: permission denied, rename 'click-agent.exe' -> 'click-agent.old.exe'",
  );
  assert.equal(erroParaEstado('falha ao abrir /home/fulano/agente/atualizacao.json'), 'falha ao abrir atualizacao.json');
  assert.equal(
    erroParaEstado('HTTP 404 em https://github.com/Viniciusvile/Click-Prestare/releases/download/agent-v1/click-agent.exe'),
    'HTTP 404 em https://github.com/Viniciusvile/Click-Prestare/releases/download/agent-v1/click-agent.exe',
  );
});
