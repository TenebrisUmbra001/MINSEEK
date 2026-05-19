// Backend/ApiPrivada.js
const express = require('express');
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

const modelos = {
  router: ["qwen2.5:1.5b"],
  consulta_rapida: ["phi3:mini", "deepseek-r1:1.5b", "llama3.2:1b"],
  resumen: ["qwen2.5:3b"],
  redaccion: ["llama3.1:8b"],
  razonamiento: ["deepseek-r1:7b"],
  analisis_profundo: ["deepseek-r1:14b", "qwen2.5:14b"],
  codigo: ["codeqwen:7b", "starcoder2:3b"],
  multimodal: ["llava:7b", "llava:13b"]
};

const modelLimits = {
  "qwen2.5:1.5b": 4, "phi3:mini": 3, "deepseek-r1:1.5b": 2, "llama3.2:1b": 2,
  "qwen2.5:3b": 2, "llama3.1:8b": 1, "deepseek-r1:7b": 1, "deepseek-r1:14b": 1,
  "qwen2.5:14b": 1, "codeqwen:7b": 1, "starcoder2:3b": 1, "llava:7b": 1, "llava:13b": 1
};

const aliasCategoria = {
  consulta_rapida: "consulta_rapida", "consulta rápida": "consulta_rapida", consulta: "consulta_rapida",
  resumen: "resumen", resumir: "resumen", redaccion: "redaccion", redacción: "redaccion", escritura: "redaccion",
  razonamiento: "razonamiento", logica: "razonamiento", lógica: "razonamiento",
  analisis_profundo: "analisis_profundo", "análisis profundo": "analisis_profundo", analisis: "analisis_profundo",
  codigo: "codigo", code: "codigo", programacion: "codigo", multimodal: "multimodal", imagen: "multimodal"
};

app.use(express.json());

const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.rtf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const docsDir = path.join(__dirname, 'storage', 'docs');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });

const docsStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, docsDir); },
  filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')); }
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

class ConcurrencyLimiter {
  constructor(limit) { this.limit = limit; this.running = 0; this.queue = []; }
  acquire() { return new Promise((resolve) => { if (this.running < this.limit) { this.running++; resolve(); } else { this.queue.push(resolve); } }); }
  tryAcquire() { if (this.running < this.limit) { this.running++; return true; } return false; }
  release() { this.running--; if (this.queue.length > 0) { this.running++; this.queue.shift()(); } }
}

const modelLimiters = {};
for (const name in modelLimits) { modelLimiters[name] = new ConcurrencyLimiter(modelLimits[name]); }

// ============================================================================
// ✅ CAMBIO: Importar la BD compartida en lugar de crear una nueva conexión
// ============================================================================
const db = require('./data/db');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ← FIX: Función para calcular num_ctx dinámicamente
function calcularNumCtx(text, minCtx, maxCtx) {
  var estimatedTokens = Math.ceil(text.length / 3);
  return Math.min(Math.max(estimatedTokens + 1024, minCtx || 4096), maxCtx || 32768);
}

async function cerrarModelo(nombreModelo) {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: nombreModelo, prompt: '', keep_alive: 0 })
    });
  } catch (err) { /* ignore */ }
}

async function obtenerYAdquirirModelo(categoria) {
  const m = modelos[categoria];
  if (!m) throw new Error('Categoría no encontrada: ' + categoria);
  for (const n of m) {
    if (modelLimiters[n].tryAcquire()) return n;
  }
  await modelLimiters[m[0]].acquire();
  return m[0];
}

async function categorizar(prompt) {
  const modeloRouter = modelos.router[0];
  const limiter = modelLimiters[modeloRouter];
  await limiter.acquire();
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
    if (!response.ok) throw new Error('Error en router');
    const data = await response.json();
    await cerrarModelo(modeloRouter);
    let categoria = (data.response || '').trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z_]/g, '');
    const resuelta = aliasCategoria[categoria];
    return (resuelta && modelos[resuelta]) ? resuelta : 'consulta_rapida';
  } catch (err) {
    clearTimeout(timeout);
    await cerrarModelo(modeloRouter);
    return 'consulta_rapida';
  } finally {
    limiter.release();
  }
}

// ← FIX: usarModelo ahora acepta opts con num_ctx
async function usarModelo(categoria, prompt, opts) {
  opts = opts || {};
  const modelo = await obtenerYAdquirirModelo(categoria);
  const limiter = modelLimiters[modelo];

  var numCtx = opts.num_ctx || calcularNumCtx(prompt, 4096, 32768);

  log.info(`🧠 [MODELO] Categoría: ${categoria} → Modelo: ${modelo} | num_ctx: ${numCtx} | prompt_len: ${prompt.length}`);

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
        keep_alive: 0,
        options: {
          num_ctx: numCtx,
          temperature: opts.temperature !== undefined ? opts.temperature : 0.7
        }
      })
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error('Error en llamada a modelo');
    const data = await response.json();
    await cerrarModelo(modelo);
    return data.message?.content || '';
  } catch (err) {
    clearTimeout(timeout);
    await cerrarModelo(modelo);
    throw err;
  } finally {
    limiter.release();
  }
}

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.post('/api/private/execute', async (req, res) => {
  try {
    const { prompt } = req.body;
    const categoria = await categorizar(prompt);
    const respuesta = await usarModelo(categoria, prompt);
    return res.status(200).json({ ok: true, categoria, respuesta });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ← FIX: /chat ahora calcula num_ctx según el contenido total
app.post('/chat', async (req, res) => {
  let modeloEnUso = null; let limiterEnUso = null;
  try {
    const { messages } = req.body;
    if (!messages) return res.status(400).json({ error: 'Inválido' });
    const ultimoMensaje = messages.filter(m => m.role === 'user').pop();
    const prompt = ultimoMensaje ? ultimoMensaje.content : '';
    const categoria = await categorizar(prompt);
    modeloEnUso = await obtenerYAdquirirModelo(categoria);
    limiterEnUso = modelLimiters[modeloEnUso];

    // ← FIX: Calcular num_ctx basado en todo el contenido de los mensajes
    var totalContent = messages.map(m => m.content || '').join('');
    var numCtx = calcularNumCtx(totalContent, 4096, 32768);

    log.info(`🧠 [STREAM] Modelo: ${modeloEnUso} | categoría: ${categoria} | num_ctx: ${numCtx} | total_chars: ${totalContent.length}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modeloEnUso,
        messages: messages,
        stream: true,
        keep_alive: 0,
        options: {
          num_ctx: numCtx  // ← FIX: num_ctx dinámico
        }
      })
    });

    if (!response.ok) throw new Error('Error en stream del modelo');

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
          if (chunk.message && chunk.message.content) res.write(`data: ${JSON.stringify({ content: chunk.message.content })}\n\n`);
          if (chunk.done) res.write(`data: [DONE]\n\n`);
        } catch (e) { /* ignore parse errors */ }
      }
    }

    await cerrarModelo(modeloEnUso);
    res.end();
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ error: 'Error' });
    res.end();
  } finally {
    if (modeloEnUso && limiterEnUso) limiterEnUso.release();
  }
});

// ============================================================================
// RUTAS DE AUTENTICACIÓN
// ============================================================================

// Importar el módulo de usuario
const moduloUser = require('./moduloUser');

/**
 * POST /auth/register
 * Registra un nuevo usuario en la base de datos
 * Body: { usuario, correo, contrasena }
 */
app.post('/auth/register', async (req, res) => {
  try {
    const { usuario, correo, contrasena } = req.body;

    // Validar que se reciban todos los campos requeridos
    if (!usuario || !correo || !contrasena) {
      return res.status(400).json({
        exitoso: false,
        error: 'Campos requeridos: usuario, correo, contrasena',
        codigo: 'CAMPOS_FALTANTES'
      });
    }

    // Llamar al módulo de usuario para registrar
    const resultado = await moduloUser.registrarUsuario(usuario, correo, contrasena);

    if (!resultado.exitoso) {
      return res.status(400).json(resultado);
    }

    log.info(`📝 [AUTH] Nuevo usuario registrado: ${usuario}`);

    return res.status(201).json({
      exitoso: true,
      mensaje: resultado.mensaje,
      idUsuario: resultado.idUsuario,
      usuario: resultado.usuario,
      correo: resultado.correo
    });

  } catch (error) {
    log.error('❌ Error en /auth/register:', error.message);
    return res.status(500).json({
      exitoso: false,
      error: 'Error al registrar usuario',
      codigo: 'ERROR_SERVIDOR'
    });
  }
});

/**
 * POST /auth/generar-codigo
 * Genera un código de 8 cifras para validar el registro
 * Body: { idUsuario }
 */
app.post('/auth/generar-codigo', (req, res) => {
  try {
    const { idUsuario } = req.body;

    if (!idUsuario) {
      return res.status(400).json({
        exitoso: false,
        error: 'idUsuario es requerido',
        codigo: 'CAMPO_FALTANTE'
      });
    }

    const resultado = moduloUser.generarCodigoValidacion(idUsuario);

    if (!resultado.exitoso) {
      return res.status(400).json(resultado);
    }

    log.info(`📧 [AUTH] Código generado para usuario: ${idUsuario}`);

    return res.status(200).json({
      exitoso: true,
      mensaje: 'Código generado. Expira en 10 minutos.',
      expiraEn: resultado.expiraEn,
      // El código se devuelve SOLO para desarrollo/testing
      // En producción, se enviaría por email
      codigo: resultado.codigo
    });

  } catch (error) {
    log.error('❌ Error en /auth/generar-codigo:', error.message);
    return res.status(500).json({
      exitoso: false,
      error: 'Error al generar código',
      codigo: 'ERROR_SERVIDOR'
    });
  }
});

/**
 * POST /auth/validar-codigo
 * Valida el código ingresado por el usuario
 * Body: { idUsuario, codigo }
 */
app.post('/auth/validar-codigo', (req, res) => {
  try {
    const { idUsuario, codigo } = req.body;

    if (!idUsuario || !codigo) {
      return res.status(400).json({
        exitoso: false,
        error: 'idUsuario y codigo son requeridos',
        codigo: 'CAMPOS_FALTANTES'
      });
    }

    const resultado = moduloUser.validarCodigoValidacion(idUsuario, codigo);

    if (!resultado.exitoso) {
      // Retornar intentosRestantes si aplica
      return res.status(400).json(resultado);
    }

    log.info(`✅ [AUTH] Código validado para usuario: ${idUsuario}`);

    return res.status(200).json({
      exitoso: true,
      mensaje: resultado.mensaje,
      esAdmin: resultado.esAdmin || false
    });

  } catch (error) {
    log.error('❌ Error en /auth/validar-codigo:', error.message);
    return res.status(500).json({
      exitoso: false,
      error: 'Error al validar código',
      codigo: 'ERROR_SERVIDOR'
    });
  }
});

/**
 * POST /auth/login
 * Autentica un usuario verificando credenciales
 * Body: { usuario, contrasena }
 */
app.post('/auth/login', async (req, res) => {
  try {
    const { usuario, contrasena } = req.body;

    // Validar que se reciban los campos requeridos
    if (!usuario || !contrasena) {
      return res.status(400).json({
        exitoso: false,
        error: 'Campos requeridos: usuario, contrasena',
        codigo: 'CAMPOS_FALTANTES'
      });
    }

    // Obtener datos de conexión
    const datosConexion = {
      ip: req.ip || req.connection.remoteAddress || 'desconocida',
      userAgent: req.get('user-agent') || 'desconocido'
    };

    // Llamar al módulo de usuario para autenticar
    const resultado = await moduloUser.autenticarUsuario(usuario, contrasena, datosConexion);

    if (!resultado.exitoso) {
      log.warn(`⚠️ [AUTH] Intento de login fallido: ${usuario}`);
      return res.status(401).json(resultado);
    }

    log.info(`✅ [AUTH] Usuario autenticado: ${usuario}`);

    return res.status(200).json({
      exitoso: true,
      mensaje: resultado.mensaje,
      idUsuario: resultado.idUsuario,
      usuario: resultado.usuario,
      correo: resultado.correo,
      idConexion: resultado.idConexion
    });

  } catch (error) {
    log.error('❌ Error en /auth/login:', error.message);
    return res.status(500).json({
      exitoso: false,
      error: 'Error al autenticar usuario',
      codigo: 'ERROR_SERVIDOR'
    });
  }
});

/**
 * POST /auth/logout
 * Cierra la sesión de un usuario
 * Body: { idConexion }
 */
app.post('/auth/logout', (req, res) => {
  try {
    const { idConexion } = req.body;

    if (!idConexion) {
      return res.status(400).json({
        exitoso: false,
        error: 'idConexion es requerido',
        codigo: 'CAMPO_FALTANTE'
      });
    }

    const resultado = moduloUser.cerrarSesion(idConexion);

    if (!resultado.exitoso) {
      return res.status(400).json(resultado);
    }

    log.info(`✅ [AUTH] Sesión cerrada: ${idConexion}`);

    return res.status(200).json({
      exitoso: true,
      mensaje: resultado.mensaje
    });

  } catch (error) {
    log.error('❌ Error en /auth/logout:', error.message);
    return res.status(500).json({
      exitoso: false,
      error: 'Error al cerrar sesión',
      codigo: 'ERROR_SERVIDOR'
    });
  }
});

/**
 * GET /auth/usuario/:idUsuario
 * Obtiene información del usuario (sin datos sensibles)
 */
app.get('/auth/usuario/:idUsuario', (req, res) => {
  try {
    const { idUsuario } = req.params;

    const resultado = moduloUser.obtenerInfoUsuario(idUsuario);

    if (!resultado.exitoso) {
      return res.status(404).json(resultado);
    }

    return res.status(200).json({
      exitoso: true,
      usuario: resultado.usuario
    });

  } catch (error) {
    log.error('❌ Error en /auth/usuario:', error.message);
    return res.status(500).json({
      exitoso: false,
      error: 'Error al obtener información del usuario',
      codigo: 'ERROR_SERVIDOR'
    });
  }
});

/**
 * GET /auth/historial/:idUsuario
 * Obtiene el historial de conexiones de un usuario
 */
app.get('/auth/historial/:idUsuario', (req, res) => {
  try {
    const { idUsuario } = req.params;
    const limite = parseInt(req.query.limite) || 20;

    const resultado = moduloUser.obtenerHistorialConexiones(idUsuario, limite);

    if (!resultado.exitoso) {
      return res.status(400).json(resultado);
    }

    return res.status(200).json({
      exitoso: true,
      historial: resultado.historial
    });

  } catch (error) {
    log.error('❌ Error en /auth/historial:', error.message);
    return res.status(500).json({
      exitoso: false,
      error: 'Error al obtener historial',
      codigo: 'ERROR_SERVIDOR'
    });
  }
});

// ============================================================================
// RUTAS DE DOCUMENTOS
// ============================================================================

app.post('/api/private/upload', uploadDocs.array('archivos', 10), async function (req, res) {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ ok: false, error: 'No se recibieron archivos' });

    var resultados = [];

    for (var i = 0; i < req.files.length; i++) {
      var file = req.files[i];
      try {
        var buffer = fs.readFileSync(file.path);
        var fileHash = sha256(buffer);

        var existente = db.prepare('SELECT id, nombre, path FROM documentos WHERE hash = ? LIMIT 1').get(fileHash);
        if (existente) {
          try { fs.unlinkSync(file.path); } catch (e) {}
          log.info('📄 [DOC] Reutilizado:', existente.nombre);

          // ← FIX CLAVE: Devolver contenido también para documentos reutilizados
          var contenidoReutilizado = '';
          try {
            var rowReutilizado = db.prepare('SELECT contenido FROM documentos WHERE id = ?').get(existente.id);
            contenidoReutilizado = rowReutilizado ? (rowReutilizado.contenido || '') : '';
          } catch (e) {}

          resultados.push({
            ok: true,
            reused: true,
            docId: existente.id,
            nombre: existente.nombre,
            tamaño: file.size,
            contenido: contenidoReutilizado  // ← FIX CLAVE
          });
          continue;
        }

        var ext = path.extname(file.originalname).toLowerCase();
        var contenidoExtraido = '';
        try {
          if (ext === '.docx') {
            contenidoExtraido = (await mammoth.extractRawText({ path: file.path })).value || '';
          } else if (ext === '.pdf') {
            contenidoExtraido = (await pdfParse(buffer)).text || '';
          } else if (['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.rtf'].indexOf(ext) !== -1) {
            contenidoExtraido = fs.readFileSync(file.path, 'utf8');
          } else if (ext === '.doc') {
            try {
              contenidoExtraido = fs.readFileSync(file.path, 'utf8').replace(/[^\x20-\x7E\n\ráéíóúüñÁÉÍÓÚÜÑ]/g, ' ').replace(/\s+/g, ' ').trim();
              if (contenidoExtraido.length < 50) contenidoExtraido = '[Contenido .doc no legible automáticamente - convertí a .docx]';
            } catch (e) {
              contenidoExtraido = '[Contenido .doc no legible automáticamente - convertí a .docx]';
            }
          } else {
            contenidoExtraido = '[Contenido no legible automáticamente]';
          }
        } catch (e) {
          log.warn('⚠️ [DOC] Error extrayendo texto de', file.originalname, e && e.message);
          contenidoExtraido = '[Error al leer archivo]';
        }

        var MAX_CHARS = 20000;
        if (contenidoExtraido && contenidoExtraido.length > MAX_CHARS) {
          contenidoExtraido = contenidoExtraido.substring(0, MAX_CHARS) + '\n\n[... TRUNCADO ...]';
        }

        var safeName = fileHash + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        var destPath = path.join(docsDir, safeName);
        fs.renameSync(file.path, destPath);

        var id = crypto.randomUUID();
        db.prepare(`
          INSERT INTO documentos (id, nombre, hash, contenido, path, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, file.originalname, fileHash, contenidoExtraido, destPath, new Date().toISOString());

        log.info('📄 [DOC] Guardado:', safeName, 'chars:', (contenidoExtraido || '').length);

        // ← FIX CLAVE: Incluir contenido en la respuesta
        resultados.push({
          ok: true,
          reused: false,
          docId: id,
          nombre: file.originalname,
          tamaño: file.size,
          contenido: contenidoExtraido  // ← FIX CLAVE: Esto es lo que faltaba
        });
      } catch (fileErr) {
        log.error('❌ [DOC] Error procesando archivo', file && file.originalname, fileErr && fileErr.message);
        try { if (file && file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) {}
        resultados.push({ ok: false, nombre: file ? file.originalname : 'unknown', error: fileErr.message || 'Error interno' });
      }
    }

    log.info('📄 [DOCS] Procesados:', resultados.length);
    return res.status(200).json({ ok: true, archivos: resultados });

  } catch (err) {
    log.error('❌ Error en /api/private/upload (general):', err && err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' });
  }
});

// ============================================================================
// RUTA: Listar documentos
// ============================================================================
app.get('/api/private/documents', function (req, res) {
  try {
    try {
      var rows = db.prepare('SELECT id, nombre, created_at FROM documentos ORDER BY created_at DESC').all();
      return res.status(200).json({ ok: true, documentos: rows });
    } catch (dbErr) {
      log.warn('⚠️ [DOCS] No se pudo leer tabla documentos, listando desde filesystem:', dbErr && dbErr.message);
      var d = [];
      fs.readdirSync(docsDir).forEach(f => {
        try { var s = fs.statSync(path.join(docsDir, f)); if (s.isFile()) d.push({ nombre: f, tamaño: s.size }); } catch(e){}
      });
      return res.status(200).json({ ok: true, documentos: d });
    }
  } catch (err) {
    log.error('❌ Error listando documentos:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Error al leer documentos' });
  }
});

// ============================================================================
// RUTA: Preguntar sobre un documento
// ============================================================================
app.post('/api/private/ask-doc', async function (req, res) {
  try {
    var docId = req.body.docId || req.body.documentId;
    var pregunta = req.body.pregunta || req.body.question;
    if (!docId || !pregunta) return res.status(400).json({ ok: false, error: 'Faltan parámetros docId o pregunta' });

    var row = db.prepare('SELECT contenido, nombre FROM documentos WHERE id = ?').get(docId);
    if (!row) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });

    var texto = row.contenido || '';

    log.info('📣 [ASK-DOC] docId=', docId, 'nombre=', row.nombre, 'texto_len=', texto.length);

    if (!texto || texto.startsWith('[Contenido no legible') || texto.startsWith('[Error al leer') || texto.startsWith('[Contenido .doc no legible')) {
      return res.status(400).json({
        ok: false,
        error: 'El documento no tiene contenido legible extraído. Probá subirlo en formato .pdf, .docx o .txt'
      });
    }

    var prompt = 'Eres un asistente experto. Usa EXACTAMENTE el siguiente documento para responder. Si la respuesta no está en el documento, decilo claramente.\n\nDOCUMENTO:\n' + texto + '\n\nPREGUNTA:\n' + pregunta + '\n\nRESPONDE SOLO BASADO EN EL DOCUMENTO.';

    var estimatedTokens = Math.ceil(prompt.length / 3);
    var numCtx = Math.min(Math.max(estimatedTokens + 1024, 4096), 32768);

    log.info('📣 [ASK-DOC] num_ctx=', numCtx, 'prompt_len=', prompt.length);

    var respuesta;
    try {
      respuesta = await usarModelo('analisis_profundo', prompt, { num_ctx: numCtx });
    } catch (modelErr) {
      log.error('❌ Error llamando al modelo en /ask-doc:', modelErr && modelErr.message);
      return res.status(500).json({ ok: false, error: 'Error al procesar la pregunta con el modelo' });
    }

    return res.status(200).json({ ok: true, respuesta: respuesta, docNombre: row.nombre });

  } catch (err) {
    log.error('❌ Error en /api/private/ask-doc:', err && err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' });
  }
});

// ============================================================================
// Error handler
// ============================================================================
app.use(function (err, req, res, next) {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_UNEXPECTED_FILE' || err.name === 'MulterError')) return res.status(400).json({ ok: false, error: err.message });
  if (err) return res.status(400).json({ ok: false, error: err.message });
  next();
});

app.listen(PORT, () => { log.info(`🔒 API Privada corriendo en http://localhost:${PORT}`); });