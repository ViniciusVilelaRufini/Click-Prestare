const db = require('../database/DB_Vagas.js');

function mapVaga(r) {
  return {
    id: r.id,
    tipo_ocupacao: r.tipo_ocupacao,
    id_veiculo: r.id_veiculo,
    id_visitante: r.id_visitante,
    id_morador_beneficiario: r.id_morador_beneficiario,
    placa: r.placa || r.veiculo_placa || null,
    inicio: r.inicio,
    fim: r.fim,
    ocupante_nome:
      r.tipo_ocupacao === 'visitante' ? r.visitante_nome
        : r.tipo_ocupacao === 'inquilino' ? r.beneficiario_nome
          : r.titular_nome,
  };
}

module.exports = {
  async getAll(req, res) {
    try {
      const user = req.session.user;
      const ctx = await db.getMoradorApto(user.id, req.query.id_condominio);
      if (!ctx) return res.status(200).json({ qtd_vagas: 0, ocupadas: 0, vagas: [] });
      const vagas = await db.getVagasAtivas(ctx.idApto);
      return res.status(200).json({
        qtd_vagas: ctx.qtdVagas,
        ocupadas: vagas.length,
        vagas: vagas.map(mapVaga),
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async beneficiarios(req, res) {
    try {
      const user = req.session.user;
      const ctx = await db.getMoradorApto(user.id, req.query.id_condominio);
      if (!ctx) return res.status(200).json({ visitantes: [], inquilinos: [] });
      const [visitantes, inquilinos] = await Promise.all([
        db.getVisitantesApto(ctx.idApto),
        db.getInquilinosApto(ctx.idApto),
      ]);
      return res.status(200).json({ visitantes, inquilinos });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async liberar(req, res) {
    try {
      const user = req.session.user;
      const body = req.body || {};
      const ctx = await db.getMoradorApto(user.id, body.id_condominio);
      if (!ctx) return res.status(403).json({ message: 'Você não é morador deste condomínio.' });

      const tipo = String(body.tipo || '');
      if (tipo !== 'visitante' && tipo !== 'inquilino') {
        return res.status(400).json({ message: 'Tipo de liberação inválido.' });
      }

      const ativas = await db.countAtivas(ctx.idApto);
      if (ativas >= ctx.qtdVagas) {
        return res.status(400).json({ message: 'Não há vagas livres neste apartamento.' });
      }

      const inicio = body.inicio ? new Date(body.inicio) : null;
      const fim = body.fim ? new Date(body.fim) : null;
      const placa = body.placa ? String(body.placa).toUpperCase().trim() : null;

      let idVisitante = null;
      let idBeneficiario = null;

      if (tipo === 'visitante') {
        idVisitante = Number(body.id_visitante) || null;
        if (!idVisitante) return res.status(400).json({ message: 'Selecione um visitante cadastrado.' });
        const vis = await db.getVisitanteApto(idVisitante, ctx.idApto);
        if (!vis) return res.status(400).json({ message: 'Visitante não encontrado neste apartamento.' });
        await db.liberarVisitanteAcesso(idVisitante, inicio, fim);
      } else {
        idBeneficiario = Number(body.id_morador_beneficiario) || null;
        if (!idBeneficiario) return res.status(400).json({ message: 'Selecione um inquilino.' });
        const inq = await db.getMoradorById(idBeneficiario, ctx.idCondominio);
        if (!inq) return res.status(400).json({ message: 'Inquilino não encontrado.' });
      }

      const id = await db.insertVaga({
        id_condominio: ctx.idCondominio,
        id_apartamento: ctx.idApto,
        id_morador_titular: ctx.idMorador,
        tipo_ocupacao: tipo,
        id_veiculo: Number(body.id_veiculo) || null,
        id_visitante: idVisitante,
        id_morador_beneficiario: idBeneficiario,
        placa,
        inicio,
        fim,
      });
      return res.status(201).json({ id });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async revogar(req, res) {
    try {
      const user = req.session.user;
      const { id, id_condominio } = req.body || {};
      const ctx = await db.getMoradorApto(user.id, id_condominio);
      if (!ctx) return res.status(403).json({ message: 'Acesso negado.' });
      const affected = await db.revogar(id, ctx.idApto);
      if (!affected) return res.status(400).json({ message: 'Vaga não encontrada.' });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
};
