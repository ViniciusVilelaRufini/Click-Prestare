'use strict';

/**
 * agent/src/drivers/controlid-facial.js — Driver Control iD (linha de
 * acesso via .fcgi com sessão).
 *
 * Expõe o contrato de driver da spec (todos opcionais exceto `id`):
 *   id, testar(device), executar(device, cmd),
 *   escutar(device, aoEvento, opcoes?), buscarDesde(device, marca).
 * (`acertarRelogio` não existe para esta marca — sem CGI de hora usado hoje;
 * o campo fica ausente e quem orquestra já lida com isso via optional
 * chaining.)
 *
 * Diferente de Dahua/Hikvision, o aparelho NÃO expõe stream de eventos: o
 * caminho nativo é ele fazer PUSH para a nuvem (Monitor/object_changes), que
 * exige internet configurada no terminal — nem sempre presente na
 * instalação. Por isso `escutar` faz POLLING no access_logs, reusando a
 * MESMA marca d'água (deviceBaselines) usada pelo replay offline
 * (`buscarDesde`): nenhum acesso é enviado duas vezes por essa via, e se o
 * push nativo já tiver entregue o evento, a dedup da nuvem descarta.
 *
 * `escutar`'s `opcoes.aoConectar` (extensão do contrato — ver comentário
 * completo em dahua-facial.js): sem stream persistente, não existe
 * "conexão" no sentido Dahua/Hikvision. Aqui chamamos `aoConectar` no
 * primeiro POLL bem-sucedido que vem DEPOIS de um poll que falhou — é o
 * equivalente de "reconectou" para quem só faz requisições avulsas contra o
 * aparelho.
 */

const {
  lanRequest: lanRequestComTimeout,
  okFrom,
  sleep,
} = require('../lib/http');
const { deviceBaselines, setBaseline } = require('../core/estado');

// lib/http.js não conhece o timeout da LAN — é config injetada por quem monta
// o agente (index.js lê LAN_TIMEOUT_MS do .env e chama configurar() cedo no
// boot). Mesmo padrão dos demais drivers.
let lanTimeoutMs = 8000;
function configurar({ lanTimeoutMs: t } = {}) {
  if (t) lanTimeoutMs = t;
}
function lanRequest(device, method, pathname, opts) {
  return lanRequestComTimeout(device, method, pathname, opts, lanTimeoutMs);
}

// ---------- Login ----------

async function controlIdLogin(device) {
  const res = await lanRequest(device, 'POST', '/login.fcgi', {
    json: {
      login: device.api_user || 'admin',
      password: device.api_password || 'admin',
    },
  });
  const session = res.data && res.data.session;
  if (!session) {
    const e = new Error('Control iD: login não retornou session');
    e.statusCode = res.status;
    throw e;
  }
  return String(session);
}

// ---------- Contrato: testar ----------

async function testar(device) {
  await controlIdLogin(device); // login OK prova conectividade
  return { ok: true };
}

// ---------- Contrato: executar ----------

async function executar(device, cmd) {
  switch (cmd.type) {
    case 'ping':
      return testar(device);
    case 'open_door':
      return abrirPorta(device);
    case 'enroll':
    case 'update':
      return cmd.type === 'update' ? controlIdUpdate(device, cmd) : controlIdCreate(device, cmd);
    case 'remove':
      return removerUsuario(device, cmd);
    case 'snapshot':
      // Sem câmera acessível por este protocolo (mesmo comportamento de
      // antes, quando caía no fallback genérico de doSnapshot em index.js).
      return { ok: false, error: `Captura por câmera não suportada para ${device.fabricante}.` };
    case 'list_users':
      return listarUsuarios(device);
    case 'remove_users':
      return removerUsuarios(device, cmd);
    default:
      return { ok: false, error: `comando desconhecido: ${cmd.type}` };
  }
}

/** VALIDADO: usa /execute_actions.fcgi com action "door". */
async function abrirPorta(device) {
  const session = await controlIdLogin(device);
  const res = await lanRequest(
    device,
    'POST',
    `/execute_actions.fcgi?session=${session}`,
    { json: { actions: [{ action: 'door', parameters: 'door=1' }] } },
  );
  return okFrom(res);
}

/**
 * Cadastro de pessoa nova. Devolve o user_id INTERNO do aparelho como
 * faceId: é por ele que o webhook resolve a pessoa (o push só manda
 * user_id). VALIDADO contra a doc oficial da API Linha de Acesso.
 */
async function controlIdCreate(device, cmd) {
  const session = await controlIdLogin(device);
  const registration = String(cmd.externalId || cmd.faceId);
  const created = await lanRequest(
    device,
    'POST',
    `/create_objects.fcgi?session=${session}`,
    {
      json: {
        object: 'users',
        values: [{ name: cmd.nome || registration, registration }],
      },
    },
  );
  const userId = created.data && created.data.ids && created.data.ids[0];
  if (userId == null)
    return { ok: false, error: 'Control iD: create_objects não retornou id' };
  if (cmd.fotoBase64) {
    await lanRequest(
      device,
      'POST',
      `/user_set_image.fcgi?session=${session}&user_id=${userId}&match=1&timestamp=${Math.floor(Date.now() / 1000)}`,
      { binary: Buffer.from(cmd.fotoBase64, 'base64') },
    );
  }
  return { ok: true, faceId: String(userId) };
}

/** Atualiza nome/foto pelo user_id interno (= faceId salvo). */
async function controlIdUpdate(device, cmd) {
  const session = await controlIdLogin(device);
  const userId = Number(cmd.faceId);
  if (cmd.nome) {
    await lanRequest(
      device,
      'POST',
      `/modify_objects.fcgi?session=${session}`,
      {
        json: {
          object: 'users',
          values: { name: cmd.nome },
          where: { users: { id: userId } },
        },
      },
    );
  }
  if (cmd.fotoBase64) {
    await lanRequest(
      device,
      'POST',
      `/user_set_image.fcgi?session=${session}&user_id=${userId}&match=1&timestamp=${Math.floor(Date.now() / 1000)}`,
      { binary: Buffer.from(cmd.fotoBase64, 'base64') },
    );
  }
  return { ok: true, faceId: String(userId) };
}

async function removerUsuario(device, cmd) {
  const session = await controlIdLogin(device);
  const res = await lanRequest(
    device,
    'POST',
    `/destroy_objects.fcgi?session=${session}`,
    { json: { object: 'users', where: { users: { id: Number(cmd.faceId) } } } },
  );
  return okFrom(res);
}

/**
 * Identificador que NÓS gravamos no aparelho ("morador_42", "visitante_9",
 * "prestador_servico_3").
 *
 * A varredura de fantasmas apaga tudo que está no aparelho e não está no
 * nosso banco. Num terminal Control iD, "tudo" inclui o usuário admin que o
 * instalador criou no próprio aparelho — apagá-lo trancaria o instalador
 * para fora. Restringir a listagem ao nosso padrão mantém a varredura
 * fazendo o trabalho dela sem tocar em quem não é nosso.
 */
const NOSSO_EXTERNAL_ID = /^(morador|visitante|prestador_servico)_\d+$/;

/** O face_id gravado é o id INTERNO do usuário (ver controlIdCreate); quem
 *  identifica os nossos é o campo `registration`, onde gravamos o
 *  external_id no enrollment. */
async function listarUsuarios(device) {
  const session = await controlIdLogin(device);
  const resp = await lanRequest(
    device,
    'POST',
    `/load_objects.fcgi?session=${session}`,
    { json: { object: 'users' } },
  );
  if (!(resp.status >= 200 && resp.status < 300)) {
    return { ok: false, error: `Falha ao listar usuários (HTTP ${resp.status})` };
  }
  const users = (resp.data && resp.data.users) || [];
  return {
    ok: true,
    userIds: users
      .filter((u) => u.id != null && NOSSO_EXTERNAL_ID.test(String(u.registration ?? '')))
      .map((u) => String(u.id)),
  };
}

/** Sem lote equivalente ao RPC2 da Dahua: cai para remoção individual. Uma
 *  falha isolada não aborta o lote — a varredura de fantasmas roda de hora
 *  em hora e tenta de novo o que sobrou. */
async function removerUsuarios(device, cmd) {
  const alvos = cmd.faceIds || [];
  if (alvos.length === 0) return { ok: true };
  const falhas = [];
  for (const faceId of alvos) {
    try {
      const r = await removerUsuario(device, { faceId });
      if (!r.ok && r.statusCode !== 404) falhas.push(faceId);
    } catch {
      falhas.push(faceId);
    }
  }
  if (falhas.length > 0) {
    return {
      ok: false,
      error: `falha ao remover ${falhas.length}/${alvos.length} usuário(s): ${falhas.slice(0, 10).join(', ')}`,
    };
  }
  return { ok: true };
}

// ---------- Log de acessos (access_logs) ----------

/** Busca os 50 access_logs mais recentes (ordem desc) — usado tanto pelo
 *  poller ao vivo (`escutar`) quanto pelo replay offline (`buscarDesde`). */
async function controlIdLoadAccessLogs(device) {
  const session = await controlIdLogin(device);
  const res = await lanRequest(
    device,
    'POST',
    `/load_objects.fcgi?session=${session}`,
    { json: { object: 'access_logs', order: ['id', 'desc'], limit: 50 } },
  );
  return (res.data && res.data.access_logs) || [];
}

/**
 * Lê os access_logs mais recentes e devolve, em ordem crescente, só os que
 * passaram da marca d'água GLOBAL (deviceBaselines) — usado pelo poller ao
 * vivo (`escutar`), que mantém a própria marca d'água (mesma usada pelo
 * replay offline, `buscarDesde`). Na primeira leitura apenas estabelece a
 * baseline (não reprocessa o histórico do aparelho).
 *
 * Ordena DESC no aparelho: `asc` traz os 50 registros MAIS ANTIGOS, que num
 * terminal em uso já estão muito abaixo da baseline — nunca chegaria evento.
 */
async function controlIdFetchNewLogs(device) {
  const logs = await controlIdLoadAccessLogs(device);
  const baseline = deviceBaselines.get(device.id);
  if (!Array.isArray(logs) || logs.length === 0) {
    // Aparelho ainda sem nenhum acesso (recém-instalado ou pós-reset): fixa a
    // marca d'água em 0 AGORA. Sem isso, a baseline continuava indefinida e o
    // PRIMEIRO acesso da vida do aparelho era consumido só para inicializá-la
    // — a passagem nunca chegava à nuvem.
    if (baseline === undefined) setBaseline(device.id, 0);
    return [];
  }
  if (baseline === undefined) {
    const maxId = Math.max(...logs.map((l) => l.id).filter(Boolean));
    setBaseline(device.id, maxId);
    console.log(
      `[agente] ${device.nome}: baseline de acessos inicializada em ID ${maxId} (Control iD).`,
    );
    return [];
  }
  return logs
    .filter((l) => l.id > baseline && l.user_id)
    .sort((a, b) => a.id - b.id);
}

// ---------- Contrato: escutar (polling de acessos ao vivo) ----------

const CONTROLID_POLL_MS = 3000;

function escutar(device, aoEvento, opcoes = {}) {
  const aoConectar = opcoes.aoConectar;
  let parado = false;
  let falhouAntes = false;
  // Sem stream: informa que o monitoramento é por polling — a mensagem
  // genérica "assinando eventos de acesso (<driver>)" (emitida por quem
  // orquestra antes de chamar `escutar`) não deixa isso claro sozinha.
  console.log(`[agente] ${device.nome}: monitorando acessos (Control iD, polling)`);
  (async () => {
    while (!parado) {
      try {
        const logs = await controlIdFetchNewLogs(device);
        // Poll bem-sucedido depois de uma falha: sinal equivalente ao
        // aoConectar do stream Dahua/Hikvision (ver comentário no topo).
        if (falhouAntes) {
          falhouAntes = false;
          if (aoConectar) aoConectar();
        }
        for (const log of logs) {
          const ok = await aoEvento({
            UserID: String(log.user_id),
            Similarity: 100,
            timestamp: new Date(log.time * 1000).toISOString(),
          });
          // Só avança a marca d'água no que a nuvem confirmou — mesmo
          // critério do replay offline; senão um acesso recusado sumiria
          // para sempre.
          if (ok) setBaseline(device.id, log.id);
          else break;
        }
      } catch (err) {
        falhouAntes = true;
        console.error(
          `[agente] ${device.nome}: falha ao ler acessos (Control iD): ${err.message || err}`,
        );
      }
      if (parado) break;
      await sleep(CONTROLID_POLL_MS);
    }
  })();
  return () => {
    parado = true;
  };
}

// ---------- Contrato: buscarDesde (replay offline) ----------
//
// Reusa controlIdLoadAccessLogs (mesma chamada do poller ao vivo), mas SEM
// tocar a marca d'água global: `marca` é parâmetro explícito e `novaMarca` é
// o maior id devolvido — quem chama (index.js `syncDeviceOfflineLogs`)
// decide até onde persistir, mesmo contrato do driver Dahua/Intelbras (ver
// `buscarDesde` em dahua-facial.js).

/**
 * `marca === undefined` (device nunca visto): devolve `eventos: []` — a
 * primeira leitura só ESTABELECE a marca d'água, sem reprocessar o
 * histórico inteiro do aparelho como se fossem acessos novos.
 *
 * `logVazio: true` distingue "aparelho sem NENHUM access_log" de "há
 * registros, mas nenhum novo além de `marca`".
 */
async function buscarDesde(device, marca) {
  const logs = await controlIdLoadAccessLogs(device);
  if (!Array.isArray(logs) || logs.length === 0) {
    return { eventos: [], novaMarca: marca, logVazio: true };
  }
  const maxId = Math.max(...logs.map((l) => l.id).filter((id) => typeof id === 'number'));
  if (marca === undefined || maxId <= marca) {
    return { eventos: [], novaMarca: maxId };
  }
  const eventos = logs
    .filter((l) => l.id > marca && l.user_id)
    .sort((a, b) => a.id - b.id)
    .map((l) => ({
      UserID: String(l.user_id),
      Similarity: 100,
      timestamp: new Date(l.time * 1000).toISOString(),
      _marca: l.id,
    }));
  return { eventos, novaMarca: maxId };
}

module.exports = {
  id: 'controlid-facial',
  configurar,
  testar,
  executar,
  escutar,
  buscarDesde,
};
