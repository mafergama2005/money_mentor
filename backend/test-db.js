
const pool = require('./database');

async function probarConexion() {
    try {
        const [rows] = await pool.query('SELECT 1 AS conexion');

        console.log('¡Conexión exitosa con MySQL!');
        console.log(rows);

    } catch (error) {
        console.error('Error al conectar con MySQL:', error.message);

    } finally {
        await pool.end();
    }
}

probarConexion();
