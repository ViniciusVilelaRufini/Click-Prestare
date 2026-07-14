const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerRelatorios');
const jwt = require('../middlewares/jwtVerify.js');

// GET /condominios/:id/relatorios — paridade com o NestJS. Só síndico.
router.get('/:id/relatorios', jwt({ typeAccess: ['Sindico'] }), controller.download);

module.exports = router;
