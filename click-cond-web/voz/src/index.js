// Ponto de entrada (systemd: prestare-voz.service). Sobe o controle HTTPS,
// conecta na ARI (tenta a cada 5 s), sincroniza as contas SIP e informa à API
// quais faciais/monitores estão registrados.
import { readFile, writeFile } from 'node:fs/promises';
import { lerConfig } from './config.js';
import { criarApi } from './api.js';
import { criarSincronizador } from './contas.js';
import { conectarAri, adaptarAri, APP_STASIS } from './ari.js';
import { criarServico } from './servico.js';
import { criarControle, iniciarControleHttps } from './controle.js';

const CONTA = /^(fac|mon)-\d{1,10}$/;
const log = console;
const cfg = lerConfig(process.env);
const api = criarApi({ apiBase: cfg.apiBase, vozToken: cfg.vozToken });

let servico = null;
let ariConectada = false;

// O controle sobe antes da ARI: /controle/saude mostra ari:false enquanto isso.
const controle = criarControle({
  vozToken: cfg.vozToken,
  servico: {
    forcarPortaria: (id) => (servico ? servico.forcarPortaria(id) : false),
    dtmf: (id, d) => (servico ? servico.dtmf(id, d) : false),
    encerrar: (id) => (servico ? servico.encerrar(id) : false),
  },
  saudeAri: () => ariConectada,
  log,
});
iniciarControleHttps({ handler: controle, porta: cfg.controlePorta, certDir: cfg.certDir, log });

const client = await conectarAri({ url: cfg.ariUrl, usuario: cfg.ariUser, senha: cfg.ariPass, log });
const ari = adaptarAri(client);
servico = criarServico({ ari, api, segredo: cfg.tokenSecret, log });

client.on('WebSocketConnected', async () => {
  ariConectada = true;
  log.info('[ari] conectada');
  // Na queda os StasisEnd se perdem: encerra como falha o que morreu no meio.
  try {
    const marco = servico.marco(); // chamadas criadas durante a consulta não entram
    const n = servico.conferirCanais(await ari.canaisExistentes(), marco);
    if (n) log.warn(`[ari] ${n} chamada(s) encerrada(s) como falha depois da reconexão`);
  } catch (e) {
    log.warn(`[ari] não conferi os canais depois da reconexão: ${e.message}`);
  }
});
client.on('WebSocketReconnecting', () => { ariConectada = false; log.warn('[ari] reconectando'); });
client.on('WebSocketMaxRetries', () => {
  log.error('[ari] desisti de reconectar; saindo para o systemd reiniciar');
  process.exit(1);
});
client.start(APP_STASIS);
ariConectada = true;

// Canais que ficaram no Stasis de uma execução anterior não têm dono: derruba.
try {
  for (const canal of await ari.canaisNoStasis()) {
    log.warn(`[ari] derrubando canal órfão ${canal}`);
    await ari.hangup(canal).catch(() => {});
  }
} catch (e) {
  log.warn(`[ari] não listei canais órfãos: ${e.message}`);
}

const sync = criarSincronizador({
  api,
  ler: () => readFile(cfg.pjsipArquivo, 'utf8'),
  // Escrita no lugar: mantém dono/permissão (root:asterisk 640) criados pelo instalar.sh.
  escrever: (texto) => writeFile(cfg.pjsipArquivo, texto, 'utf8'),
  recarregar: () => ari.recarregarPjsip(),
  log,
});
sync.iniciar(60_000);

async function informarRegistros() {
  if (!ariConectada) return;
  try {
    const contas = (await ari.endpointsPjsip())
      .filter((e) => CONTA.test(e.conta))
      .map((e) => ({ conta: e.conta, registrado: e.estado === 'online' }));
    await api.registros(contas);
  } catch (e) {
    log.warn(`[registros] não informei a API: ${e.message}`);
  }
}
setInterval(informarRegistros, 60_000).unref();
setTimeout(informarRegistros, 15_000).unref();

let saindo = false;
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, async () => {
    if (saindo) return;
    saindo = true;
    const ativas = servico?.ativas() ?? 0;
    log.info(`[voz] ${sinal}: saindo (${ativas} chamada(s) ativa(s))`);
    // Avisa a API (encerrada falha) para não deixar telas tocando; teto de 3 s.
    if (servico && ativas) await servico.encerrarTodasPorFalha({ tetoMs: 3000 }).catch(() => {});
    process.exit(0);
  });
}
log.info('[voz] pronto');
