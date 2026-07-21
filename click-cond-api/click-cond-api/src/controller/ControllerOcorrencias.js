const db = require('../database/DB_Ocorrencias.js');
const dbMoradores = require('../database/DB_Moradores.js');
const notifications = require('../services/Notifications.js');
const saveToAWS = require('../utils/saveToAWS');

module.exports = {
  async insert(req, res) {
    try {
      var listDocs = [];

      for (var i = 0; i < req.body.ocorrencia.docs.length; i++) {      
        const doc = req.body.ocorrencia.docs[i];
        const urlPhotoProfile = await saveToAWS(doc, `condominios/${req.body.id_condominio}/ocorrencias`, '');
        listDocs.push(urlPhotoProfile.url);
      }
      await db.insert(req.body.id_condominio, req.body.ocorrencia, req.session.user.id, listDocs);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAll(req, res) {
    try {
      console.log('[ControllerOcorrencias.getAll] User:', req.session.user?.typeAccess, 'ID:', req.session.user?.id);
      if(req.session.user.typeAccess == 'Sindico' || req.session.user.typeAccess == 'Funcionario'){
        const result = await db.getAll(req.query.id_condominio, req.query.offset, '', null);
        return res.status(200).json(result);
      }else if(req.session.user.typeAccess == 'Morador'){
        const result = await db.getAll(req.query.id_condominio, req.query.offset, '', req.session.user.id);
        return res.status(200).json(result);
      } else {
        console.warn('[ControllerOcorrencias.getAll] Unknown typeAccess:', req.session.user.typeAccess);
        return res.status(200).json([]);
      }
    } catch (err) {
      console.error('[ControllerOcorrencias.getAll] Error:', err);
      return res.status(500).json({ message: err.message });
    }
  },

  async getAllPendentes(req, res) {
    try {
      if(req.session.user.typeAccess == 'Sindico' || req.session.user.typeAccess == 'Funcionario'){
        const result = await db.getAll(req.query.id_condominio, req.query.offset, 'pendente');
        return res.status(200).json(result);
      }else if(req.session.user.typeAccess == 'Morador'){
        const result = await db.getAll(req.query.id_condominio, req.query.offset, 'pendente', req.session.user.id);
        return res.status(200).json(result);
      } 
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async getAllCategorias(req, res) {
    try {
      const result = await db.getAllCategorias();
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
        const creatorId = await db.getCreatorId(id);
        if (creatorId !== user.id) {
          return res.status(403).json({ message: "Acesso negado: Você só pode remover as suas próprias ocorrências." });
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
      const { id_condominio, ocorrencia } = req.body;

      if (user.typeAccess === 'Morador') {
        const creatorId = await db.getCreatorId(ocorrencia.id);
        if (creatorId !== user.id) {
          return res.status(403).json({ message: "Acesso negado: Você só pode editar as suas próprias ocorrências." });
        }
      }

      if(ocorrencia.isResposta && ocorrencia.isResposta == true){
        await db.setResposta(id_condominio, ocorrencia, user.id); 
        
        // Notificar o morador que criou a ocorrência
        const creatorId = await db.getCreatorId(ocorrencia.id);
        if (creatorId) {
          const tokens = await dbMoradores.getTokensForOcorrencias(creatorId);
          if (tokens.length > 0) {
            await notifications.sendToTokens(
              tokens,
              'Atualização na sua Ocorrência',
              `O síndico respondeu à sua ocorrência: ${ocorrencia.status}`,
              { id: ocorrencia.id.toString(), type: 'ocorrencia' }
            );
          }
        }
      }else{
        var listDocs = [];
        for (var i = 0; i < ocorrencia.docs.length; i++) {      
          const doc = ocorrencia.docs[i];
          const urlPhotoProfile = await saveToAWS(doc, `condominios/${id_condominio}/ocorrencias`, '');
          listDocs.push(urlPhotoProfile.url);
        }
        await db.update(id_condominio, ocorrencia, user.id, listDocs); 
      } 
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async get(req, res) {
    try {
      const user = req.session.user;
      const result = await db.get(req.query.id_condominio, req.query.id);

      if (!result) return res.status(404).json({ message: "Ocorrência não encontrada." });

      // Enforce isolation for residents
      if (user.typeAccess === 'Morador') {
        if (result.id_user !== user.id) {
          return res.status(403).json({ message: "Acesso negado: Você só pode ver detalhes das suas próprias ocorrências." });
        }
      }

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateStatus(req, res) {
    try {
      await db.updateStatus(req.body.id_condominio, req.body.id, req.body.status);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  // Atribui a ocorrencia a um funcionario (Users.id). Push do responsavel roda no
  // NestJS (prod); em dev apenas persiste. id_responsavel null desatribui.
  async updateResponsavel(req, res) {
    try {
      const user = req.session.user;
      if (user.typeAccess !== 'Sindico' && user.typeAccess !== 'Funcionario') {
        return res.status(403).json({ message: 'Acesso negado.' });
      }
      await db.updateResponsavel(req.body.id_condominio, req.body.id, req.body.id_responsavel);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async insertCategoria(req, res) {
    try {
      if (req.session.user.typeAccess !== 'Sindico') return res.status(403).json({ message: 'Acesso negado.' });
      await db.insertCategoria(req.body.categoria || req.body);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async updateCategoria(req, res) {
    try {
      if (req.session.user.typeAccess !== 'Sindico') return res.status(403).json({ message: 'Acesso negado.' });
      const cat = req.body.categoria || req.body;
      await db.updateCategoria(cat.id, cat);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

  async removeCategoria(req, res) {
    try {
      if (req.session.user.typeAccess !== 'Sindico') return res.status(403).json({ message: 'Acesso negado.' });
      await db.removeCategoria(req.body.id);
      return res.json();
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  },

};