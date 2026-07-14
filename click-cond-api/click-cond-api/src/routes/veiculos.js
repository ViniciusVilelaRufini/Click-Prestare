const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerVeiculos');
const jwt = require('../middlewares/jwtVerify.js');

// Veículos do morador (app). O escopo é aplicado por usuário dentro do controller.
router.get('/get-all', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.getAll);
router.post('/insert', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.insert);
router.post('/update', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.update);
router.post('/remove', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.remove);

module.exports = router;
