// Backend/ApiPrivada.js
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 6969;
const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';

const log = {
  info: (...args) => console.log(new Date().toISOString(), 'ℹ️', ...args),
  warn: (...args) => console.warn(new Date().toISOString(), '⚠️', ...args),
  error: (...args) => console.error(new Date().toISOString(), '❌', ...args)
};

// -----------------------------
// MAPA DE MODELOS CON LÍMITES DE CONCURRENCIA
// -----------------------------
const modelos = {
  router:           { name: "qwen2.5:1.5b",      limit: 4 },
  consulta_rapida:  { name: "phi3:mini",          limit: 6 },
  resumen:          { name: "qwen2.5:3b",         limit: 3 },
  redaccion:        { name: "llama3.1:8b",        limit: 2 },
  razonamiento:     { name: "deepseek-r1:7b",     limit: 2 },
  analisis_profundo:{ name: "deepseek-r1:14b",    limit: 1 },
  codigo:           { name: "codeqwen:7b",        limit: 2 },
  multimodal:       { name: "llava:7b",           limit: 1 }
};

const aliasCategoria = {
  consulta_rapida: "consulta_rapida", "consulta rápida": "consulta_rapida", consulta: "consulta_rapida",
  resumen: "resumen", resumir: "resumen",
  redaccion: "redaccion", redacción: "redaccion", escritura: "redaccion",
  razonamiento: "razonamiento", logica: "razonamiento", lógica: "razonamiento",
  analisis_profundo: "analisis_profundo", "análisis profundo": "analisis_profundo", analisis: "analisis_profundo",
  codigo: "codigo", code: "codigo", programacion: "codigo",
  multimodal: "multimodal", imagen: "multimodal"
};

app.use(express.json());

// ============================================================================
// SISTEMA DE COLAS Y SEMÁFOROS
// ============================================================================
class ConcurrencyLimiter {
  constructor(limit) { this.limit = limit; this.running = 0; this.queue = []; }
  acquire() {
    return new Promise((resolve) => {
      if (this.running < this.limit) { this.running++; resolve(); } 
      else { this.queue.push(resolve); }
    });
  }
  release() {
    this.running--;
    if (this.queue.length > 0) { this.running++; this.queue.shift()(); }
  }
}

const limiters = {};
for (const cat of Object.keys(modelos)) {
  limiters[cat] = new ConcurrencyLimiter(modelos[cat].limit);
}

// ============================================================================
// BASE DE DATOS
// ============================================================================
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================================
// FUNCIONES DE CICLO DE VIDA
// ============================================================================
async function cerrarModelo(nombreModelo) {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: nombreModelo, prompt: '', keep_alive: 0 })
    });
    log.info(`🗑️ [MODELO CERRADO] ${nombreModelo} liberado de VRAM.`);
  } catch (err) {
    log.warn(`⚠️ [ERROR CERRANDO] ${nombreModelo}: ${err.message}`);
  }
}

// ============================================================================
// FLUJO PRINCIPAL CON CONTROL DE CONCURRENCIA
// ============================================================================

async function categorizar(prompt) {
  const modeloRouter = modelos.router.name;
  const limiter = limiters.router;

  log.info(`📥 [CATEGORIZAR] Solicitando cupo de Router...`);
  await limiter.acquire();
  
  log.info(`🟩 [ROUTER EJECUTANDO] Cupo asignado. Preguntando a ${modeloRouter}...`);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); 

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: modeloRouter,
        prompt: `Clasifica esta tarea en EXACTAMENTE UNA de estas categorías: consulta_rapida, resumen, redaccion, razonamiento, analisis_profundo, codigo, multimodal. Solo responde con la categoría, nada más.\n\nTarea: ${prompt}`,
        stream: false,
        keep_alive: 0
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`❌ [ERROR ROUTER HTTP] Estado ${response.status}: ${errorText}`);
      throw new Error(`Router falló: ${errorText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      log.error(`❌ [ERROR INTERNO OLLAMA ROUTER] ${data.error}`);
      throw new Error(data.error);
    }

    await cerrarModelo(modeloRouter);

    let categoria = (data.response || '').toString().trim().toLowerCase();
    
    // --- SOLUCIÓN A LAS TILDES ---
    // 1. Normalizamos el texto para descomponer las tildes (NFD)
    // 2. Eliminamos los caracteres de tilde (\u0300-\u036f)
    // 3. Luego sí limpiamos cualquier otro símbolo raro
    categoria = categoria.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    categoria = categoria.replace(/[^a-z_]/g, ''); // Ahora la 'a' sin tilde pasa intacta

    const resuelta = aliasCategoria[categoria];

    if (!resuelta || !modelos[resuelta]) {
      log.warn(`⚠️ Categoría "${categoria}" no reconocida. Fallback a consulta_rapida.`);
      return 'consulta_rapida';
    }

    log.info(`📌 [CATEGORIZADO] Categoría: ${resuelta}`);
    return resuelta;

  } catch (err) {
    clearTimeout(timeout);
    log.error(`❌ [EXCEPCIÓN ROUTER]: ${err.message}`);
    await cerrarModelo(modeloRouter);
    return 'consulta_rapida'; 
  } finally {
    limiter.release();
  }
}

async function usarModelo(categoria, prompt) {
  const modelo = modelos[categoria].name;
  const limiter = limiters[categoria];

  log.info(`⚙️ [EJECUTAR] Solicitando cupo para ${categoria} (${modelo})...`);
  await limiter.acquire();

  log.info(`🚀 [MODELO EJECUTANDO] Cupo asignado. Enviando tarea a ${modelo}...`);
  
  const controller = new AbortController();
  // 5 minutos de timeout porque cargar modelos de 14B desde disco puede tardar
  const timeout = setTimeout(() => controller.abort(), 300000); 

  try {
    // CAMBIO CLAVE: Usamos /api/chat en vez de /api/generate
    // Esto asegura que los modelos de chat (llama3, deepseek, etc.) respondan correctamente
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'user', content: prompt }], // Formato de chat
        stream: false,
        keep_alive: 0
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`❌ [ERROR MODELO HTTP] Estado ${response.status}: ${errorText}`);
      throw new Error(`Modelo falló: ${errorText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      log.error(`❌ [ERROR INTERNO OLLAMA MODELO] ${data.error}`);
      throw new Error(data.error);
    }

    // CAMBIO CLAVE: En /api/chat, la respuesta viene en data.message.content
    const respuesta = data.message?.content || '';

    if (!respuesta) {
      log.warn(`⚠️ [RESPUESTA VACÍA] El modelo ${modelo} no generó texto.`);
    } else {
      log.info(`✅ [RESPUESTA RECIBIDA] de ${modelo} (${respuesta.length} caracteres). Cerrando modelo...`);
    }

    await cerrarModelo(modelo);
    return respuesta;

  } catch (err) {
    clearTimeout(timeout);
    log.error(`❌ [EXCEPCIÓN MODELO]: ${err.message}`);
    await cerrarModelo(modelo);
    throw err;
  } finally {
    limiter.release();
  }
}

// ============================================================================
// RUTAS
// ============================================================================

app.get('/health', (req, res) => {
  const limiterStatus = {};
  for (const cat of Object.keys(limiters)) {
    limiterStatus[cat] = { running: limiters[cat].running, limit: limiters[cat].limit, queued: limiters[cat].queue.length };
  }
  res.status(200).json({ status: 'API Privada funcionando', ollama: OLLAMA_BASE, limiters: limiterStatus });
});

app.post('/api/private/execute', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ ok: false, error: 'Prompt inválido' });
    }

    const categoria = await categorizar(prompt);
    const respuesta = await usarModelo(categoria, prompt);

    return res.status(200).json({ ok: true, categoria, respuesta });

  } catch (error) {
    log.error('❌ [ERROR GENERAL EN /EXECUTE]:', error);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor', details: error.message });
  }
});

// CHAT STREAMING
// CHAT STREAMING CON ENRUTAMIENTO AUTOMÁTICO
app.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'Mensajes inválidos' });
    }

    // 1. OBTENER EL ÚLTIMO MENSAJE DEL USUARIO PARA CLASIFICARLO
    const ultimoMensaje = messages.filter(m => m.role === 'user').pop();
    const prompt = ultimoMensaje ? ultimoMensaje.content : '';

    // 2. CLASIFICAR LA TAREA (Usando el Router)
    log.info(`💬 [CHAT] Clasificando nuevo mensaje de chat...`);
    const categoria = await categorizar(prompt); 
    const modeloDestino = modelos[categoria].name;
    
    log.info(`🔀 [CHAT ENRUTADO] Categoría: ${categoria} → Modelo destino: ${modeloDestino}`);
    
    const limiter = limiters[categoria];
    await limiter.acquire();

    // 3. INICIAR STREAM CON EL MODELO DESTINO
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    log.info(`🚀 [CHAT STREAM] Conectando a ${modeloDestino}...`);
    
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: modeloDestino, 
        messages: messages, 
        stream: true, 
        keep_alive: 0 // Liberar al terminar
      })
    });

    if (!response.ok) {
      limiter.release();
      throw new Error(`Error del modelo destino: ${response.status}`);
    }

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
          if (chunk.done) res.write(`data: [DONE]\n\n`);
        } catch (e) {}
      }
    }

    // 4. CERRAR Y LIBERAR
    log.info(`✅ [CHAT STREAM] Finalizado. Cerrando ${modeloDestino}.`);
    limiter.release();
    await cerrarModelo(modeloDestino);
    res.end();

  } catch (error) {
    log.error('❌ [ERROR CHAT ENRUTADO]:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Error en el enrutamiento de chat' });
    }
    res.end();
  }
});

// ============================================================================
// INICIO
// ============================================================================
app.listen(PORT, () => {
  log.info(`🔒 API Privada corriendo en http://localhost:${PORT}`);
  log.info(`🧠 Modo Bajo Demanda + Control de Concurrencia Activado`);
});