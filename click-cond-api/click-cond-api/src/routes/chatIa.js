const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerChatIa');
const jwt = require('../middlewares/jwtVerify.js');

// Chat do Assistente IA — morador, síndico e funcionário podem perguntar.
// O escopo dos dados é aplicado por papel dentro do RagService.
router.post(
  '/perguntar',
  jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }),
  controller.perguntar,
);

// Reindexação das atas/documentos — apenas síndico.
router.post(
  '/reindex',
  jwt({ typeAccess: ['Sindico'] }),
  controller.reindex,
);

module.exports = router;
