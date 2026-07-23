const db = require('../database/DB_Encomendas.js');
const dbAptos = require('../database/DB_Apartamento.js');
const saveToAWS = require('../utils/saveToAWS');

module.exports = {
  /**
   * Lista encomendas para o síndico ou para o morador (filtrando pelo dele).
   */
  async getAll(req, res) {
    try {
      const { id_condominio, status } = req.query;
      let { bloco, apto } = req.query;
      const user = req.session.user;

      // Enforce data isolation for residents
      if (user.typeAccess === 'Morador') {
        const dbMoradores = require('../database/DB_Moradores');
        const conds = await dbMoradores.listCondominios(user.id);
        
        if (id_condominio) {
          const currentCond = conds.find(c => c.id == id_condominio);
          if (!currentCond) return res.status(200).json([]);
          
          bloco = currentCond.apto_bloco;
          apto = currentCond.apto;
        } else {
          // If no specific condo, get packages across all linked condos
          const result = await db.getAllForResident(user.id, status);
          return res.status(200).json(result);
        }
      }

      const result = await db.getAll(id_condominio, status, bloco, apto);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async insert(req, res) {
    try {
      const { encomenda, id_condominio } = req.body;
      encomenda.id_condominio = id_condominio;
      
      if (encomenda.photo != null) {
        const urlPhoto = await saveToAWS(encomenda.photo, `condominios/${id_condominio}/encomendas`, 'volume');
        encomenda.foto_volume = urlPhoto.url;
      }
      
      await db.insert(encomenda);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  /**
   * Pré-registro pelo morador de uma encomenda que vai chegar (ex.: iFood).
   * Cria a encomenda com status 'Esperando' para o porteiro ver.
   * O apto/bloco é resolvido do próprio usuário (não confia no que vem do app).
   */
  async cadastrar(req, res) {
    try {
      const user = req.session.user;
      const { descricao, recebido_de, codigo_rastreio, codigo_validacao } = req.body;
      let { id_condominio, destinatario_apto, destinatario_bloco } = req.body;

      if (!descricao) return res.status(400).json({ message: 'Descrição é obrigatória.' });

      // Para o morador, resolve o apto/bloco a partir do vínculo dele (segurança:
      // ignora apto/bloco arbitrário vindo do cliente).
      if (user.typeAccess === 'Morador') {
        const dbMoradores = require('../database/DB_Moradores');
        const conds = await dbMoradores.listCondominios(user.id);
        const cond = id_condominio
          ? conds.find((c) => c.id == id_condominio)
          : conds[0];
        if (!cond) {
          return res.status(403).json({ message: 'Você não está vinculado a este condomínio.' });
        }
        id_condominio = cond.id;
        destinatario_apto = cond.apto;
        destinatario_bloco = cond.apto_bloco || '';
      }

      if (!id_condominio || !destinatario_apto) {
        return res.status(400).json({ message: 'Apartamento do destinatário não identificado.' });
      }

      const id = await db.insertEsperado({
        descricao,
        recebido_de: recebido_de || '',
        codigo_rastreio: codigo_rastreio || null,
        codigo_validacao: codigo_validacao || null,
        destinatario_apto,
        destinatario_bloco: destinatario_bloco || '',
        id_condominio,
      });
      return res.status(201).json({ id });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async retirar(req, res) {
    try {
      const user = req.session.user;
      const { id, retirado_por, retirado_foto } = req.body;

      const encomenda = await db.get(id);
      if (!encomenda) return res.status(404).json({ message: "Encomenda não encontrada." });

      let nomeRetirada = retirado_por;

      // Morador dando baixa na propria encomenda (condominio sem portaria):
      // so pode retirar o que esta endereçado ao apto/bloco dele.
      if (user.typeAccess === 'Morador') {
        const dbMoradores = require('../database/DB_Moradores');
        const conds = await dbMoradores.listCondominios(user.id);
        const currentCond = conds.find(c => c.id == encomenda.id_condominio);

        if (!currentCond ||
            encomenda.destinatario_apto !== currentCond.apto ||
            (encomenda.destinatario_bloco && encomenda.destinatario_bloco !== currentCond.apto_bloco)) {
          return res.status(403).json({ message: "Acesso negado: Esta encomenda não pertence ao seu apartamento." });
        }

        // Nome vem da sessao, nao do corpo: o morador nao escolhe quem retirou.
        nomeRetirada = user.nome || currentCond.nome || 'Morador';
      }

      if ((encomenda.status || '').toLowerCase() === 'retirada') {
        return res.status(400).json({ message: "Esta encomenda já foi retirada." });
      }

      await db.retirar(id, nomeRetirada, retirado_foto);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      const user = req.session.user;
      const result = await db.get(req.query.id);

      if (!result) return res.status(404).json({ message: "Encomenda não encontrada." });

      // Enforce isolation for residents
      if (user.typeAccess === 'Morador') {
        const dbMoradores = require('../database/DB_Moradores');
        const conds = await dbMoradores.listCondominios(user.id);
        const currentCond = conds.find(c => c.id == result.id_condominio);

        if (!currentCond || 
            result.destinatario_apto !== currentCond.apto || 
            (result.destinatario_bloco && result.destinatario_bloco !== currentCond.apto_bloco)) {
          return res.status(403).json({ message: "Acesso negado: Esta encomenda não pertence ao seu apartamento." });
        }
      }

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }
};
