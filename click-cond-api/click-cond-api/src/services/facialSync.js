const dbVis = require('../database/DB_Visitantes.js');

// O motor do facial vive no NestJS (produção). O Express (dev) não enrola
// direto — então dispara o sync lá. URL configurável por env.
const NEST_URL = process.env.NEST_API_URL || 'https://click-prestare-production.up.railway.app';
// Token compartilhado (server-to-server) — deve ser IGUAL ao INTERNAL_SYNC_TOKEN
// definido no NestJS (Railway). Sem ele, o disparo imediato é pulado (o
// back-fill do NestJS ainda enrola via face_sync_status='pending').
const INTERNAL_SYNC_TOKEN = process.env.INTERNAL_SYNC_TOKEN || '';

/**
 * Dispara o enrolamento facial de um visitante no NestJS. Best-effort:
 *   1) marca face_sync_status='pending' — o back-fill do NestJS (tickSyncRetry)
 *      enrola de qualquer forma quando o agente está online (independe de auth);
 *   2) POST imediato ao endpoint de sync p/ enrolar na hora.
 * Nenhuma falha aqui derruba a resposta da API (fire-and-forget com catch).
 */
async function triggerFacialSyncVisitante(idVisitante, idCondominio) {
  if (!idVisitante || !idCondominio) return;
  // 1) Garantia via back-fill (não depende de rede/segredo compartilhado).
  try {
    await dbVis.marcarFacialPendente(idVisitante);
  } catch (e) {
    console.warn('[facialSync] marcar pendente falhou:', e.message);
  }
  // 2) Enrolamento imediato no NestJS via endpoint interno (melhor esforço).
  if (!INTERNAL_SYNC_TOKEN) {
    console.log('[facialSync] INTERNAL_SYNC_TOKEN ausente — pulando disparo imediato (back-fill cobre).');
    return;
  }
  try {
    const url = `${NEST_URL}/api/facial/internal/sync/visitante/${idVisitante}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'x-internal-token': INTERNAL_SYNC_TOKEN },
    });
    console.log(`[facialSync] POST ${url} -> ${resp.status}`);
  } catch (e) {
    console.warn('[facialSync] POST NestJS falhou:', e.message);
  }
}

module.exports = { triggerFacialSyncVisitante };
