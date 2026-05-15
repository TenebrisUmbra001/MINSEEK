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
// MAPA DE MODELOS (POR PRIORIDAD) Y LÍMITES INDIVIDUALES
// -----------------------------
const modelos = {
  router:           ["qwen2.5:1.5b"],
  consulta_rapida:  ["phi3:mini", "deepseek-r1:1.5b", "llama3.2:1b"], 
  resumen:          ["qwen2.5:3b"],
  redaccion:        ["llama3.1:8b"],
  razonamiento:     ["deepseek-r1:7b"],
  analisis_profundo:["deepseek-r1:14b", "qwen2.5:14b"], // Intenta deepseek, si está lleno usa qwen
  codigo:           ["codeqwen:7b", "starcoder2:3b"],
  multimodal:       ["llava:7b", "llava:13b"]
};

// Límites de concurrencia POR MODELO INDIVIDUAL (ajusta según tu VRAM)
const modelLimits = {
  "qwen2.5:1.5b": 4, "phi3:mini": 3, "deepseek-r1:1.5b": 2, "llama3.2:1b": 2,
  "qwen2.5:3b": 2, "llama3.1:8b": 1, "deepseek-r1:7b": 1, "deepseek-r1:14b": 1,
  "qwen2.5:14b": 1, "codeqwen:7b": 1, "starcoder2:3b": 1, "llava:7b": 1, "llava:13b": 1
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

  // Método nuevo: intenta adquirir sin bloquear. Devuelve true si lo logró, false si está lleno.
  tryAcquire() {
    if (this.running < this.limit) {
      this.running++;
      return true;
    }
    return false;
  }

  release() {
    this.running--;
    if (this.queue.length > 0) { this.running++; this.queue.shift()(); }
  }
}

// Inicializar limitadores por modelo
const modelLimiters = {};
for (const name in modelLimits) {
  modelLimiters[name] = new ConcurrencyLimiter(modelLimits[name]);
  log.info(`🏗️ [LIMITER] Modelo ${name}: Máximo ${modelLimits[name]} simultáneos.`);
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
// BUSCADOR DE MODELO LIBRE (PRIORIDAD)
// ============================================================================
async function obtenerYAdquirirModelo(categoria) {
  const modelosEnCategoria = modelos[categoria];
  if (!modelosEnCategoria) throw new Error(`Categoría ${categoria} no existe`);

  // Intento 1: Buscar el primer modelo que tenga un cupo libre instantáneamente
  for (const modelName of modelosEnCategoria) {
    const limiter = modelLimiters[modelName];
    if (limiter.tryAcquire()) {
      log.info(`✅ [DISPONIBLE] ${modelName} seleccionado para ${categoria} (Ocupados: ${limiter.running}/${limiter.limit})`);
      return modelName;
    } else {
      log.warn(`⏳ [OCUPADO] ${modelName} está lleno. Probando siguiente modelo...`);
    }
  }

  // Intento 2: Si TODOS están ocupados, nos ponemos en la cola del PRIMER modelo (prioridad principal)
  const primerModelo = modelosEnCategoria[0];
  log.warn(`🟥 [COLA LLENA] Todos los modelos de ${categoria} ocupados. Esperando cupo de ${primerModelo}...`);
  await modelLimiters[primerModelo].acquire(); // El código se pausa aquí hasta que haya cupo
  return primerModelo;
}

// ============================================================================
// FLUJO PRINCIPAL CON CONTROL DE CONCURRENCIA
// ============================================================================

async function categorizar(prompt) {
  const modeloRouter = modelos.router[0]; // El router es fijo
  const limiter = modelLimiters[modeloRouter];

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
    categoria = categoria.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    categoria = categoria.replace(/[^a-z_]/g, ''); 

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
  // Obtenemos el modelo libre y ocupamos su cupo
  const modelo = await obtenerYAdquirirModelo(categoria);
  const limiter = modelLimiters[modelo];

  log.info(`🚀 [MODELO EJECUTANDO] Enviando tarea a ${modelo}...`);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); 

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelo,
        messages: [{ role: 'user', content: prompt }],
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
  for (const name in modelLimiters) {
    limiterStatus[name] = { running: modelLimiters[name].running, limit: modelLimiters[name].limit, queued: modelLimiters[name].queue.length };
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

// CHAT STREAMING CON ENRUTAMIENTO AUTOMÁTICO Y FALLBACK
app.post('/chat', async (req, res) => {
  let modeloEnUso = null;
  let limiterEnUso = null;

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'Mensajes inválidos' });
    }

    const ultimoMensaje = messages.filter(m => m.role === 'user').pop();
    const prompt = ultimoMensaje ? ultimoMensaje.content : '';

    log.info(`💬 [CHAT] Clasificando nuevo mensaje de chat...`);
    const categoria = await categorizar(prompt); 
    
    // Buscamos el modelo libre (prioridad)
    modeloEnUso = await obtenerYAdquirirModelo(categoria);
    limiterEnUso = modelLimiters[modeloEnUso];
    
    log.info(`🔀 [CHAT ENRUTADO] Categoría: ${categoria} → Modelo: ${modeloEnUso}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    log.info(`🚀 [CHAT STREAM] Conectando a ${modeloEnUso}...`);
    
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: modeloEnUso, 
        messages: messages, 
        stream: true, 
        keep_alive: 0
      })
    });

    if (!response.ok) {
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

    log.info(`✅ [CHAT STREAM] Finalizado. Cerrando ${modeloEnUso}.`);
    await cerrarModelo(modeloEnUso);
    res.end();

  } catch (error) {
    log.error('❌ [ERROR CHAT ENRUTADO]:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: 'Error en el enrutamiento de chat' });
    }
    res.end();
  } finally {
    // Nos aseguramos de liberar el cupo del modelo específico que se usó
    if (modeloEnUso && limiterEnUso) {
      limiterEnUso.release();
    }
  }
});

// ============================================================================
// INICIO
// ============================================================================
app.listen(PORT, () => {
  log.info(`🔒 API Privada corriendo en http://localhost:${PORT}`);
  log.info(`🧠 Modo Bajo Demanda + Control de Concurrencia + Fallback de Modelos Activado`);
});