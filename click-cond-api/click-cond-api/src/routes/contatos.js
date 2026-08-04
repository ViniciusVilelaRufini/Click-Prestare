const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerContatos');
const jwt = require('../middlewares/jwtVerify.js');

// Mesma divisão de Documentos: síndico escreve, morador só lê.
router.get('/get-all', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.getAll);
router.post('/insert', jwt({ typeAccess: ['Sindico'] }), controller.insert);
router.post('/update', jwt({ typeAccess: ['Sindico'] }), controller.update);
router.post('/remove', jwt({ typeAccess: ['Sindico'] }), controller.remove);

module.exports = router;
