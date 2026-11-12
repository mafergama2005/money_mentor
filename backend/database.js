const mysql = require('mysql2/promise');
require('dotenv').config();

// En la nube (TiDB Cloud) la conexión debe ir cifrada con SSL.
// En tu computadora no se usa: deja DB_SSL vacío o en false.
const usarSSL = process.env.DB_SSL === 'true';

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: usarSSL ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;