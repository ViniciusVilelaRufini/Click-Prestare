const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerSindico');
const validate = require('../validations/ValidationSindico.js');
const jwt = require('../middlewares/jwtVerify.js');

router.post('/login', validate.validateLogin, controller.login);
router.post('/signup', validate.validateSignup, controller.signup);
router.post('/update', jwt({ typeAccess: ['Sindico'] }), validate.validateUpdate, controller.update);
router.post('/recovery-password', validate.validateRecovery, controller.recoveryPassword);
router.post('/new-password', jwt({ typeAccess: ['Sindico'] }), controller.newPassword);
router.get('/list-condominios', jwt({ typeAccess: ['Sindico'] }), controller.listCondominios);
router.get('/get', jwt({ typeAccess: ['Sindico'] }), controller.getData);
router.post('/link-morador', jwt({ typeAccess: ['Sindico'] }), controller.linkMorador);
router.get('/list-sindicos', jwt({ typeAccess: ['Sindico', 'Funcionario'] }), controller.listSindicos);


module.exports = router;
