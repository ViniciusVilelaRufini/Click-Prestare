const jwt = require('jsonwebtoken');
const config = require('../configs/config.js');
const dbVis = require('../database/DB_Visitantes.js');

// O motor do facial vive no NestJS (produção). O Express (dev) não enrola
// direto — então dispara o sync lá. URL configurável por env.
const NEST_URL = process.env.NEST_API_URL || 'https://click-prestare-production.up.railway.app';

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
  // 2) Enrolamento imediato no NestJS (melhor esforço).
  try {
    const token = jwt.sign(
      { id_condominio: Number(idCondominio), sub: 0, typeAccess: 'Sindico' },
      config.jwt.secretKey,
      { expiresIn: '2m' },
    );
    const url = `${NEST_URL}/api/facial/sync/visitante/${idVisitante}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[facialSync] POST ${url} -> ${resp.status}`);
  } catch (e) {
    console.warn('[facialSync] POST NestJS falhou:', e.message);
  }
}

module.exports = { triggerFacialSyncVisitante };
