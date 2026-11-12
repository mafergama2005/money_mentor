const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const pool = require('./database');
const { responderIA, iaConfigurada, proveedorActivo } = require('./ia');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===============================
// AUTENTICACIÓN
// ===============================

function verificarToken(req, res, next) {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith('Bearer ')) {
        return res.status(401).json({
            mensaje: 'No autorizado. Inicia sesión.'
        });
    }

    const token = authorization.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.id;
        next();
    } catch (error) {
        return res.status(401).json({
            mensaje: 'Tu sesión no es válida o ha expirado.'
        });
    }
}

// Convierte un DATE de MySQL a 'AAAA-MM-DD' sin desfase de zona horaria
function fechaISO(valor) {
    if (!valor) return null;
    if (typeof valor === 'string') return valor.slice(0, 10);

    const fecha = new Date(valor);
    return [
        fecha.getFullYear(),
        String(fecha.getMonth() + 1).padStart(2, '0'),
        String(fecha.getDate()).padStart(2, '0')
    ].join('-');
}

const ICONOS_META = ['star', 'plane', 'home', 'laptop', 'car', 'gift', 'shield', 'wallet'];

function iconoValido(icono) {
    return ICONOS_META.includes(icono) ? icono : 'star';
}

function generarToken(id) {
    return jwt.sign(
        { id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
}

// ===============================
// RUTAS GENERALES
// ===============================

app.get('/', (req, res) => {
    res.send('MoneyMentor API funcionando 💙');
});

app.get('/api/health', (req, res) => {
    res.json({
        estado: 'OK',
        mensaje: 'Servidor MoneyMentor funcionando correctamente.'
    });
});

// ===============================
// REGISTRO
// ===============================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { nombre, correo, password } = req.body;

        if (!nombre || !correo || !password) {
            return res.status(400).json({
                mensaje: 'Completa todos los campos.'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                mensaje: 'La contraseña debe tener al menos 8 caracteres.'
            });
        }

        const email = correo.trim().toLowerCase();

        const [existing] = await pool.execute(
            'SELECT id FROM usuarios WHERE correo = ?',
            [email]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                mensaje: 'Este correo ya está registrado.'
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await pool.execute(
            `INSERT INTO usuarios (nombre, correo, password_hash)
             VALUES (?, ?, ?)`,
            [nombre.trim(), email, passwordHash]
        );

        const token = generarToken(result.insertId);

        return res.status(201).json({
            mensaje: 'Cuenta creada correctamente.',
            token,
            usuario: {
                id: result.insertId,
                nombre: nombre.trim(),
                correo: email
            }
        });

    } catch (error) {
        console.error('Error en registro:', error);

        res.status(500).json({
            mensaje: 'No se pudo crear la cuenta.'
        });
    }
});

// ===============================
// INICIO DE SESIÓN
// ===============================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { correo, password } = req.body;

        if (!correo || !password) {
            return res.status(400).json({
                mensaje: 'Ingresa tu correo y contraseña.'
            });
        }

        const email = correo.trim().toLowerCase();

        const [rows] = await pool.execute(
            'SELECT * FROM usuarios WHERE correo = ?',
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                mensaje: 'El correo o la contraseña son incorrectos.'
            });
        }

        const usuario = rows[0];

        const passwordCorrecta = await bcrypt.compare(
            password,
            usuario.password_hash
        );

        if (!passwordCorrecta) {
            return res.status(401).json({
                mensaje: 'El correo o la contraseña son incorrectos.'
            });
        }

        const token = generarToken(usuario.id);

        return res.json({
            mensaje: 'Inicio de sesión correcto.',
            token,
            usuario: {
                id: usuario.id,
                nombre: usuario.nombre,
                correo: usuario.correo
            }
        });

    } catch (error) {
        console.error('Error en login:', error);

        res.status(500).json({
            mensaje: 'No se pudo iniciar sesión.'
        });
    }
});

// ===============================
// CONSULTAR USUARIO AUTENTICADO
// ===============================

app.get('/api/auth/me', verificarToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT id, nombre, correo, objetivo, ingreso_mensual,
                    deudas, intereses, notificaciones_activadas,
                    setup_completado, tour_completado
             FROM usuarios
             WHERE id = ?`,
            [req.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                mensaje: 'Usuario no encontrado.'
            });
        }

        res.json({ usuario: rows[0] });

    } catch (error) {
        console.error('Error al consultar usuario:', error);

        res.status(500).json({
            mensaje: 'No se pudo consultar el usuario.'
        });
    }
});

// ===============================
// ACTUALIZAR PERFIL
// ===============================

app.put('/api/users/profile', verificarToken, async (req, res) => {
    try {
        const {
            nombre,
            objetivo,
            ingreso_mensual,
            deudas,
            intereses,
            notificaciones_activadas,
            setup_completado,
            tour_completado
        } = req.body;

        if (nombre !== undefined && String(nombre).trim().length < 2) {
            return res.status(400).json({
                mensaje: 'Escribe un nombre válido.'
            });
        }

        // Solo se actualizan los campos que se envían (los demás se conservan)
        const valor = v => (v === undefined ? null : v);
        const bandera = v => (v === undefined || v === null ? null : (v ? 1 : 0));

        await pool.execute(
            `UPDATE usuarios
             SET nombre = COALESCE(?, nombre),
                 objetivo = COALESCE(?, objetivo),
                 ingreso_mensual = COALESCE(?, ingreso_mensual),
                 deudas = COALESCE(?, deudas),
                 intereses = COALESCE(?, intereses),
                 notificaciones_activadas = COALESCE(?, notificaciones_activadas),
                 setup_completado = COALESCE(?, setup_completado),
                 tour_completado = COALESCE(?, tour_completado)
             WHERE id = ?`,
            [
                nombre === undefined ? null : String(nombre).trim(),
                valor(objetivo),
                ingreso_mensual === undefined ? null : (Number(ingreso_mensual) || 0),
                bandera(deudas),
                valor(intereses),
                bandera(notificaciones_activadas),
                bandera(setup_completado),
                bandera(tour_completado),
                req.userId
            ]
        );

        res.json({
            mensaje: 'Perfil actualizado correctamente.'
        });

    } catch (error) {
        console.error('Error al actualizar perfil:', error);

        res.status(500).json({
            mensaje: 'No se pudo actualizar el perfil.'
        });
    }
});

// ===============================
// CAMBIAR CONTRASEÑA
// ===============================

app.put('/api/auth/password', verificarToken, async (req, res) => {
    try {
        const { actual, nueva } = req.body;

        if (!actual || !nueva || nueva.length < 8) {
            return res.status(400).json({
                mensaje: 'La nueva contraseña debe tener al menos 8 caracteres.'
            });
        }

        const [rows] = await pool.execute(
            'SELECT password_hash FROM usuarios WHERE id = ?',
            [req.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                mensaje: 'Usuario no encontrado.'
            });
        }

        const correcta = await bcrypt.compare(
            actual,
            rows[0].password_hash
        );

        if (!correcta) {
            return res.status(400).json({
                mensaje: 'La contraseña actual es incorrecta.'
            });
        }

        const nuevoHash = await bcrypt.hash(nueva, 12);

        await pool.execute(
            'UPDATE usuarios SET password_hash = ? WHERE id = ?',
            [nuevoHash, req.userId]
        );

        res.json({
            mensaje: 'Contraseña actualizada correctamente.'
        });

    } catch (error) {
        console.error('Error al cambiar contraseña:', error);

        res.status(500).json({
            mensaje: 'No se pudo cambiar la contraseña.'
        });
    }
});

// ===============================
// MOVIMIENTOS: CONSULTAR
// ===============================

app.get('/api/movements', verificarToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT id, tipo, descripcion, categoria, monto, fecha
             FROM movimientos
             WHERE usuario_id = ?
             ORDER BY fecha DESC, id DESC`,
            [req.userId]
        );

        res.json({
            movimientos: rows.map(m => ({
                ...m,
                id: String(m.id),
                type: m.tipo === 'ingreso' ? 'income' : 'expense',
                amount: Number(m.monto),
                description: m.descripcion,
                category: m.categoria,
                date: fechaISO(m.fecha)
            }))
        });

    } catch (error) {
        console.error('Error al consultar movimientos:', error);

        res.status(500).json({
            mensaje: 'No se pudieron consultar los movimientos.'
        });
    }
});

// ===============================
// MOVIMIENTOS: REGISTRAR
// ===============================

app.post('/api/movements', verificarToken, async (req, res) => {
    try {
        const { type, description, category, amount, date } = req.body;

        if (
            !['income', 'expense'].includes(type) ||
            !description ||
            !category ||
            !Number.isFinite(Number(amount)) ||
            Number(amount) <= 0 ||
            !date
        ) {
            return res.status(400).json({
                mensaje: 'Los datos del movimiento no son válidos.'
            });
        }

        const tipo = type === 'income' ? 'ingreso' : 'gasto';

        const [result] = await pool.execute(
            `INSERT INTO movimientos
             (usuario_id, tipo, descripcion, categoria, monto, fecha)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.userId,
                tipo,
                description.trim(),
                category,
                Number(amount),
                date
            ]
        );

        res.status(201).json({
            mensaje: 'Movimiento registrado.',
            id: String(result.insertId)
        });

    } catch (error) {
        console.error('Error al registrar movimiento:', error);

        res.status(500).json({
            mensaje: 'No se pudo registrar el movimiento.'
        });
    }
});

// ===============================
// MOVIMIENTOS: EDITAR
// ===============================

app.put('/api/movements/:id', verificarToken, async (req, res) => {
    try {
        const { type, description, category, amount, date } = req.body;

        if (
            !['income', 'expense'].includes(type) ||
            !description ||
            !category ||
            !Number.isFinite(Number(amount)) ||
            Number(amount) <= 0 ||
            !date
        ) {
            return res.status(400).json({
                mensaje: 'Los datos del movimiento no son válidos.'
            });
        }

        const tipo = type === 'income' ? 'ingreso' : 'gasto';

        const [result] = await pool.execute(
            `UPDATE movimientos
             SET tipo = ?, descripcion = ?, categoria = ?,
                 monto = ?, fecha = ?
             WHERE id = ? AND usuario_id = ?`,
            [
                tipo,
                description.trim(),
                category,
                Number(amount),
                date,
                req.params.id,
                req.userId
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                mensaje: 'Movimiento no encontrado.'
            });
        }

        res.json({
            mensaje: 'Movimiento actualizado.'
        });

    } catch (error) {
        console.error('Error al editar movimiento:', error);

        res.status(500).json({
            mensaje: 'No se pudo actualizar el movimiento.'
        });
    }
});

// ===============================
// MOVIMIENTOS: ELIMINAR
// ===============================

app.delete('/api/movements/:id', verificarToken, async (req, res) => {
    try {
        const [result] = await pool.execute(
            'DELETE FROM movimientos WHERE id = ? AND usuario_id = ?',
            [req.params.id, req.userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                mensaje: 'Movimiento no encontrado.'
            });
        }

        res.json({
            mensaje: 'Movimiento eliminado.'
        });

    } catch (error) {
        console.error('Error al eliminar movimiento:', error);

        res.status(500).json({
            mensaje: 'No se pudo eliminar el movimiento.'
        });
    }
});

// ===============================
// METAS: CONSULTAR
// ===============================

app.get('/api/goals', verificarToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT id, nombre, monto_objetivo, monto_actual, fecha_limite, icono
             FROM metas
             WHERE usuario_id = ?
             ORDER BY id DESC`,
            [req.userId]
        );

        res.json({
            metas: rows.map(g => ({
                id: String(g.id),
                name: g.nombre,
                target: Number(g.monto_objetivo),
                saved: Number(g.monto_actual),
                icon: iconoValido(g.icono),
                deadline: fechaISO(g.fecha_limite)
            }))
        });

    } catch (error) {
        console.error('Error al consultar metas:', error);

        res.status(500).json({
            mensaje: 'No se pudieron consultar las metas.'
        });
    }
});

// ===============================
// METAS: REGISTRAR
// ===============================

app.post('/api/goals', verificarToken, async (req, res) => {
    try {
        const { name, target, saved = 0, deadline = null, icon } = req.body;

        if (
            !name ||
            !Number.isFinite(Number(target)) ||
            Number(target) <= 0 ||
            !Number.isFinite(Number(saved)) ||
            Number(saved) < 0
        ) {
            return res.status(400).json({
                mensaje: 'Los datos de la meta no son válidos.'
            });
        }

        const [result] = await pool.execute(
            `INSERT INTO metas
             (usuario_id, nombre, monto_objetivo, monto_actual, fecha_limite, icono)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.userId,
                name.trim(),
                Number(target),
                Number(saved),
                deadline,
                iconoValido(icon)
            ]
        );

        res.status(201).json({
            mensaje: 'Meta registrada.',
            id: String(result.insertId)
        });

    } catch (error) {
        console.error('Error al registrar meta:', error);

        res.status(500).json({
            mensaje: 'No se pudo registrar la meta.'
        });
    }
});

// ===============================
// METAS: EDITAR
// ===============================

app.put('/api/goals/:id', verificarToken, async (req, res) => {
    try {
        const { name, target, saved, deadline = null, icon } = req.body;

        if (
            !name ||
            !Number.isFinite(Number(target)) ||
            Number(target) <= 0 ||
            !Number.isFinite(Number(saved)) ||
            Number(saved) < 0
        ) {
            return res.status(400).json({
                mensaje: 'Los datos de la meta no son válidos.'
            });
        }

        const [result] = await pool.execute(
            `UPDATE metas
             SET nombre = ?, monto_objetivo = ?,
                 monto_actual = ?, fecha_limite = ?,
                 icono = ?
             WHERE id = ? AND usuario_id = ?`,
            [
                name.trim(),
                Number(target),
                Number(saved),
                deadline,
                iconoValido(icon),
                req.params.id,
                req.userId
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                mensaje: 'Meta no encontrada.'
            });
        }

        res.json({
            mensaje: 'Meta actualizada.'
        });

    } catch (error) {
        console.error('Error al editar meta:', error);

        res.status(500).json({
            mensaje: 'No se pudo actualizar la meta.'
        });
    }
});

// ===============================
// METAS: ELIMINAR
// ===============================

app.delete('/api/goals/:id', verificarToken, async (req, res) => {
    try {
        const [result] = await pool.execute(
            'DELETE FROM metas WHERE id = ? AND usuario_id = ?',
            [req.params.id, req.userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                mensaje: 'Meta no encontrada.'
            });
        }

        res.json({
            mensaje: 'Meta eliminada.'
        });

    } catch (error) {
        console.error('Error al eliminar meta:', error);

        res.status(500).json({
            mensaje: 'No se pudo eliminar la meta.'
        });
    }
});

// ===============================
// MENTOR IA: DATOS DEL USUARIO PARA PERSONALIZAR
// ===============================

async function obtenerContextoFinanciero(userId) {
    const [[usuario]] = await pool.execute(
        `SELECT nombre, objetivo, ingreso_mensual, deudas, intereses
         FROM usuarios WHERE id = ?`,
        [userId]
    );

    const [mes] = await pool.execute(
        `SELECT tipo, SUM(monto) AS total
         FROM movimientos
         WHERE usuario_id = ?
           AND YEAR(fecha) = YEAR(CURDATE())
           AND MONTH(fecha) = MONTH(CURDATE())
         GROUP BY tipo`,
        [userId]
    );

    const [historico] = await pool.execute(
        `SELECT tipo, SUM(monto) AS total, COUNT(*) AS cantidad
         FROM movimientos
         WHERE usuario_id = ?
         GROUP BY tipo`,
        [userId]
    );

    const [[ahorro]] = await pool.execute(
        `SELECT COALESCE(SUM(monto), 0) AS total
         FROM movimientos
         WHERE usuario_id = ? AND tipo = 'ingreso' AND categoria = 'Ahorro'`,
        [userId]
    );

    const [categorias] = await pool.execute(
        `SELECT categoria, SUM(monto) AS total
         FROM movimientos
         WHERE usuario_id = ? AND tipo = 'gasto'
           AND YEAR(fecha) = YEAR(CURDATE())
           AND MONTH(fecha) = MONTH(CURDATE())
         GROUP BY categoria
         ORDER BY total DESC
         LIMIT 6`,
        [userId]
    );

    const [metas] = await pool.execute(
        `SELECT nombre, monto_objetivo, monto_actual
         FROM metas
         WHERE usuario_id = ?
         ORDER BY id DESC
         LIMIT 10`,
        [userId]
    );

    const total = (lista, tipo) => Number(lista.find(f => f.tipo === tipo)?.total || 0);
    const totalIngresos = total(historico, 'ingreso');
    const totalGastos = total(historico, 'gasto');
    const numMovimientos = historico.reduce((suma, f) => suma + Number(f.cantidad), 0);

    // Mismo cálculo del puntaje que usa el frontend
    const puntaje = totalIngresos > 0
        ? Math.max(0, Math.min(100, Math.round(((totalIngresos - totalGastos) / totalIngresos) * 100)))
        : 0;

    const textoMes = new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

    return {
        nombre: usuario?.nombre || 'Usuario',
        objetivo: usuario?.objetivo || 'Sin definir',
        ingresoMensual: Number(usuario?.ingreso_mensual || 0),
        tieneDeudas: Number(usuario?.deudas) > 0 || usuario?.deudas === 'Sí',
        intereses: usuario?.intereses || '',
        mes: textoMes,
        mesIngresos: total(mes, 'ingreso'),
        mesGastos: total(mes, 'gasto'),
        totalIngresos,
        totalGastos,
        totalAhorro: Number(ahorro.total),
        puntaje,
        numMovimientos,
        categoriasGasto: categorias.map(c => ({ categoria: c.categoria, total: Number(c.total) })),
        metas: metas.map(m => {
            const objetivo = Number(m.monto_objetivo);
            const actual = Number(m.monto_actual);
            return {
                nombre: m.nombre,
                objetivo,
                actual,
                porcentaje: objetivo > 0 ? Math.min(100, Math.round((actual / objetivo) * 100)) : 0
            };
        })
    };
}

// Límite simple de uso: 20 preguntas cada 10 minutos por usuario
const LIMITE_IA = 20;
const VENTANA_IA_MS = 10 * 60 * 1000;
const usoIA = new Map();

function excedeLimiteIA(userId) {
    const ahora = Date.now();
    const recientes = (usoIA.get(userId) || []).filter(t => ahora - t < VENTANA_IA_MS);

    if (recientes.length >= LIMITE_IA) {
        usoIA.set(userId, recientes);
        return true;
    }

    recientes.push(ahora);
    usoIA.set(userId, recientes);
    return false;
}

// ===============================
// MENTOR IA: ESTADO
// ===============================

app.get('/api/ai/status', verificarToken, (req, res) => {
    res.json({
        disponible: iaConfigurada(),
        proveedor: proveedorActivo()
    });
});

// ===============================
// MENTOR IA: PREGUNTAR
// ===============================

app.post('/api/ai/chat', verificarToken, async (req, res) => {
    try {
        const mensaje = String(req.body.mensaje || '').trim();
        const historial = Array.isArray(req.body.historial) ? req.body.historial : [];

        if (!mensaje) {
            return res.status(400).json({
                mensaje: 'Escribe una pregunta.'
            });
        }

        if (mensaje.length > 600) {
            return res.status(400).json({
                mensaje: 'Tu pregunta es muy larga. Resúmela en menos de 600 caracteres.'
            });
        }

        if (!iaConfigurada()) {
            return res.status(503).json({
                mensaje: 'Mentor IA aún no está configurado en el servidor.'
            });
        }

        if (excedeLimiteIA(req.userId)) {
            return res.status(429).json({
                mensaje: 'Hiciste muchas preguntas seguidas. Espera unos minutos y vuelve a intentarlo.'
            });
        }

        const historialLimpio = historial
            .slice(-10)
            .filter(item => item && typeof item.texto === 'string')
            .map(item => ({
                rol: item.rol === 'asistente' ? 'asistente' : 'usuario',
                texto: item.texto.slice(0, 2000)
            }));

        const contexto = await obtenerContextoFinanciero(req.userId);

        const respuesta = await responderIA({
            mensaje,
            historial: historialLimpio,
            contexto
        });

        res.json({ respuesta });

    } catch (error) {
        console.error('Error en Mentor IA:', error.status || '', error.detalle || error.message);

        if (error.name === 'AbortError') {
            return res.status(504).json({
                mensaje: 'La IA tardó demasiado en responder. Intenta de nuevo.'
            });
        }

        if (error.status === 401 || error.status === 403) {
            return res.status(502).json({
                mensaje: 'La clave de la IA no es válida. Revisa la configuración del servidor.'
            });
        }

        if (error.status === 429) {
            return res.status(429).json({
                mensaje: 'Se alcanzó el límite de uso de la IA. Intenta en unos minutos.'
            });
        }

        res.status(502).json({
            mensaje: 'Mentor IA no está disponible en este momento. Intenta más tarde.'
        });
    }
});

// ===============================
// AJUSTES DE LA BASE DE DATOS
// Agrega columnas que el frontend necesita, si aún no existen.
// ===============================

async function asegurarColumna(tabla, columna, definicion) {
    const [filas] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [tabla, columna]
    );

    if (Number(filas[0].total) === 0) {
        await pool.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${columna}\` ${definicion}`);
        console.log(`Columna agregada: ${tabla}.${columna}`);
    }
}

async function prepararBaseDeDatos() {
    try {
        await asegurarColumna('usuarios', 'setup_completado', 'TINYINT(1) NOT NULL DEFAULT 0');
        await asegurarColumna('usuarios', 'tour_completado', 'TINYINT(1) NOT NULL DEFAULT 0');
        await asegurarColumna('metas', 'icono', "VARCHAR(20) NOT NULL DEFAULT 'star'");
    } catch (error) {
        console.error('No se pudieron revisar las columnas de la base de datos:', error.message);
        console.error('Ejecuta manualmente en MySQL Workbench:');
        console.error("  ALTER TABLE usuarios ADD COLUMN setup_completado TINYINT(1) NOT NULL DEFAULT 0;");
        console.error("  ALTER TABLE usuarios ADD COLUMN tour_completado TINYINT(1) NOT NULL DEFAULT 0;");
        console.error("  ALTER TABLE metas ADD COLUMN icono VARCHAR(20) NOT NULL DEFAULT 'star';");
    }
}

// ===============================
// INICIAR SERVIDOR
// ===============================

prepararBaseDeDatos().then(() => {
    app.listen(PORT, () => {
        console.log(`MoneyMentor funcionando en http://localhost:${PORT}`);
        console.log(iaConfigurada()
            ? `Mentor IA activo con ${proveedorActivo()}.`
            : 'Mentor IA desactivado: agrega GEMINI_API_KEY o ANTHROPIC_API_KEY en .env');
    });
});