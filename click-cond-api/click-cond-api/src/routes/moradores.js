const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerMoradores');
const jwt = require('../middlewares/jwtVerify.js');
const validate = require('../validations/ValidationMorador.js');

router.post('/login', controller.login);
router.post('/insert', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), validate.validateInsert, controller.insert);
router.post('/insert-familiar', jwt({ typeAccess: ['Morador'] }), validate.validateInsertFamiliar, controller.insertFamiliar);
router.post('/recovery-password', validate.validateRecovery, controller.recoveryPassword);
router.post('/new-password', jwt({ typeAccess: ['Morador'] }), controller.newPassword);
router.get('/get-all', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.getAll);
router.post('/remove', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.remove);
router.post('/update', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }),  validate.validateInsert, controller.update);
router.post('/update-assinatura', jwt({ typeAccess: ['Morador'] }), controller.updateAssinatura);
router.get('/get', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.get);
router.get('/list-condominios', jwt({ typeAccess: ['Morador', 'Funcionario'] }), controller.listCondominios);
router.post('/send-credentials', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.sendCredentials);

module.exports = router;

