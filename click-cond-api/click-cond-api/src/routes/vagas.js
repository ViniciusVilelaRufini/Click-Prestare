const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerVagas');
const jwt = require('../middlewares/jwtVerify.js');

// Vagas do apartamento (app). Escopo aplicado por usuário/apto no controller.
router.get('/get-all', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.getAll);
router.get('/beneficiarios', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.beneficiarios);
router.post('/liberar', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.liberar);
router.post('/revogar', jwt({ typeAccess: ['Morador', 'Sindico', 'Funcionario'] }), controller.revogar);

module.exports = router;
