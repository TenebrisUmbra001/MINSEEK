// Backend/ApiPrivada.js
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 6969;
const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';

const log = {
  info: (...args) => console.log(new Date().toISOString(), 'ℹ️', ...args),
  warn: (...args) => console.warn(new Date().toISOString(), '⚠️', ...args),
  error: (...args) => console.error(new Date().toISOString(), '❌', ...args)
};

// -----------------------------
// MAPA DE MODELOS Y LÍMITES
// -----------------------------
const modelos = {
  router:           ["qwen2.5:1.5b"],
  consulta_rapida:  ["phi3:mini", "deepseek-r1:1.5b", "llama3.2:1b"], 
  resumen:          ["qwen2.5:3b"],
  redaccion:        ["llama3.1:8b"],
  razonamiento:     ["deepseek-r1:7b"],
  analisis_profundo:["deepseek-r1:14b", "qwen2.5:14b"],
  codigo:           ["codeqwen:7b", "starcoder2:3b"],
  multimodal:       ["llava:7b", "llava:13b"]
};

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
// CONFIGURACIÓN DE SUBIDA DE DOCUMENTOS
// ============================================================================
const allowedExtensions = [
  '.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx',
  '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf',
  '.csv', '.md', '.json', '.xml', '.html', '.htm',
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'
];

const docsDir = path.join(__dirname, 'storage', 'docs');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
log.info('📁 [DOCS] Carpeta de documentos:', docsDir);

const docsStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, docsDir); },
  filename: function (req, file, cb) {
    var safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, Date.now() + '-' + safeName);
  }
});

var uploadDocs = multer({
  storage: docsStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    var ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.indexOf(ext) !== -1) cb(null, true);
    else cb(new Error('Extensión no permitida: ' + ext), false);
  }
});

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
  tryAcquire() { if (this.running < this.limit) { this.running++; return true; } return false; }
  release() { this.running--; if (this.queue.length > 0) { this.running++; this.queue.shift()(); } }
}

const modelLimiters = {};
for (const name in modelLimits) {
  modelLimiters[name] = new ConcurrencyLimiter(modelLimits[name]);
}

// ============================================================================
// BASE DE DATOS
// ============================================================================
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================================
// FUNCIONES DE CICLO DE VIDA Y MODELOS
// ============================================================================
async function cerrarModelo(nombreModelo) {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: nombreModelo, prompt: '', keep_alive: 0 }) });
  } catch (err) {}
}

async function obtenerYAdquirirModelo(categoria) {
  const modelosEnCategoria = modelos[categoria];
  if (!modelosEnCategoria) throw new Error(`Categoría ${categoria} no existe`);
  for (const modelName of modelosEnCategoria) {
    if (modelLimiters[modelName].tryAcquire()) return modelName;
  }
  const primerModelo = modelosEnCategoria[0];
  await modelLimiters[primerModelo].acquire();
  return primerModelo;
}

async function categorizar(prompt) {
  const modeloRouter = modelos.router[0];
  const limiter = modelLimiters[modeloRouter];
  await limiter.acquire();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); 
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model: modeloRouter, prompt: `Clasifica esta tarea en EXACTAMENTE UNA de estas categorías: consulta_rapida, resumen, redaccion, razonamiento, analisis_profundo, codigo, multimodal. Solo responde con la categoría, nada más.\n\nTarea: ${prompt}`, stream: false, keep_alive: 0 })
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error('Router falló');
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    await cerrarModelo(modeloRouter);
    let categoria = (data.response || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z_]/g, ''); 
    const resuelta = aliasCategoria[categoria];
    if (!resuelta || !modelos[resuelta]) return 'consulta_rapida';
    return resuelta;
  } catch (err) {
    clearTimeout(timeout); await cerrarModelo(modeloRouter); return 'consulta_rapida'; 
  } finally { limiter.release(); }
}

async function usarModelo(categoria, prompt) {
  const modelo = await obtenerYAdquirirModelo(categoria);
  const limiter = modelLimiters[modelo];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000); 
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ model: modelo, messages: [{ role: 'user', content: prompt }], stream: false, keep_alive: 0 })
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error('Modelo falló');
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    await cerrarModelo(modelo);
    return data.message?.content || '';
  } catch (err) {
    clearTimeout(timeout); await cerrarModelo(modelo); throw err;
  } finally { limiter.release(); }
}

// ============================================================================
// RUTAS
// ============================================================================
app.get('/health', (req, res) => res.status(200).json({ status: 'API Privada funcionando' }));

app.post('/api/private/execute', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ ok: false, error: 'Prompt inválido' });
    const categoria = await categorizar(prompt);
    const respuesta = await usarModelo(categoria, prompt);
    return res.status(200).json({ ok: true, categoria, respuesta });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Error interno', details: error.message });
  }
});

app.post('/chat', async (req, res) => {
  let modeloEnUso = null; let limiterEnUso = null;
  try {
    const { messages } = req.body;
    if (!messages) return res.status(400).json({ success: false, error: 'Mensajes inválidos' });
    const ultimoMensaje = messages.filter(m => m.role === 'user').pop();
    const prompt = ultimoMensaje ? ultimoMensaje.content : '';
    const categoria = await categorizar(prompt); 
    modeloEnUso = await obtenerYAdquirirModelo(categoria);
    limiterEnUso = modelLimiters[modeloEnUso];
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modeloEnUso, messages: messages, stream: true, keep_alive: 0 })
    });
    if (!response.ok) throw new Error(`Error del modelo destino: ${response.status}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        if (line.trim() === '') continue;
        try { const chunk = JSON.parse(line); if (chunk.message && chunk.message.content) res.write(`data: ${JSON.stringify({ content: chunk.message.content })}\n\n`); if (chunk.done) res.write(`data: [DONE]\n\n`); } catch (e) {}
      }
    }
    await cerrarModelo(modeloEnUso); res.end();
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Error en el enrutamiento' });
    res.end();
  } finally { if (modeloEnUso && limiterEnUso) limiterEnUso.release(); }
});

// ============================================================================
// RUTAS DE DOCUMENTOS (CON EXTRACCIÓN DE TEXTO)
// ============================================================================
app.post('/api/private/upload', uploadDocs.single('documento'), async function (req, res) {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo' });

  var contenidoExtraido = '';
  var ext = path.extname(req.file.originalname).toLowerCase();

  try {
    if (ext === '.docx') {
      var resultMammoth = await mammoth.extractRawText({ path: req.file.path });
      contenidoExtraido = resultMammoth.value;
    } else if (ext === '.pdf') {
      var dataBuffer = fs.readFileSync(req.file.path);
      var resultPdf = await pdfParse(dataBuffer);
      contenidoExtraido = resultPdf.text;
    } else if (['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.rtf'].indexOf(ext) !== -1) {
      contenidoExtraido = fs.readFileSync(req.file.path, 'utf8');
    } else {
      contenidoExtraido = '[El contenido de este tipo de archivo no se puede leer automáticamente. Es una imagen o formato binario.]';
    }

    // Limitar tamaño del texto para no saturar la memoria del modelo de IA (máx ~4000 caracteres)
    if (contenidoExtraido.length > 4000) {
      contenidoExtraido = contenidoExtraido.substring(0, 4000) + '\n\n[... CONTENIDO TRUNCADO POR TAMAÑO ...]';
    }
  } catch (extractErr) {
    log.error('⚠️ [DOCS] Error extrayendo texto:', extractErr.message);
    contenidoExtraido = '[Error al extraer el texto del archivo]';
  }

  log.info('📄 [DOCUMENTO] Archivo guardado y procesado: ' + req.file.filename + ' (' + contenidoExtraido.length + ' caracteres extraídos)');
  
  return res.status(200).json({
    ok: true,
    nombre: req.file.originalname,
    nombreGuardado: req.file.filename,
    tamaño: req.file.size,
    mimetype: req.file.mimetype,
    ruta: req.file.path,
    contenido: contenidoExtraido // <--- AQUÍ ESTÁ LA MAGIA
  });``
});

app.get('/api/private/documents', function (req, res){
  try {
    var files = fs.readdirSync(docsDir);
    var documents = [];
    files.forEach(function (f) {
      try { var stats = fs.statSync(path.join(docsDir, f)); if (stats.isFile()) documents.push({ nombreGuardado: f, tamaño: stats.size, fecha: stats.mtime }); } catch (e) {}
    });
    return res.status(200).json({ ok: true, documentos: documents });
  } catch (err) { return res.status(500).json({ ok: false, error: 'Error al leer documentos' }); }
});

app.use(function (err, req, res, next) {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ ok: false, error: 'Archivo muy grande (Max 50MB)' });
  if (err && err.name === 'MulterError') return res.status(400).json({ ok: false, error: 'Error en subida: ' + err.message });
  if (err) return res.status(400).json({ ok: false, error: err.message });
  next();
});

// ============================================================================
app.listen(PORT, () => {
  log.info(`🔒 API Privada corriendo en http://localhost:${PORT}`);
});