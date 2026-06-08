const db = require('../database/DB_Visitantes.js');
const dbAptos = require('../database/DB_Apartamento.js');
const saveToAWS = require('../utils/saveToAWS');

module.exports = {
  async insert(req, res) {
    try {
      const { id_condominio, visitante } = req.body;
      const user = req.session.user;

      // O app envia a foto na chave `photo`; aceitar como fallback de foto_pessoa
      // (paridade com o NestJS de produção: foto_pessoa || photo).
      if (visitante && !visitante.foto_pessoa && visitante.photo) {
        visitante.foto_pessoa = visitante.photo;
      }

      // Validate apartment for residents during registration
      if (user.typeAccess === 'Morador') {
        const userAptos = await dbAptos.getApartmentsByUser(user.id, id_condominio);
        if (!userAptos.includes(parseInt(visitante.id_apartamento))) {
          return res.status(403).json({ message: "Acesso negado: Você só pode registrar visitantes para o seu próprio apartamento." });
        }
      }

      // Upload foto_pessoa para S3 se for base64
      if (visitante.foto_pessoa && visitante.foto_pessoa.includes('base64')) {
        const urlPessoa = await saveToAWS(visitante.foto_pessoa, `condominios/${id_condominio}/visitantes`, 'pessoa');
        visitante.foto_pessoa = urlPessoa.url;
      }

      // Upload foto_documento para S3 se for base64
      if (visitante.foto_documento && visitante.foto_documento.includes('base64')) {
        const urlDoc = await saveToAWS(visitante.foto_documento, `condominios/${id_condominio}/visitantes`, 'documento');
        visitante.foto_documento = urlDoc.url;
      }

      const saved = await db.insert(id_condominio, visitante, user.id);
      return res.json(saved);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAll(req, res) {
    try {
      let id_apto = req.query.id_apto;
      const id_condominio = req.query.id_condominio;
      const user = req.session.user;

      let filterUserId = null;
      let idAptosPermitidos = null; // lista de aptos quando o usuário é restrito

      // Isolamento de dados no APP: TODOS (morador, síndico, funcionário) só veem
      // visitantes dos próprios apartamentos vinculados. A gestão da portaria (ver
      // todos) é só no console web. Sem vínculo de apto → não vê nada.
      // A fonte da verdade é o servidor (nunca confia no id_apto do client).
      if (id_condominio) {
        const userAptos = await dbAptos.getApartmentsByUser(user.id, id_condominio);
        filterUserId = user.id;
        if (userAptos.length === 0) {
          return res.status(200).json([]);
        }
        if (id_apto && !userAptos.includes(parseInt(id_apto))) {
          console.warn(`[SECURITY] User ${user.id} (${user.typeAccess}) tentou acessar Apto ${id_apto} sem permissão.`);
          return res.status(403).json({ message: "Acesso negado: Este apartamento não pertence a você." });
        }
        if (!id_apto) {
          idAptosPermitidos = userAptos; // filtra por TODOS os aptos do usuário
        }
      }

      const result = await db.getAll(id_condominio, req.query.offset || 0, id_apto, req.query.search, filterUserId, idAptosPermitidos);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async remove(req, res) {
    try {
      const user = req.session.user;
      const id = req.body.id;

      if (user.typeAccess === 'Morador') {
        const visitante = await db.getById(id); // I need to check if getById exists or use get
        if (!visitante) return res.status(404).json({ message: "Visitante não encontrado." });
        
        const userAptos = await dbAptos.getApartmentsByUser(user.id, visitante.id_condominio);
        if (!userAptos.includes(visitante.id_apartamento)) {
          return res.status(403).json({ message: "Acesso negado." });
        }
      }

      await db.remove(id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async update(req, res) {
    try {
      const user = req.session.user;
      const { id_condominio, visitante } = req.body;

      // O app envia a foto na chave `photo`; aceitar como fallback de foto_pessoa
      // (paridade com o NestJS de produção: foto_pessoa || photo).
      if (visitante && !visitante.foto_pessoa && visitante.photo) {
        visitante.foto_pessoa = visitante.photo;
      }

      if (user.typeAccess === 'Morador') {
        const existing = await db.getById(visitante.id);
        if (!existing) return res.status(404).json({ message: "Visitante não encontrado." });
        
        const userAptos = await dbAptos.getApartmentsByUser(user.id, id_condominio);
        if (!userAptos.includes(existing.id_apartamento)) {
          return res.status(403).json({ message: "Acesso negado." });
        }
      }

      // Upload foto_pessoa para S3 se for base64 e modificada
      if (visitante.foto_pessoa && visitante.foto_pessoa.includes('base64')) {
        const urlPessoa = await saveToAWS(visitante.foto_pessoa, `condominios/${id_condominio}/visitantes`, 'pessoa');
        visitante.foto_pessoa = urlPessoa.url;
      }

      // Upload foto_documento para S3 se for base64 e modificada
      if (visitante.foto_documento && visitante.foto_documento.includes('base64')) {
        const urlDoc = await saveToAWS(visitante.foto_documento, `condominios/${id_condominio}/visitantes`, 'documento');
        visitante.foto_documento = urlDoc.url;
      }

      await db.update(id_condominio, visitante);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      const user = req.session.user;
      const id = req.query.id;

      // Buscar o visitante pelo ID primeiro para descobrir o condomínio real dele
      const existing = await db.getById(id);
      if (!existing) return res.status(404).json({ message: "Visitante não encontrado." });

      const realCondId = existing.id_condominio;
      const result = await db.get(realCondId, id);

      if (!result) return res.status(404).json({ message: "Visitante não encontrado." });

      if (user.typeAccess === 'Morador') {
        const userAptos = await dbAptos.getApartmentsByUser(user.id, realCondId);
        if (!userAptos.includes(existing.id_apartamento)) {
          return res.status(403).json({ message: "Acesso negado." });
        }
      }

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async checkIn(req, res) {
    try {
      await db.checkIn(req.body.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async checkOut(req, res) {
    try {
      await db.checkOut(req.body.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async validarCodigo(req, res) {
    try {
      const { codigo } = req.params;
      const user = req.session.user;
      
      const id_condominio = req.query.id_condominio || user.id_condominio; 
      
      if (!id_condominio) {
        return res.status(400).json({ message: "Condomínio não especificado." });
      }

      const visitante = await db.getByCode(id_condominio, codigo);
      if (!visitante) {
        return res.status(404).json({ message: "Código inválido ou visita não agendada/já encerrada." });
      }

      const now = new Date();
      const inicio = new Date(visitante.data_hora_inicio);
      const termino = new Date(visitante.data_hora_termino);
      
      let status = "ATIVO";
      if (now < inicio) {
        status = "FUTURO";
      } else if (now > termino) {
        status = "EXPIRADO";
      }

      return res.status(200).json({
        ...visitante,
        status_vigencia: status
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },
};