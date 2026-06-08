require('dotenv').config();
const express = require('express');
const path = require('path');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const upload = require('express-fileupload');
const session = require('express-session');
const cors = require('cors');
const compression = require('compression');

const condominioRoutes = require('./src/routes/condominio');
const sindicoRoutes = require('./src/routes/sindico');
const documentosRouter = require('./src/routes/documentos');
const comunicadosRouter = require('./src/routes/comunicados');
const agendaRouter = require('./src/routes/agenda');
const manutencoesRouter = require('./src/routes/manutencoes');
const ocorrenciasRouter = require('./src/routes/ocorrencias');
const prestadoresRouter = require('./src/routes/prestadores');
const mudancasRouter = require('./src/routes/mudancas');
const visitantesRouter = require('./src/routes/visitantes');
const funcionariosRouter = require('./src/routes/funcionarios');
const moradoresRouter = require('./src/routes/moradores');
const apartamentosRouter = require('./src/routes/apartamentos');
const assembleiasRouter = require('./src/routes/assembleias');
const areasSociaisRouter = require('./src/routes/areasSociais');
const financeiroRouter = require('./src/routes/financeiro');
const dashboardRouter = require('./src/routes/dashboard');
const encomendasRouter = require('./src/routes/encomendas');
const usersRouter = require('./src/routes/users');
const facialRouter = require('./src/routes/facial');

const app = express();

// Strip /api prefix if present (since mobile app sends /api/...)
app.use((req, res, next) => {
	if (req.url.startsWith('/api/')) {
		req.url = req.url.substring(4);
	} else if (req.url === '/api') {
		req.url = '/';
	}
	next();
});

app.use(compression());
app.use(cors());
app.use(session({ secret: process.env.SESSION_SECRET || 'dev-session-secret' }));
app.use(upload());

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(express.json({ limit: '100mb', extended: true }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to prevent IDOR on Condominios
const condominioVerify = require('./src/middlewares/condominioVerify');
app.use(condominioVerify);

app.use('/condominio', condominioRoutes);
app.use('/sindico', sindicoRoutes);
app.use('/documentos', documentosRouter);
app.use('/comunicados', comunicadosRouter);
app.use('/agenda', agendaRouter);
app.use('/manutencoes', manutencoesRouter);
app.use('/ocorrencias', ocorrenciasRouter);
app.use('/prestadores', prestadoresRouter);
app.use('/mudancas', mudancasRouter);
app.use('/users', usersRouter);
app.use('/visitantes', visitantesRouter);
app.use('/funcionarios', funcionariosRouter);
app.use('/moradores', moradoresRouter);
app.use('/assembleias', assembleiasRouter);
app.use('/areas-sociais', areasSociaisRouter);
app.use('/financeiro', financeiroRouter);
app.use('/apartamentos', apartamentosRouter);
app.use('/dashboard', dashboardRouter);
app.use('/encomendas', encomendasRouter);
app.use('/facial', facialRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
	const err = new Error('Not Found');
	err.status = 404;
	next(err);
});

const loggerUtil = require('./src/utils/logger');
// error handler
app.use(function (err, req, res) {
	loggerUtil.error(err);
	// set locals, only providing error in development
	res.locals.message = err.message;
	res.locals.error = req.app.get('env') === 'development' ? err : {};

	// render the error page
	res.status(err.status || 500);
	res.render('error');
});

module.exports = app;
