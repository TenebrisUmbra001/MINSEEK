// server.js
// API PÚBLICA: Gateway con Rate Limiting
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 2054;

// URL de la API privada
const PRIVATE_API_URL = 'http://localhost:6969';

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Rate Limiting - Registro y Login (límite estricto)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // máximo 5 intentos
    message: 'Demasiados intentos de registro/login. Intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate Limiting - Chat (límite moderado)
const chatLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 20, // máximo 20 mensajes por minuto
    message: 'Demasiadas solicitudes. Intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================================================================
// RUTAS ESTÁTICAS
// ============================================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'InicioSesion', 'index.html'));
});

// ============================================================================
// RUTAS - PROXY A API PRIVADA
// ============================================================================

// Registro
app.post('/api/registro', authLimiter, async (req, res) => {
    try {
        const response = await fetch(`${PRIVATE_API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Error en proxy de registro:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error al conectar con el servidor' 
        });
    }
});

// Login
app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const response = await fetch(`${PRIVATE_API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('Error en proxy de login:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error al conectar con el servidor' 
        });
    }
});

// Chat
app.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        const response = await fetch(`${PRIVATE_API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json(error);
        }

        // Transmitir respuesta de streaming
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
            res.write(buffer);
            buffer = '';
        }
        res.end();

    } catch (error) {
        console.error('Error en proxy de chat:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Error al conectar con el servidor' 
        });
    }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'API Pública funcionando' });
});

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================

app.listen(PORT, () => {
    console.log(`✅ API Pública corriendo en http://localhost:${PORT}`);
    console.log(`🔗 Conectando con API Privada en ${PRIVATE_API_URL}`);
});