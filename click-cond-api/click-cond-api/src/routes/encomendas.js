const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerEncomendas');
const jwt = require('../middlewares/jwtVerify.js');

router.get('/get-all', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.getAll);
router.post('/insert', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.insert);
router.post('/cadastrar', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.cadastrar);
router.post('/retirar', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.retirar);
router.get('/get', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.get);

module.exports = router;
