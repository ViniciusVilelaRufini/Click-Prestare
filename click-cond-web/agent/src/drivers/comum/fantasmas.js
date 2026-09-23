'use strict';

/**
 * agent/src/drivers/comum/fantasmas.js — utilitários compartilhados pela
 * varredura de fantasmas (cleanup de usuários que sumiram do nosso banco),
 * usados pelos drivers sem remoção em lote nativa equivalente ao RPC2 da
 * Dahua (hoje: Hikvision, Control iD).
 *
 * Identificador que NÓS gravamos no aparelho ("morador_42", "visitante_9",
 * "prestador_servico_3").
 *
 * A varredura de fantasmas apaga tudo que está no aparelho e não está no
 * nosso banco. Num terminal desses, "tudo" inclui o usuário admin que o
 * instalador criou no próprio aparelho — apagá-lo trancaria o instalador
 * para fora. Restringir a listagem ao nosso padrão mantém a varredura
 * fazendo o trabalho dela (o fantasma que buscamos SEMPRE tem esse formato,
 * porque fomos nós que o cadastramos) sem tocar em quem não é nosso.
 *
 * Não vale para Dahua/Intelbras: lá o UserID é livre e o comportamento atual
 * (varrer tudo) já roda em produção — mudá-lo deixaria lixo antigo sem
 * limpeza; por isso esse driver não usa este módulo.
 */
const NOSSO_EXTERNAL_ID = /^(morador|visitante|prestador_servico)_\d+$/;

/**
 * Remove em lote chamando `removerUm(faceId)` individualmente — usado por
 * drivers sem remoção em lote nativa. Uma falha isolada não aborta o lote —
 * a varredura de fantasmas roda de hora em hora e tenta de novo o que
 * sobrou.
 *
 * `removerUm` recebe um `faceId` e devolve (ou resolve para) `{ ok,
 * statusCode? }` (mesmo formato de `okFrom`), podendo também lançar. 404
 * conta como sucesso (usuário já não existia).
 */
async function removerUsuariosPorLoop(cmd, removerUm) {
  const alvos = cmd.faceIds || [];
  if (alvos.length === 0) return { ok: true };
  const falhas = [];
  for (const faceId of alvos) {
    try {
      const r = await removerUm(faceId);
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

module.exports = { NOSSO_EXTERNAL_ID, removerUsuariosPorLoop };
