var yup = require('yup');

module.exports = {

	async validateInsert(req, res, next) {
		try {
			const schema = yup.object().shape({
				nome: yup.string().required('Informe o nome.'),
				email: yup.string().required('Informe o email.'),
				data_nascimento: yup.string().required('Informe a data de nascimento.'),
				documento: yup.string().required('Informe o documento.'),
				telefone: yup.string().required('Informe o telefone.'),
				// tipo: yup.string().required('Informe o tipo Proprietário/Inquilino.'),
			});

			await schema.validate(req.body.morador, { abortEarly: false });
			next();
		} catch (error) {
			var message = '';
			error.inner.forEach(e => { message += e.message + '\n'; });
			return res.status(400).json({ message: message });
		}
	},

	// Cadastro de familiar feito pelo próprio morador (proprietário).
	// E-mail só é obrigatório quando o morador opta por enviar credenciais/acesso ao app.
	async validateInsertFamiliar(req, res, next) {
		try {
			const sendCredentials = req.body.morador && req.body.morador.sendCredentials === true;
			const schema = yup.object().shape({
				nome: yup.string().required('Informe o nome.'),
				documento: yup.string().required('Informe o documento.'),
				id_apto: yup.string().required('Apartamento não informado.'),
				email: sendCredentials
					? yup.string().email('E-mail inválido').required('Informe o e-mail para enviar o acesso.')
					: yup.string().email('E-mail inválido').nullable(),
			});

			await schema.validate(req.body.morador, { abortEarly: false });
			next();
		} catch (error) {
			var message = '';
			error.inner.forEach(e => { message += e.message + '\n'; });
			return res.status(400).json({ message: message });
		}
	},

	async validateRecovery(req, res, next) {
		try {
			const schema = yup.object().shape({
				email: yup.string().email('E-mail inválido').required('E-mail inválido'),
			});

			await schema.validate(req.body, { abortEarly: false });
			next();
		} catch (error) {
			var message = '';
			error.inner.forEach(e => { message += e.message + '\n'; });
			return res.status(400).json({ message: message });
		}
	},
	
};
