const db = require('../database/MySQL.js');
const jwt = require('jsonwebtoken');
const config = require('../configs/config');

module.exports = async function (req, res, next) {
  try {
    const id_condominio = req.query.id_condominio || req.body.id_condominio;
    
    // If no id_condominio is requested, proceed
    if (!id_condominio || id_condominio === 'null' || id_condominio === 'undefined' || id_condominio === '0') {
      return next();
    }

    let user = req.session.user;

    // If session user isn't populated yet, parse the JWT
    if (!user) {
      const token = req.headers["authorization"];
      if (token) {
        try {
          const decoded = jwt.verify(token, config.jwt.secretKey);
          user = decoded.user;
          req.session.user = user;
        } catch (e) {
          // invalid token
        }
      }
    }

    if (!user) {
      return res.status(401).json({ message: "Usuário não autenticado." });
    }

    // Cache permissions in session to avoid DB hits on every request
    if (!req.session.permissions) req.session.permissions = {};
    const cacheKey = `${user.id}_${id_condominio}`;
    if (req.session.permissions[cacheKey]) {
      return next();
    }

    const userId = user.id;
    const typeAccess = user.typeAccess;

    let hasAccess = false;

    if (typeAccess === 'Sindico') {
      const query = `SELECT id FROM Sindicos_Condominios WHERE id_user = ? AND id_condominio = ?`;
      const check = await db.queryParam(query, [userId, id_condominio]);
      if (check.results && check.results.length > 0) hasAccess = true;
    } 
    else if (typeAccess === 'Funcionario') {
      const query = `SELECT id FROM Funcionarios WHERE id_user = ? AND id_condominio = ?`;
      const check = await db.queryParam(query, [userId, id_condominio]);
      if (check.results && check.results.length > 0) hasAccess = true;
    } 
    else if (typeAccess === 'Morador') {
      const query = `
        SELECT au.id 
        FROM Apartamentos_Users au
        INNER JOIN Apartamentos a ON a.id = au.id_apto
        WHERE au.id_user = ? AND a.id_condominio = ?
      `;
      const check = await db.queryParam(query, [userId, id_condominio]);
      if (check.results && check.results.length > 0) hasAccess = true;
    }

    if (!hasAccess) {
      console.warn(`[SECURITY] User ${userId} (${typeAccess}) attempted to access Condominio ${id_condominio} without permission.`);
      return res.status(403).json({ message: "Acesso negado: Você não tem permissão para acessar os dados deste condomínio." });
    }

    // Cache the successful verification
    req.session.permissions[cacheKey] = true;

    next();
  } catch (err) {
    console.error("[CondominioVerify Middleware Error]", err);
    return res.status(500).json({ message: "Erro ao verificar permissões de condomínio." });
  }
};
