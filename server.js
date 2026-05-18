// server.js
// API PÚBLICA: Gateway con Rate Limiting y reenvío seguro a API Privada
const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const fetch = global.fetch || require('node-fetch');
const AbortController = global.AbortController || require('abort-controller');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 2054;

const PRIVATE_API_URL = process.env.PRIVATE_API_URL || 'http://localhost:6969';
const PRIVATE_API_TOKEN = process.env.PRIVATE_API_TOKEN || '';

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Demasiados intentos de registro/login. Intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Demasiadas solicitudes. Intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});

var uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Demasiadas subidas. Intenta más tarde.',
    standardHeaders: true,
    legacyHeaders: false,
});

var uploadMemory = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ============================================================================
// RUTAS ESTÁTICAS
// ============================================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'InicioSesion', 'index.html'));
});

// ============================================================================
// UTILIDADES - VALIDACIÓN
// ============================================================================
const DOMINIO_ZIMBRA = 'mail.das.pdr';

function validarEmailZimbra(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return { valid: false, error: 'Formato de correo inválido' };
    if (!email.endsWith(`@${DOMINIO_ZIMBRA}`)) return { valid: false, error: `El correo debe terminar en @${DOMINIO_ZIMBRA}` };
    const [localPart] = email.split('@');
    const localRegex = /^[a-zA-Z0-9._-]+$/;
    if (!localRegex.test(localPart)) return { valid: false, error: 'El correo contiene caracteres inválidos' };
    return { valid: true };
}

async function forwardToPrivate(path, body, options = {}) {
    const maxRetries = options.maxRetries ?? 2;
    const baseDelay = options.baseDelay ?? 300;
    let attempt = 0;

    while (true) {
        attempt++;
        const controller = new AbortController();
        const TIMEOUT_MS = options.timeoutMs ?? 90000;
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const res = await fetch(`${PRIVATE_API_URL}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(PRIVATE_API_TOKEN ? { 'Authorization': `Bearer ${PRIVATE_API_TOKEN}` } : {})
                },
                signal: controller.signal,
                body: JSON.stringify(body)
            });

            clearTimeout(timeoutId);
            const text = await res.text();
            let parsed;
            try { parsed = JSON.parse(text); } catch { parsed = text; }
            return { status: res.status, body: parsed };
        } catch (err) {
            clearTimeout(timeoutId);
            if (attempt > maxRetries) {
                throw new Error(`Error forwarding to private API after ${attempt} attempts: ${err.message}`);
            }
            const jitter = Math.floor(Math.random() * 100);
            const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

// ============================================================================
// RUTAS - PROXY A API PRIVADA CON VALIDACIÓN
// ============================================================================

app.post('/api/registro', authLimiter, async (req, res) => {
    try {
        const { usuario, correo, contrasena } = req.body;
        if (!usuario || !correo || !contrasena) {
            return res.status(400).json({ success: false, error: 'Todos los campos son requeridos' });
        }
        const emailValidation = validarEmailZimbra(correo);
        if (!emailValidation.valid) return res.status(400).json({ success: false, error: emailValidation.error });
        if (usuario.length < 3 || usuario.length > 50) return res.status(400).json({ success: false, error: 'El usuario debe tener entre 3 y 50 caracteres' });
        if (contrasena.length < 6) return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 6 caracteres' });

        const result = await forwardToPrivate('/auth/register', { usuario, correo, contrasena });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('Error en proxy de registro:', error.message || error);
        return res.status(502).json({ success: false, error: 'Error al conectar con el servidor' });
    }
});

app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { usuario, contrasena } = req.body;
        if (!usuario || !contrasena) return res.status(400).json({ success: false, error: 'Usuario y contraseña requeridos' });

        const result = await forwardToPrivate('/auth/login', { usuario, contrasena });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('Error en proxy de login:', error.message || error);
        return res.status(502).json({ success: false, error: 'Error al conectar con el servidor' });
    }
});

app.post('/public/execute', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || typeof prompt !== 'string') return res.status(400).json({ ok: false, error: 'Prompt inválido' });

        const sanitized = prompt.toString().trim().slice(0, 20000);

        const result = await forwardToPrivate('/api/private/execute', { prompt: sanitized }, { maxRetries: 2, timeoutMs: 120000 });
        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('Error en public/execute:', error.message || error);
        return res.status(502).json({ ok: false, error: 'Error comunicándose con la API privada' });
    }
});

app.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        const controller = new AbortController();
        const TIMEOUT_MS = 0;
        const timeoutId = TIMEOUT_MS ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

        const response = await fetch(`${PRIVATE_API_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(PRIVATE_API_TOKEN ? { 'Authorization': `Bearer ${PRIVATE_API_TOKEN}` } : {})
            },
            signal: controller.signal,
            body: JSON.stringify(req.body)
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            if (timeoutId) clearTimeout(timeoutId);
            return res.status(response.status).json({ success: false, error: text || 'Error desde API privada' });
        }

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

        if (timeoutId) clearTimeout(timeoutId);
        res.end();
    } catch (error) {
        console.error('Error en proxy de chat:', error.message || error);
        return res.status(502).json({ success: false, error: 'Error al conectar con el servidor' });
    }
});

// ============================================================================
// RUTAS - CONVERSACIONES (STUBS PARA EVITAR 404 EN CONSOLA)
// ============================================================================
app.get('/api/conversations', function (req, res) {
    return res.status(200).json({ conversations: [] });
});

app.get('/api/conversations/:id', function (req, res) {
    return res.status(404).json({ success: false, error: 'Conversación no encontrada' });
});

// ============================================================================
// RUTAS - SUBIDA DE DOCUMENTOS (PROXY A API PRIVADA) - CORREGIDO
// ============================================================================

app.post('/api/upload', uploadLimiter, uploadMemory.single('documento'), function (req, res) {
    if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo' });
    }

    var form = new FormData();
    form.append('documento', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
    });

    var headers = form.getHeaders();
    if (PRIVATE_API_TOKEN) {
        headers['Authorization'] = 'Bearer ' + PRIVATE_API_TOKEN;
    }

    fetch(PRIVATE_API_URL + '/api/private/upload', {
        method: 'POST',
        headers: headers,
        body: form.getBuffer() // <--- SOLUCIÓN: Enviar Buffer en lugar de Stream para compatibilidad con fetch nativo de Node 18+
    })
    .then(function (response) {
        return response.text().then(function (text) {
            var parsed;
            try { parsed = JSON.parse(text); } catch (e) { parsed = { ok: false, error: text }; }
            return { status: response.status, body: parsed };
        });
    })
    .then(function (result) {
        return res.status(result.status).json(result.body);
    })
    .catch(function (error) {
        console.error('Error en proxy de upload:', error.message || error);
        return res.status(502).json({ ok: false, error: 'Error al conectar con el servidor' });
    });
});

app.get('/api/documents', function (req, res) {
    var headers = {};
    if (PRIVATE_API_TOKEN) headers['Authorization'] = 'Bearer ' + PRIVATE_API_TOKEN;

    fetch(PRIVATE_API_URL + '/api/private/documents', { headers: headers })
    .then(function (response) {
        return response.text().then(function (text) {
            var parsed;
            try { parsed = JSON.parse(text); } catch (e) { parsed = { ok: false, error: text }; }
            return { status: response.status, body: parsed };
        });
    })
    .then(function (result) {
        return res.status(result.status).json(result.body);
    })
    .catch(function (error) {
        console.error('Error en proxy de documents:', error.message || error);
        return res.status(502).json({ ok: false, error: 'Error al conectar con el servidor' });
    });
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
    console.log(`🔗 Reenvío a API Privada en ${PRIVATE_API_URL}`);
});