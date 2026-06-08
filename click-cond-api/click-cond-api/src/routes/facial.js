const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerAcessos');
const jwt = require('../middlewares/jwtVerify.js');

// Paridade com o NestJS de produção: histórico de acessos do visitante para o app.
router.get(
  '/acessos/visitante/:id',
  jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }),
  controller.getByVisitante,
);

module.exports = router;
