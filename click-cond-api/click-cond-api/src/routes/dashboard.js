const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerDashboard');
const jwt = require('../middlewares/jwtVerify.js');

router.post('/login', controller.login);
router.get('/condominios/get-all', jwt({ typeAccess: ['Admin'] }), controller.getAllCondominios);
router.get('/get-all', jwt({ typeAccess: ['Admin'] }), controller.getDashboard);
router.get('/summary', jwt({ typeAccess: ['Sindico', 'Morador'] }), controller.getSummary);
router.get('/meus-eventos', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.getMeusEventos);

module.exports = router;
