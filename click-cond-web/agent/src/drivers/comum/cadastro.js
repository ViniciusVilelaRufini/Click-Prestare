'use strict';

/**
 * agent/src/drivers/comum/cadastro.js — validação do comando de cadastro
 * (enroll/update) comum aos drivers.
 */

/**
 * Identificador do cadastro (externalId, senão faceId) como string não
 * vazia, ou `null` quando os dois faltam. Os drivers faziam
 * `String(cmd.externalId || cmd.faceId)`: com os dois ausentes isso vira a
 * string "undefined" e o aparelho ganhava um usuário com esse nome.
 */
function idDoCadastro(cmd) {
  for (const v of [cmd && cmd.externalId, cmd && cmd.faceId]) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

module.exports = { idDoCadastro };
