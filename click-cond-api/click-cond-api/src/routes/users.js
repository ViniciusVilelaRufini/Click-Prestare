const { Router } = require('express');
const router = Router();
const controller = require('../controller/ControllerUser');
const jwt = require('../middlewares/jwtVerify.js');

router.post('/update-fcm-token', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.updateFcmToken);
router.get('/settings', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.getNotificationSettings);
router.post('/settings', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.updateNotificationSettings);
router.post('/delete-account', jwt({ typeAccess: ['Sindico', 'Morador', 'Funcionario'] }), controller.deleteAccount);

module.exports = router;
