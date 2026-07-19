const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerVisitantes');
const jwt = require('../middlewares/jwtVerify.js');
const validate = require('../validations/ValidationVisitantes.js');

router.post('/insert', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), validate.validateInsert, controller.insert);
router.get('/get-all', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.getAll);
router.post('/remove', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.remove);
router.post('/update', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), validate.validateInsert, controller.update);
router.get('/get', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.get);
router.post('/check-in', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.checkIn);
router.post('/check-out', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.checkOut);
router.get('/validar/:codigo', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.validarCodigo);

// Portaria remota — autorização em tempo real.
// Rota estática 'pendentes' antes das rotas com :id para não colidir.
router.get('/pendentes', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.pendentes);
router.post('/:id/solicitar-autorizacao', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.solicitarAutorizacao);
router.post('/:id/autorizar', jwt({ typeAccess: ['Morador'] }), controller.autorizar);
router.post('/:id/negar', jwt({ typeAccess: ['Morador'] }), controller.negar);


module.exports = router;
