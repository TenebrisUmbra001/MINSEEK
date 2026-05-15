// Backend/ApiPrivada.js
// API PRIVADA: Lógica de base de datos e integración con IA
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const fetch = global.fetch || require('node-fetch'); 
const AbortController = global.AbortController || require('abort-controller');

const app = express();
const PORT = 6969;

// -----------------------------
// MAPA DE MODELOS (tu versión)
// -----------------------------
const modelos = {
    router: [
        { name: "qwen2.5:1.5b", port: 11431 },
        { name: "qwen2.5:1.5b", port: 11432 },
        { name: "qwen2.5:1.5b", port: 11433 },
        { name: "qwen2.5:1.5b", port: 11434 },
        { name: "qwen2.5:1.5b", port: 11435 },
        { name: "qwen2.5:1.5b", port: 11436 },
        { name: "qwen2.5:1.5b", port: 11437 },
        { name: "qwen2.5:1.5b", port: 11438 }
    ],

    consulta_rapida: [
        { name: "phi3:mini", port: 11439 },
        { name: "phi3:mini", port: 11440 },
        { name: "phi3:mini", port: 11441 },
        { name: "phi3:mini", port: 11442 },
        { name: "phi3:mini", port: 11443 },
        { name: "phi3:mini", port: 11444 },

        { name: "deepseek-r1:1.5b", port: 11445 },
        { name: "deepseek-r1:1.5b", port: 11446 },
        { name: "deepseek-r1:1.5b", port: 11447 },
        { name: "deepseek-r1:1.5b", port: 11448 },

        { name: "llama3.2:1b", port: 11449 },
        { name: "llama3.2:1b", port: 11450 },
        { name: "llama3.2:1b", port: 11451 },
        { name: "llama3.2:1b", port: 11452 }
    ],

    resumen: [
        { name: "qwen2.5:3b", port: 11453 },
        { name: "qwen2.5:3b", port: 11454 },
        { name: "qwen2.5:3b", port: 11455 },
        { name: "qwen2.5:3b", port: 11456 }
    ],

    redaccion: [
        { name: "llama3.1:8b", port: 11457 },
        { name: "llama3.1:8b", port: 11458 },
        { name: "llama3.1:8b", port: 11459 },

        { name: "llama3.2:7b", port: 11460 },
        { name: "llama3.2:7b", port: 11461 }
    ],

    razonamiento: [
        { name: "deepseek-r1:7b", port: 11462 },
        { name: "deepseek-r1:7b", port: 11463 },
        { name: "deepseek-r1:7b", port: 11464 },
        { name: "deepseek-r1:7b", port: 11465 }
    ],

    analisis_profundo: [
        { name: "deepseek-r1:14b", port: 11466 },
        { name: "deepseek-r1:14b", port: 11467 },
        { name: "qwen2.5:14b", port: 11468 },
        { name: "qwen2.5:14b", port: 11469 }
    ],

    codigo: [
        { name: "codeqwen:7b", port: 11470 },
        { name: "starcoder2:3b", port: 11471 },
        { name: "starcoder2:3b", port: 11472 }
    ],

    multimodal: [
        { name: "llava:7b", port: 11473 },
        { name: "llava:13b", port: 11474 }
    ]
};

// -----------------------------
// Inicializar estado runtime
// -----------------------------
function initModelState(map) {
    for (const cat of Object.keys(map)) {
        map[cat] = map[cat].map(inst => ({
            ...inst,
            busy: false,
            lastUsed: 0
        }));
    }
}
initModelState(modelos);

// -----------------------------
// Middleware
// -----------------------------
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
async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}
async function comparePassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
}
function generateId() {
    return crypto.randomUUID();
}
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// -----------------------------
// Helpers para instancias
// -----------------------------
function obtenerInstanciaLibre(categoria) {
    const instancias = modelos[categoria];
    if (!instancias) return null;

    instancias.sort((a, b) => a.lastUsed - b.lastUsed);

    for (const instancia of instancias) {
        if (!instancia.busy) {
            instancia.busy = true;
            instancia.lastUsed = Date.now();

            console.log(`🟩 [INSTANCIA ASIGNADA] Categoria: ${categoria} → Modelo: ${instancia.name} | Puerto: ${instancia.port}`);

            return instancia;
        }
    }

    console.log(`🟥 [SIN INSTANCIAS LIBRES] Categoria: ${categoria}`);
    return null;
}

function liberarInstancia(instancia) {
    if (!instancia) return;
    instancia.busy = false;
    instancia.lastUsed = Date.now();
    console.log(`🔓 [INSTANCIA LIBERADA] Modelo: ${instancia.name} | Puerto: ${instancia.port}`);
}

// Ping simple
async function pingInstance(instancia, timeoutMs = 2000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`http://localhost:${instancia.port}/health`, {
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(id);
        return res.ok;
    } catch (e) {
        clearTimeout(id);
        return false;
    }
}
// ============================================================================
// RUTAS - API PRIVADA PRINCIPAL: recibe solo prompt desde API pública
// ============================================================================

// Categorizar usando una instancia libre del router
async function categorizar(prompt) {

    console.log(`📥 [CATEGORIZAR] Nuevo prompt recibido para clasificación`);

    // Intentar obtener router libre
    const routerInst = obtenerInstanciaLibre('router');
    if (!routerInst) {
        console.log(`🟥 [ERROR] No hay routers disponibles para categorizar`);
        throw new Error('No hay routers disponibles para categorizar');
    }

    console.log(`🔎 [ROUTER] Usando router en puerto ${routerInst.port} para categorizar...`);

    try {
        // opcional: ping antes de usar
        const alive = await pingInstance(routerInst).catch(() => false);
        if (!alive) {
            console.log(`🟥 [ERROR] Router en puerto ${routerInst.port} no responde`);
            throw new Error(`Router en puerto ${routerInst.port} no responde`);
        }

        const controller = new AbortController();
        const TIMEOUT_MS = 5000;
        const id = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(`http://localhost:${routerInst.port}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                model: routerInst.name,
                prompt: `Clasifica esta tarea en una categoría: consulta_rapida, resumen, redaccion, razonamiento, analisis_profundo, codigo, multimodal. Solo responde con la categoría.\n\nTarea: ${prompt}`
            })
        });

        clearTimeout(id);

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.log(`🟥 [ERROR] Router devolvió estado ${response.status}`);
            throw new Error(text || `Router respondió con estado ${response.status}`);
        }

        const data = await response.json();
        const categoria = (data.response || data.text || '').toString().trim().toLowerCase();

        console.log(`📌 [CATEGORIZADO] Categoria detectada: ${categoria}`);

        return categoria;

    } finally {
        liberarInstancia(routerInst);
    }
}

// Ejecutar modelo: reservar instancia, llamar, cerrar, liberar
async function usarModelo(categoria, prompt) {

    console.log(`⚙️ [EJECUTAR MODELO] Preparando ejecución para categoría: ${categoria}`);

    const instancia = obtenerInstanciaLibre(categoria);
    if (!instancia) {
        console.log(`🟥 [ERROR] No hay instancias libres para categoría ${categoria}`);
        throw new Error('No hay instancias libres en esta categoría');
    }

    console.log(`🚀 [EJECUTANDO] Modelo: ${instancia.name} | Puerto: ${instancia.port}`);

    // Intentar ping rápido
    const alive = await pingInstance(instancia).catch(() => false);
    if (!alive) {
        console.log(`🟥 [ERROR] Instancia en puerto ${instancia.port} no responde`);
        liberarInstancia(instancia);
        throw new Error(`Instancia en puerto ${instancia.port} no responde`);
    }

    const controller = new AbortController();
    const TIMEOUT_MS = 120000;
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const genRes = await fetch(`http://localhost:${instancia.port}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                model: instancia.name,
                prompt: prompt,
                stream: false
            })
        });

        if (!genRes.ok) {
            const serverText = await genRes.text().catch(() => '');
            console.log(`🟥 [ERROR] Modelo devolvió estado ${genRes.status}`);
            throw new Error(serverText || `Modelo respondió con estado ${genRes.status}`);
        }

        const data = await genRes.json();

        console.log(`✅ [RESPUESTA RECIBIDA] Modelo: ${instancia.name} | Puerto: ${instancia.port}`);

        // Cerrar modelo
        try {
            console.log(`🔻 [CERRANDO MODELO] ${instancia.name} en puerto ${instancia.port}`);
            await fetch(`http://localhost:${instancia.port}/api/ps/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: instancia.name })
            });
        } catch (stopErr) {
            console.error(`❌ [ERROR CERRANDO MODELO] ${instancia.name} | Puerto: ${instancia.port} →`, stopErr.message);
        }

        const respuestaTexto = data.response || data.text || JSON.stringify(data);
        return respuestaTexto;

    } finally {
        clearTimeout(timeoutId);
        liberarInstancia(instancia);
    }
}

// Endpoint público de la API privada: recibe solo prompt
app.post('/api/private/execute', async (req, res) => {
    try {
        console.log(`📥 [NUEVA SOLICITUD] /api/private/execute`);

        const { prompt } = req.body;
        if (!prompt || typeof prompt !== 'string') {
            console.log(`🟥 [ERROR] Prompt inválido`);
            return res.status(400).json({ ok: false, error: 'Prompt inválido' });
        }

        // 1) Categorizar internamente
        let categoria;
        try {
            categoria = await categorizar(prompt);
        } catch (catErr) {
            console.error(`❌ [ERROR CATEGORIZANDO]`, catErr.message);
            return res.status(503).json({ ok: false, error: 'No se pudo categorizar la tarea' });
        }

        console.log(`📂 [CATEGORÍA FINAL] ${categoria}`);

        // 2) Ejecutar modelo
        try {
            const respuesta = await usarModelo(categoria, prompt);
            console.log(`🎉 [RESPUESTA FINAL LISTA]`);
            return res.status(200).json({ ok: true, categoria, respuesta });
        } catch (execErr) {
            console.error(`❌ [ERROR EJECUTANDO MODELO]`, execErr.message);
            return res.status(503).json({ ok: false, error: execErr.message });
        }

    } catch (error) {
        console.error('❌ [ERROR GENERAL EN /api/private/execute]:', error);
        return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
    }
});
// ============================================================================
// RUTAS - CHAT CON IA (con logs añadidos)
// ============================================================================
app.post('/chat', async (req, res) => {
    try {
        console.log(`💬 [CHAT] Nueva solicitud de chat recibida`);

        const { messages, userId } = req.body;
        if (!messages || !Array.isArray(messages)) {
            console.log(`🟥 [ERROR CHAT] Mensajes inválidos`);
            return res.status(400).json({ success: false, error: 'Mensajes inválidos' });
        }

        // Obtener router libre
        const routerInst = obtenerInstanciaLibre('router');
        if (!routerInst) {
            console.log(`🟥 [ERROR CHAT] No hay routers disponibles para chat`);
            return res.status(503).json({ success: false, error: 'No hay routers disponibles para chat' });
        }

        console.log(`💬 [CHAT] Usando router ${routerInst.name} en puerto ${routerInst.port}`);

        try {
            const response = await fetch(`http://localhost:${routerInst.port}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: routerInst.name,
                    messages: messages,
                    stream: true
                })
            });

            if (!response.ok) {
                const serverText = await response.text();
                console.log(`🟥 [ERROR CHAT] Estado ${response.status}`);
                throw new Error(serverText || `Ollama respondió con estado ${response.status}`);
            }

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            console.log(`📡 [CHAT STREAM] Iniciando transmisión SSE...`);

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
                            console.log(`🏁 [CHAT STREAM] Finalizado`);
                            res.write(`data: [DONE]\n\n`);
                        }
                    } catch (e) {
                        console.error('❌ [CHAT PARSE ERROR]:', e);
                    }
                }
            }

            res.end();

        } finally {
            liberarInstancia(routerInst);
        }

    } catch (error) {
        console.error('❌ [ERROR GENERAL CHAT]:', error);
        res.status(500).json({ success: false, error: 'Error comunicándose con el modelo de IA' });
    }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================
app.get('/health', (req, res) => {
    console.log(`❤️ [HEALTH CHECK] API Privada OK`);
    res.status(200).json({ status: 'API Privada funcionando' });
});

// ============================================================================
// INICIAR SERVIDOR
// ============================================================================
app.listen(PORT, () => {
    console.log(`🔒 API Privada corriendo en http://localhost:${PORT}`);
    console.log(`🧠 Sistema de modelos inicializado con logs activos`);
});
