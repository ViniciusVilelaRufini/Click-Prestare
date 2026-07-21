const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerOcorrencias');
const jwt = require('../middlewares/jwtVerify.js');
const validate = require('../validations/ValidationOcorrencia.js');

router.post('/insert', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), validate.validateInsert, controller.insert);
router.get('/todos/get-all', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.getAll);
router.get('/pendentes/get-all', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.getAllPendentes);
router.post('/remove', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.remove);
router.post('/update', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }),   validate.validateInsert, controller.update);
router.get('/get', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.get);
router.post('/update-status', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.updateStatus);
router.post('/update-responsavel', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.updateResponsavel);
router.get('/categorias/get-all', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.getAllCategorias);
router.post('/categorias/insert', jwt({ typeAccess: ['Sindico'] }), controller.insertCategoria);
router.post('/categorias/update', jwt({ typeAccess: ['Sindico'] }), controller.updateCategoria);
router.post('/categorias/remove', jwt({ typeAccess: ['Sindico'] }), controller.removeCategoria);

module.exports = router;
