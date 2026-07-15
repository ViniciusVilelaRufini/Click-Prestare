var yup = require('yup');

module.exports = {

	async validateInsert(req, res, next) {
		try {
			const schema = yup.object().shape({
				bloco: yup.string().required('Informe o bloco.'),
				apto: yup.string().required('Informe o apartamento.'),
				fracao: yup.string().nullable().notRequired(),
			});

			await schema.validate(req.body.Apartamento ?? req.body.apartamento, { abortEarly: false });
			next();
		} catch (error) {
			var message = '';
			error.inner.forEach(e => { message += e.message + '\n'; });
			return res.status(400).json({ message: message });
		}
	},
	
};
