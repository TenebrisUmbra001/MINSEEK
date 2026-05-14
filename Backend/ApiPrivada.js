// Backend/ApiPrivada.js
// API PRIVADA: Lógica de base de datos e integración con IA
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 6969;

// Middleware
app.use(express.json());

// ============================================================================
// INICIALIZACIÓN DE BASE DE DATOS
// ============================================================================
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================================
// UTILIDADES
// ============================================================================

// Función para hashear contraseñas
function hashPassword(password) {
    return crypto
        .createHash('sha256')
        .update(password)
        .digest('hex');
}

// Generar ID único
function generateId() {
    return crypto.randomUUID();
}

// Validar email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// ============================================================================
// RUTAS - REGISTRO DE USUARIOS
// ============================================================================

app.post('/auth/register', (req, res) => {
    try {
        const { usuario, correo, contrasena } = req.body;

        // Validaciones básicas
        if (!usuario || !correo || !contrasena) {
            return res.status(400).json({ 
                success: false, 
                error: 'Todos los campos son requeridos' 
            });
        }

        // Validar formato de correo
        if (!isValidEmail(correo)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Correo electrónico no válido' 
            });
        }

        // Validar longitud de usuario
        if (usuario.length < 3 || usuario.length > 50) {
            return res.status(400).json({ 
                success: false, 
                error: 'El usuario debe tener entre 3 y 50 caracteres' 
            });
        }

        // Validar longitud de contraseña
        if (contrasena.length < 6) {
            return res.status(400).json({ 
                success: false, 
                error: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }

        // Verificar si el usuario ya existe
        const usuarioExistente = db.prepare(
            'SELECT id FROM Usuario WHERE NombreUsuario = ? OR Correo = ?'
        ).get(usuario, correo);

        if (usuarioExistente) {
            return res.status(400).json({ 
                success: false, 
                error: 'El usuario o correo ya está registrado' 
            });
        }

        // Hash de contraseña
        const hash = hashPassword(contrasena);

        // Generar ID único
        const id = generateId();

        // Insertar usuario en la base de datos
        const stmt = db.prepare(`
            INSERT INTO Usuario (id, NombreUsuario, Password, Correo)
            VALUES (?, ?, ?, ?)
        `);

        stmt.run(id, usuario, hash, correo);

        return res.status(201).json({ 
            success: true, 
            message: 'Cuenta registrada exitosamente',
            userId: id
        });

    } catch (error) {
        console.error('Error en registro:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor' 
        });
    }
});

// ============================================================================
// RUTAS - LOGIN DE USUARIOS
// ============================================================================

app.post('/auth/login', (req, res) => {
    try {
        const { usuario, contrasena } = req.body;

        if (!usuario || !contrasena) {
            return res.status(400).json({ 
                success: false, 
                error: 'Usuario y contraseña requeridos' 
            });
        }

        // Buscar usuario
        const user = db.prepare(
            'SELECT id, NombreUsuario, Password FROM Usuario WHERE NombreUsuario = ?'
        ).get(usuario);

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Usuario o contraseña incorrectos' 
            });
        }

        // Verificar contraseña
        const hash = hashPassword(contrasena);
        if (user.Password !== hash) {
            return res.status(401).json({ 
                success: false, 
                error: 'Usuario o contraseña incorrectos' 
            });
        }

        // Actualizar fecha de última conexión
        db.prepare('UPDATE Usuario SET FechaUltimaConexion = datetime("now") WHERE id = ?')
            .run(user.id);

        return res.status(200).json({ 
            success: true, 
            message: 'Login exitoso',
            userId: user.id,
            usuario: user.NombreUsuario
        });

    } catch (error) {
        console.error('Error en login:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Error interno del servidor' 
        });
    }
});

// ============================================================================
// RUTAS - CHAT CON IA (Ollama)
// ============================================================================

app.post('/chat', async (req, res) => {
    try {
        const { messages, userId } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Mensajes inválidos' 
            });
        }

        // Llamada a Ollama con stream
        const fetchFn = global.fetch;
        
        const response = await fetchFn('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'deepseek-r1:14b',
                messages: messages,
                stream: true
            })
        });

        if (!response.ok) {
            const serverText = await response.text();
            throw new Error(serverText || `Ollama respondió con estado ${response.status}`);
        }

        // Transmitir respuesta como Server-Sent Events
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.trim() === '') continue;
                try {
                    const chunk = JSON.parse(line);
                    if (chunk.message && chunk.message.content) {
                        res.write(`data: ${JSON.stringify({ content: chunk.message.content })}\n\n`);
                    }
                    if (chunk.done) {
                        res.write(`data: [DONE]\n\n`);
                    }
                } catch (e) {
                    console.error('Parse error:', e);
                }
            }
        }
        res.end();

    } catch (error) {
        console.error('Error en chat:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error comunicándose con el modelo de IA' 
        });
    }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'API Privada funcionando' });
});

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

app.listen(PORT, () => {
    console.log(`🔒 API Privada corriendo en http://localhost:${PORT}`);
});
