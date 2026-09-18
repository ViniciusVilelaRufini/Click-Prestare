require('dotenv').config();
const db = require('mysql2/promise');

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL } = process.env;
const dbConfig = {
	host: DB_HOST || '',
	port: parseInt(DB_PORT || '3306', 10),
	user: DB_USER || '',
	password: DB_PASSWORD || '',
	database: DB_NAME || '',
	charset: 'utf8mb4',
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0,
	...(DB_SSL === 'true' || DB_SSL === '1' ? { ssl: { rejectUnauthorized: false } } : {})
};

const pool = db.createPool(dbConfig);

async function queryDB(query, params) {
	const start = Date.now();
	try {
		const [results] = params ? await pool.execute(query, params) : await pool.query(query);
		const duration = Date.now() - start;
		if (duration > 100) console.log(`[DB] Slow Query (${duration}ms):`, query.substring(0, 100));
		return { status: 'Success', results };
	} catch (err) {
		console.error('[DB] Query error:', err.code, err.message);
		throw err;
	}
}

async function queryParamDB(query, params) {
	try {
		const [results] = await pool.execute(query, params);
		return { status: 'Success', results };
	} catch (err) {
		console.error('[DB] Param Query error:', err.code, err.message);
		throw err;
	}
}

module.exports = {
	query: queryDB,
	queryParam: queryParamDB,
};
