'use strict';

/**
 * src/index.js não pode ser carregado em teste (ele chama main() ao ser
 * importado: leria o .env real e falaria com a nuvem e com os aparelhos).
 * Estas checagens são ESTÁTICAS (leem o texto do arquivo) e só travam as
 * ligações que não têm como ser exercitadas de outro jeito — a lógica em si
 * é testada nos módulos de src/core e src/lib.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

test("index.js registra process.on('unhandledRejection') — rejeição solta só loga, não derruba o agente", () => {
  assert.match(fonte, /process\.on\('unhandledRejection',/);
  const handler = fonte.slice(fonte.indexOf("process.on('unhandledRejection'"));
  assert.ok(!/process\.exit/.test(handler), 'o handler não pode encerrar o processo');
});

test('index.js: comandos saem pelo despachante (fila por aparelho), não por laço em série', () => {
  assert.match(fonte, /despachante\.despachar\(entradas\)/);
  assert.ok(!/for \(const cmd of /.test(fonte), 'sobrou laço de comandos em série');
  assert.ok(!/await doPing\(device\)\s*;\s*\n\s*online = /.test(fonte), 'sobrou ping em série no laço do poll');
});

test('index.js: só o fallback REST genérico liga permitirBasic; intervalo de poll passa por intervaloDePoll', () => {
  assert.equal((fonte.match(/permitirBasic/g) || []).length >= 1, true);
  assert.match(fonte, /\{ permitirBasic: true, \.\.\.opts \}/);
  assert.ok(!/pollMs = Number\(body\.poll_interval_ms\)/.test(fonte), 'poll_interval_ms cru ainda vira pollMs');
  assert.equal((fonte.match(/pollMs = intervaloDePoll\(body\.poll_interval_ms, pollMs, POLL_MIN\)/g) || []).length, 2);
});

test('index.js: nenhuma entrada do poll é usada sem passar por entradasValidas (entry.device.id sem guarda)', () => {
  assert.match(fonte, /const entradas = entradasValidas\(body\)/);
  assert.ok(!/entry\.device/.test(fonte), 'sobrou acesso a entry.device sem guarda');
});

test('index.js (I4): poll do condomínio que não é 2xx/JSON esperado cai no backoff ANTES de tocar supervisor, lastDevices e heartbeat', () => {
  const laco = fonte.slice(fonte.indexOf('async function runCondoLoop'), fonte.indexOf('async function runDeviceLoop'));
  const iAval = laco.indexOf('const avaliacao = avaliarRespostaDoPoll(res);');
  assert.ok(iAval > 0, 'o laço do condomínio tem de avaliar a resposta do poll');
  // Resposta ruim vira erro do laço: o catch existente loga e aplica o backoff.
  assert.match(laco.slice(iAval), /^const avaliacao = avaliarRespostaDoPoll\(res\);\s*if \(!avaliacao\.ok\) throw new Error\(avaliacao\.motivo\);/);
  for (const efeito of ['lastDevices = devicesAtuais', 'supervisor.atualizar(', 'flushOfflineEvents(token)', 'despachante.despachar(entradas)', 'rodarHeartbeat(devicesAtuais)', 'offlineDesde.delete(id)']) {
    const i = laco.indexOf(efeito);
    assert.ok(i > iAval, `"${efeito}" tem de vir depois da avaliação da resposta`);
  }
  assert.match(laco, /const body = avaliacao\.body;/);
  assert.ok(!/const body = res\.data && typeof res\.data === 'object' \? res\.data : \{\};/.test(laco), 'sobrou o corpo ruim virando {}');
  // O backoff só zera depois de um poll APROVEITÁVEL (senão 5xx repetido nunca cresceria a espera).
  const iZera = laco.indexOf('errBackoff = 0;', iAval);
  assert.ok(iZera > iAval, 'errBackoff = 0 tem de vir depois da avaliação');
  const antes = laco.slice(laco.indexOf("cloudRequest('GET'"), iAval);
  const zerasAntes = antes.match(/errBackoff = 0;/g) || [];
  assert.equal(zerasAntes.length, 1, 'antes da avaliação só o ramo 401/404 zera o backoff');
  assert.match(antes, /if \(res\.status === 401 \|\| res\.status === 404\) \{\s*errBackoff = 0;/);
});

test('index.js (I6): forwardAccessEvent decide "vale reenviar" pela MESMA função do flush (respostaTransitoria), sem lista própria de status', () => {
  const envio = fonte.slice(fonte.indexOf('async function forwardAccessEvent'), fonte.indexOf('// O poller de eventos ao vivo do Control iD'));
  assert.match(envio, /const valeReenviar = respostaTransitoria\(res\.status\);/);
  assert.ok(!/\[401, 404, 408, 429\]/.test(fonte), 'sobrou a lista de status solta no index.js');
  const fila = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'fila-offline.js'), 'utf8');
  assert.match(fila, /if \(respostaTransitoria\(res\.status\)\) break;/);
  assert.ok(!/if \(res\.status >= 500\) break;/.test(fila), 'sobrou o critério antigo (só 5xx) no flush');
});

test('index.js (I3): evento ao vivo só entra na memória de eco DEPOIS do desfecho do envio (aceito ou fila offline)', () => {
  assert.match(fonte, /const ecoReplay = criarMemoriaDeEco\(\)/);
  const aoVivo = fonte.slice(
    fonte.indexOf('async function forwardAccessEvent'),
    fonte.indexOf('// O poller de eventos ao vivo do Control iD'),
  );
  // Nada de registrar antes de a nuvem responder.
  assert.ok(!/ecoReplay\.registrarAoVivo\(/.test(fonte), 'sobrou registrarAoVivo direto (antes do desfecho)');
  // O instante é o da CHEGADA do evento, tirado no ramo ao vivo, antes do envio.
  const iInstante = aoVivo.indexOf('recebidoEm = instanteDoEco();');
  const iEnvio = aoVivo.indexOf("await cloudRequest('POST'");
  assert.ok(iInstante > 0 && iInstante < iEnvio, 'recebidoEm tem de ser tirado antes do envio');
  // Depois da resposta: registra com o desfecho (recusa definitiva = não registra).
  const depois = aoVivo.slice(iEnvio);
  const iTry = depois.indexOf('} catch (err) {');
  assert.match(
    depois.slice(0, iTry),
    /if \(!opts\.backlog\) \{\s*ecoReplay\.registrarAposEnvio\(device\.id, userId, recebidoEm, \{ aceito: ok, enfileirado: valeReenviar \}\);/,
  );
  // Sem internet: foi para a fila offline (entrega garantida) → registra.
  assert.match(
    depois.slice(iTry),
    /enqueueOfflineEvent\(body, device\.nome\);\s*if \(!opts\.backlog\) \{\s*ecoReplay\.registrarAposEnvio\(device\.id, userId, recebidoEm, \{ aceito: false, enfileirado: true \}\);/,
  );
  // O registro vem ANTES do avanço da marca (que limpa a memória até o fim da busca).
  assert.ok(depois.indexOf('ecoReplay.registrarAposEnvio(') < depois.indexOf('avancarMarcaOnline(device, true)'));
});

test('index.js (I2): o replay decide os ecos sobre a LISTA inteira (separarEcos) antes de reenviar', () => {
  const replay = fonte.slice(fonte.indexOf('async function syncDeviceOfflineLogs'));
  assert.ok(!/ecoReplay\.ehEco\(/.test(fonte), 'sobrou o casamento guloso registro a registro (ehEco)');
  const iEco = replay.indexOf('ecoReplay.separarEcos(');
  const iLaco = replay.indexOf('for (const ev of eventos) {');
  const iEnvio = replay.indexOf('forwardAccessEvent(token, device, ev, { backlog: true })');
  assert.ok(iEco > 0 && iEco < iLaco && iLaco < iEnvio, 'separarEcos tem de vir antes do laço de envio do backlog');
  assert.match(
    replay.slice(0, iLaco),
    /eventos\.map\(\(ev\) => \(\{ pessoa: ev\.UserID, instanteMs: Date\.parse\(ev\.timestamp\), marca: ev\._marca, ev \}\)\)/,
  );
  // O eco não é reenviado, mas conta para a marca d'água.
  const trechoEco = replay.slice(iLaco, iEnvio);
  assert.match(trechoEco, /if \(ecosDoReplay\.has\(ev\)\) \{[\s\S]*if \(falhas === 0\) ultimoConfirmado = ev\._marca;[\s\S]*continue;/);
});

test('index.js: instante do eco é o relógio corrigido pela nuvem (o mesmo que acerta o aparelho)', () => {
  assert.match(fonte, /function instanteDoEco\(\) \{\s*return agoraDaNuvem\(\)\.getTime\(\);\s*\}/);
});

test("index.js (I1): marca d'água que avança limpa a memória de eco até o FIM da busca (todo avanço online passa por avancarMarcaOnline)", () => {
  // Fora do helper, ninguém chama advanceBaselineWhileOnline direto.
  assert.equal((fonte.match(/advanceBaselineWhileOnline\??\.?\(device/g) || []).length, 1);
  assert.equal((fonte.match(/avancarMarcaOnline\(device(, true)?\);/g) || []).length, 2);
  const helper = fonte.slice(fonte.indexOf('function avancarMarcaOnline'), fonte.indexOf('// Devices do último poll'));
  // A lógica (testada em core-eco-replay) recebe o RELÓGIO, não um instante já lido.
  assert.match(helper, /avancarMarcaCobrindoEco\(\{/);
  assert.match(helper, /agora: instanteDoEco,/);
  assert.match(helper, /avancar: \(\) => driver\.advanceBaselineWhileOnline\(device, force\),/);
  assert.match(helper, /ocupado: \(\) => offlineSyncBusy\.has\(device\.id\) \|\| replayOffline\.ocupado\(device\.id\),/);
  assert.ok(!/lidoEm/.test(helper), 'sobrou o instante tirado ANTES da busca');
  const replay = fonte.slice(fonte.indexOf('async function syncDeviceOfflineLogs'));
  assert.equal((replay.match(/ecoReplay\.cobrirAte\(device\.id, lidoEm\);/g) || []).length, 3);
  assert.match(replay, /ecoReplay\.cobrirAte\(device\.id, lidoEm, \{ manterConsumidos: true \}\)/);
});

test('index.js: prazo padrão do ping vem de PING_TIMEOUT_MS (core/despacho), sem número solto', () => {
  assert.match(fonte, /\? Number\(process\.env\.DEVICE_PING_TIMEOUT_MS\)\s*: PING_TIMEOUT_MS;/);
});

test('index.js: flag `verificar_atualizacao` do poll dispara a verificação forçada sem bloquear o laço', () => {
  assert.match(fonte, /const \{ criarVerificacaoForcada \} = require\('\.\/core\/verificacao-forcada'\);/);
  // Reaproveita o `verificar` e a proteção de "em andamento" do atualizador.
  assert.match(
    fonte,
    /const verificacaoForcada = criarVerificacaoForcada\(\{\s*verificar: \(token\) => atualizador\.verificar\(token\),\s*emAndamento: \(\) => atualizador\.verificacaoEmAndamento\(\),\s*\}\);/,
  );
  const laco = fonte.slice(fonte.indexOf('async function runCondoLoop'), fonte.indexOf('async function runDeviceLoop'));
  const iAval = laco.indexOf('const avaliacao = avaliarRespostaDoPoll(res);');
  const iFlag = laco.indexOf('if (body.verificar_atualizacao === true) verificacaoForcada.pedir(token);');
  assert.ok(iFlag > iAval, 'a flag só é lida de um poll aproveitável (depois da avaliação)');
  assert.ok(!/await verificacaoForcada/.test(fonte), 'o laço não pode esperar a verificação');
  assert.ok(!/await atualizador\.verificar/.test(fonte), 'o laço não pode esperar a verificação');
});

test('index.js: estado da atualização vai na telemetria e cada mudança dispara um envio imediato (sem rajada)', () => {
  // O atualizador nasce antes do laço (que é quem tem supervisor/token): o
  // callback passa por uma variável que o laço do condomínio preenche.
  assert.match(fonte, /aoMudarEstado: \(\) => aoMudarEstadoDaAtualizacao\(\),/);
  const laco = fonte.slice(fonte.indexOf('async function runCondoLoop'), fonte.indexOf('async function runDeviceLoop'));
  assert.match(laco, /atualizacao: \(\) => atualizador\.estadoDaAtualizacao\(\),/);
  assert.match(laco, /iniciarTelemetria\(token, \{ \.\.\.opcoesTelemetria, intervaloMs: TELEMETRIA_INTERVAL_MS \}\)/);
  assert.match(
    laco,
    /const telemetriaImediata = criarEnvioSemRajada\(\(\) => enviarTelemetria\(token, opcoesTelemetria\)\);\s*aoMudarEstadoDaAtualizacao = \(\) => telemetriaImediata\.pedir\(\);/,
  );
});
