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

// ============================================================================
// Model manager centralizado (usa Ollama local + Groq como opción remota)
// ============================================================================
const modelManager = require('./modelManager');
const {
  usarModelo,
  usarGroq,
  obtenerYAdquirirModelo,
  cerrarModelo,
  calcularNumCtx,
  validarYAdjustarNumCtx,
  modelLimiters,
  modelos
} = modelManager;

const log = modelManager.log;

// ✅ NUEVO: Importar servicio de correo Zimbra
const emailService = require('./emailService');

// ============================================================================
// CONFIGURACIÓN OPTIMIZADA DE MODELOS (Basado en tu Ollama List)
// Nota: la lista de modelos se mantiene en modelManager; aquí solo alias y límites lógicos.
// ============================================================================
const modelLimits = {
  "qwen2.5:1.5b": 4, "phi3:mini": 3, "llama3.2:1b": 3,
  "qwen2.5:3b": 2, "deepseek-r1:1.5b": 2,
  "llama3.1:8b": 1, "deepseek-r1:7b": 1, "codeqwen:7b": 1,
  "qwen2.5:14b": 1, "deepseek-r1:14b": 1,
  "llava:7b": 1, "llava:13b": 1, "starcoder2:3b": 1
};

const aliasCategoria = {
  consulta_rapida: "consulta_rapida", "consulta rápida": "consulta_rapida", consulta: "consulta_rapida",
  resumen: "resumen", resumir: "resumen", redaccion: "redaccion", redacción: "redaccion", escritura: "redaccion",
  razonamiento: "razonamiento", logica: "razonamiento", lógica: "razonamiento",
  codigo: "codigo", code: "codigo", programacion: "codigo", multimodal: "multimodal", imagen: "multimodal"
};

// ============================================================================
// LÍMITES REALES DE CONTEXTO POR MODELO (delegado a modelManager)
// ============================================================================
const maxCtxPorModelo = modelManager.maxCtxPorModelo || {};

// ============================================================================
// MIDDLEWARES Y DIRECTORIOS
// ============================================================================
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

// ── Directorio para fotos de perfil de usuarios ──
const usersDir = path.join(__dirname, 'storage', 'users');
if (!fs.existsSync(usersDir)) fs.mkdirSync(usersDir, { recursive: true });

const usersStorage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, usersDir); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const idUsuario = req.body.idUsuario || 'unknown';
    cb(null, idUsuario + '_' + Date.now() + ext);
  }
});

const uploadUserPhoto = multer({
  storage: usersStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máximo
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].indexOf(ext) !== -1) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (jpg, png, gif, webp)'), false);
    }
  }
});

const db = require('./data/db');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function truncarTextoInteligente(texto, maxChars) {
  if (!texto || texto.length <= maxChars) return texto;
  var mitad = Math.floor(maxChars / 2);
  var inicio = texto.substring(0, mitad);
  var final = texto.substring(texto.length - mitad);
  return inicio + '\n\n[... DOCUMENTO TRUNCADO POR EXCEDER EL LÍMITE DE MEMORIA DEL SISTEMA. Se muestra el inicio y el final ...]\n\n' + final;
}

// ============================================================================
// FUNCIONES DE RUTEO Y SELECCIÓN (manteniendo tu router como antes)
// ============================================================================

async function categorizar(prompt) {
  const modeloRouter = (modelos && modelos.router && modelos.router[0]) || 'qwen2.5:1.5b';
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
        prompt: `Clasifica esta tarea en EXACTAMENTE UNA de estas categorías: consulta_rapida, resumen, redaccion, razonamiento, codigo, multimodal. Solo responde con la categoría, nada más.\n\nTarea: ${prompt}`,
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

// ============================================================================
// ENDPOINTS
// ============================================================================

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.post('/api/private/execute', async (req, res) => {
  try {
    const { prompt } = req.body;
    const categoria = await categorizar(prompt);
    const respuesta = await usarModelo(categoria, prompt);
    return res.status(200).json({ ok: true, categoria, respuesta });
  } catch (error) {
    log.error('❌ Error en /api/private/execute:', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ============================================================================
// RUTA /chat (Timeout 15 min + Qwen rápido para Docs + Truncado)
// ============================================================================
app.post('/chat', async (req, res) => {
  let modeloEnUso = null; let limiterEnUso = null;
  try {
    const { messages } = req.body;
    if (!messages) return res.status(400).json({ error: 'Inválido' });

    const ultimoMensaje = messages.filter(m => m.role === 'user').pop();
    const prompt = ultimoMensaje ? ultimoMensaje.content : '';

    var totalContent = messages.map(m => m.content || '').join('');
    var categoria;

    if (totalContent.length > 3000) {
      categoria = 'resumen';
      log.info(`📄 [STREAM] Documento largo (${totalContent.length} chars) → Forzando resumen (Qwen rápido)`);

      var LIMITE_ABSOLUTO_CHARS = 50000;
      if (totalContent.length > LIMITE_ABSOLUTO_CHARS) {
        log.warn(`⚠️ [STREAM] Documento gigante (${totalContent.length} chars). Truncando a ${LIMITE_ABSOLUTO_CHARS} chars.`);
        var charsActuales = 0;
        var mensajesTruncados = [];
        for (var i = 0; i < messages.length; i++) {
          var msg = { role: messages[i].role };
          var content = messages[i].content || '';
          if (charsActuales + content.length > LIMITE_ABSOLUTO_CHARS) {
            var espacioRestante = LIMITE_ABSOLUTO_CHARS - charsActuales;
            msg.content = truncarTextoInteligente(content, espacioRestante);
            mensajesTruncados.push(msg);
            break;
          } else {
            msg.content = content;
            mensajesTruncados.push(msg);
            charsActuales += content.length;
          }
        }
        req.body.messages = mensajesTruncados;
        totalContent = mensajesTruncados.map(m => m.content || '').join('');
      }
    } else {
      categoria = await categorizar(prompt);
    }

    modeloEnUso = await obtenerYAdquirirModelo(categoria);
    limiterEnUso = modelLimiters[modeloEnUso];

    var numCtx = calcularNumCtx(totalContent, 4096, 32768);
    numCtx = validarYAdjustarNumCtx(modeloEnUso, numCtx);

    log.info(`🧠 [STREAM] Modelo: ${modeloEnUso} | categoría: ${categoria} | num_ctx: ${numCtx} | total_chars: ${totalContent.length}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900000);

    try {
      const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: modeloEnUso,
          messages: req.body.messages,
          stream: true,
          keep_alive: 0,
          options: { num_ctx: numCtx }
        })
      });

      clearTimeout(timeout);

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

    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        log.error(`⏱️ [STREAM] TIMEOUT de 15 min para ${modeloEnUso}. Cancelando y liberando memoria.`);
        await cerrarModelo(modeloEnUso);
        if (!res.headersSent) return res.status(504).json({ error: 'El modelo tardó demasiado. Intenta una pregunta más corta o un documento más pequeño.' });
        res.end();
      } else {
        throw fetchErr;
      }
    }

  } catch (error) {
    log.error('❌ Error en /chat:', error.message);
    if (modeloEnUso) await cerrarModelo(modeloEnUso);
    if (!res.headersSent) return res.status(500).json({ error: 'Error en el servidor' });
    res.end();
  } finally {
    if (limiterEnUso) limiterEnUso.release();
  }
});

// ============================================================================
// RUTAS DE AUTENTICACIÓN
// ============================================================================
const moduloUser = require('./moduloUser');

app.post('/auth/register', async (req, res) => {
  try {
    const { usuario, correo, contrasena } = req.body;
    if (!usuario || !correo || !contrasena) {
      return res.status(400).json({ exitoso: false, error: 'Campos requeridos: usuario, correo, contrasena', codigo: 'CAMPOS_FALTANTES' });
    }
    const resultado = await moduloUser.registrarUsuario(usuario, correo, contrasena);
    if (!resultado.exitoso) { return res.status(400).json(resultado); }
    log.info(`📝 [AUTH] Nuevo usuario registrado: ${usuario}`);
    return res.status(201).json({ exitoso: true, mensaje: resultado.mensaje, idUsuario: resultado.idUsuario, usuario: resultado.usuario, correo: resultado.correo });
  } catch (error) {
    log.error('❌ Error en /auth/register:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error al registrar usuario', codigo: 'ERROR_SERVIDOR' });
  }
});

// ✅ MODIFICADA: Ahora genera el código, envía correo por Zimbra y no devuelve el código en JSON
app.post('/auth/generar-codigo', async (req, res) => {
  try {
    const { idUsuario } = req.body;
    if (!idUsuario) { return res.status(400).json({ exitoso: false, error: 'idUsuario es requerido', codigo: 'CAMPO_FALTANTE' }); }

    // 1. Obtener el correo del usuario
    const infoUser = moduloUser.obtenerInfoUsuario(idUsuario);
    if (!infoUser.exitoso || !infoUser.usuario.Correo) {
      return res.status(404).json({ exitoso: false, error: 'Usuario no encontrado o sin correo registrado' });
    }
    const correoDestino = infoUser.usuario.Correo;

    // 2. Generar código en base de datos
    const resultado = moduloUser.generarCodigoValidacion(idUsuario);
    if (!resultado.exitoso) { return res.status(400).json(resultado); }

    // 3. Intentar enviar el correo por Zimbra
    const emailResult = await emailService.enviarCodigoVerificacion(correoDestino, resultado.codigo);
    
    if (!emailResult.exitoso) {
      // ❌ Si el correo falla, HACEMOS ROLLBACK: Eliminamos el usuario y sus códigos
      log.error(`❌ [AUTH] Falló el envío de correo a ${correoDestino}. Ejecutando rollback de usuario...`);
      moduloUser.eliminarUsuarioPendiente(idUsuario);
      
      // Devolvemos error al frontend para que NO abra el modal y el usuario intente de nuevo
      return res.status(500).json({ 
        exitoso: false, 
        error: 'No se pudo enviar el correo de verificación. Por favor, verifica que el correo sea correcto e intenta registrarte de nuevo.' 
      });
    }

    log.info(`📧 [AUTH] Código enviado por correo a: ${correoDestino}`);

    // 4. Respuesta al frontend si todo salió bien
    return res.status(200).json({ 
      exitoso: true, 
      mensaje: 'Código de verificación enviado a tu correo. Expira en 10 minutos.', 
      expiraEn: resultado.expiraEn
    });
  } catch (error) {
    log.error('❌ Error en /auth/generar-codigo:', error.message);
    
    // En caso de error crítico del servidor, también borramos el usuario
    if (req.body.idUsuario) {
      moduloUser.eliminarUsuarioPendiente(req.body.idUsuario);
    }
    
    return res.status(500).json({ exitoso: false, error: 'Error interno al generar y enviar código', codigo: 'ERROR_SERVIDOR' });
  }
});
app.post('/auth/validar-codigo', (req, res) => {
  try {
    const { idUsuario, codigo } = req.body;
    if (!idUsuario || !codigo) { return res.status(400).json({ exitoso: false, error: 'idUsuario y codigo son requeridos', codigo: 'CAMPOS_FALTANTES' }); }
    const resultado = moduloUser.validarCodigoValidacion(idUsuario, codigo);
    if (!resultado.exitoso) { return res.status(400).json(resultado); }
    log.info(`✅ [AUTH] Código validado para usuario: ${idUsuario}`);
    return res.status(200).json({ exitoso: true, mensaje: resultado.mensaje, esAdmin: resultado.esAdmin || false });
  } catch (error) {
    log.error('❌ Error en /auth/validar-codigo:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error al validar código', codigo: 'ERROR_SERVIDOR' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { usuario, contrasena } = req.body;
    if (!usuario || !contrasena) { return res.status(400).json({ exitoso: false, error: 'Campos requeridos: usuario, contrasena', codigo: 'CAMPOS_FALTANTES' }); }
    const datosConexion = { ip: req.ip || req.connection.remoteAddress || 'desconocida', userAgent: req.get('user-agent') || 'desconocido' };
    const resultado = await moduloUser.autenticarUsuario(usuario, contrasena, datosConexion);
    if (!resultado.exitoso) { log.warn(`⚠️ [AUTH] Intento de login fallido: ${usuario}`); return res.status(401).json(resultado); }
    log.info(`✅ [AUTH] Usuario autenticado: ${usuario}`);
    return res.status(200).json({ exitoso: true, mensaje: resultado.mensaje, idUsuario: resultado.idUsuario, usuario: resultado.usuario, correo: resultado.correo, idConexion: resultado.idConexion });
  } catch (error) {
    log.error('❌ Error en /auth/login:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error al autenticar usuario', codigo: 'ERROR_SERVIDOR' });
  }
});

app.post('/auth/logout', (req, res) => {
  try {
    const { idConexion } = req.body;
    if (!idConexion) { return res.status(400).json({ exitoso: false, error: 'idConexion es requerido', codigo: 'CAMPO_FALTANTE' }); }
    const resultado = moduloUser.cerrarSesion(idConexion);
    if (!resultado.exitoso) { return res.status(400).json(resultado); }
    log.info(`✅ [AUTH] Sesión cerrada: ${idConexion}`);
    return res.status(200).json({ exitoso: true, mensaje: resultado.mensaje });
  } catch (error) {
    log.error('❌ Error en /auth/logout:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error al cerrar sesión', codigo: 'ERROR_SERVIDOR' });
  }
});

app.get('/auth/usuario/:idUsuario', (req, res) => {
  try {
    const { idUsuario } = req.params;
    const resultado = moduloUser.obtenerInfoUsuario(idUsuario);
    if (!resultado.exitoso) { return res.status(404).json(resultado); }
    return res.status(200).json({ exitoso: true, usuario: resultado.usuario });
  } catch (error) {
    log.error('❌ Error en /auth/usuario:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error al obtener información del usuario', codigo: 'ERROR_SERVIDOR' });
  }
});

app.get('/auth/historial/:idUsuario', (req, res) => {
  try {
    const { idUsuario } = req.params;
    const limite = parseInt(req.query.limite) || 20;
    const resultado = moduloUser.obtenerHistorialConexiones(idUsuario, limite);
    if (!resultado.exitoso) { return res.status(400).json(resultado); }
    return res.status(200).json({ exitoso: true, historial: resultado.historial });
  } catch (error) {
    log.error('❌ Error en /auth/historial:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error al obtener historial', codigo: 'ERROR_SERVIDOR' });
  }
});

app.post('/auth/actualizar-usuario', uploadUserPhoto.single('foto'), async (req, res) => {
  try {
    const { idUsuario, nombreVisible, contrasena, contrasenaActual } = req.body;
    if (!idUsuario) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) { }
      }
      return res.status(400).json({ exitoso: false, error: 'idUsuario requerido' });
    }

    let fotoPerfilPath = undefined;
    if (req.file) {
      const oldUser = db.prepare('SELECT FotoPerfilPath FROM Usuario WHERE id = ?').get(idUsuario);
      if (oldUser && oldUser.FotoPerfilPath) {
        try {
          if (fs.existsSync(oldUser.FotoPerfilPath)) fs.unlinkSync(oldUser.FotoPerfilPath);
        } catch (e) {
          log.warn('⚠️ No se pudo eliminar foto anterior:', e.message);
        }
      }
      fotoPerfilPath = req.file.path;
    }

    const resultado = await moduloUser.actualizarUsuario(idUsuario, {
      nombreVisible,
      contrasena,
      contrasenaActual,
      fotoPerfilPath
    });

    if (!resultado.exitoso) {
      if (req.file && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (e) { }
      }
      return res.status(400).json(resultado);
    }

    log.info(`✅ [AUTH] Usuario actualizado: ${idUsuario}`);

    return res.status(200).json({
      exitoso: true,
      mensaje: resultado.mensaje,
      usuario: resultado.usuario
    });
  } catch (error) {
    log.error('❌ Error en /auth/actualizar-usuario:', error.message);
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) { }
    }
    return res.status(500).json({ exitoso: false, error: 'Error al actualizar usuario' });
  }
});

app.get('/auth/usuario-foto/:idUsuario', (req, res) => {
  try {
    const usuario = db.prepare('SELECT FotoPerfilPath FROM Usuario WHERE id = ?').get(req.params.idUsuario);
    if (usuario && usuario.FotoPerfilPath && fs.existsSync(usuario.FotoPerfilPath)) {
      return res.sendFile(path.resolve(usuario.FotoPerfilPath));
    }
    return res.status(404).send('Foto no encontrada');
  } catch (err) {
    log.error('❌ Error sirviendo foto de usuario:', err.message);
    return res.status(500).send('Error');
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
          try { fs.unlinkSync(file.path); } catch (e) { }
          log.info('📄 [DOC] Reutilizado:', existente.nombre);
          var contenidoReutilizado = '';
          try { var rowReutilizado = db.prepare('SELECT contenido FROM documentos WHERE id = ?').get(existente.id); contenidoReutilizado = rowReutilizado ? (rowReutilizado.contenido || '') : ''; } catch (e) { }
          resultados.push({ ok: true, reused: true, docId: existente.id, nombre: existente.nombre, tamaño: file.size, contenido: contenidoReutilizado });
          continue;
        }
        var ext = path.extname(file.originalname).toLowerCase();
        var contenidoExtraido = '';
        try {
          if (ext === '.docx') { contenidoExtraido = (await mammoth.extractRawText({ path: file.path })).value || ''; }
          else if (ext === '.pdf') { contenidoExtraido = (await pdfParse(buffer)).text || ''; }
          else if (['.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm', '.rtf'].indexOf(ext) !== -1) { contenidoExtraido = fs.readFileSync(file.path, 'utf8'); }
          else if (ext === '.doc') { try { contenidoExtraido = fs.readFileSync(file.path, 'utf8').replace(/[^\x20-\x7E\n\ráéíóúüñÁÉÍÓÚÜÑ]/g, ' ').replace(/\s+/g, ' ').trim(); if (contenidoExtraido.length < 50) contenidoExtraido = '[Contenido .doc no legible automáticamente - convertí a .docx]'; } catch (e) { contenidoExtraido = '[Contenido .doc no legible automáticamente - convertí a .docx]'; } }
          else { contenidoExtraido = '[Contenido no legible automáticamente]'; }
        } catch (e) { log.warn('⚠️ [DOC] Error extrayendo texto de', file.originalname, e && e.message); contenidoExtraido = '[Error al leer archivo]'; }
        var MAX_CHARS = 20000;
        if (contenidoExtraido && contenidoExtraido.length > MAX_CHARS) { contenidoExtraido = contenidoExtraido.substring(0, MAX_CHARS) + '\n\n[... TRUNCADO ...]'; }
        var safeName = fileHash + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        var destPath = path.join(docsDir, safeName);
        fs.renameSync(file.path, destPath);
        var id = crypto.randomUUID();
        db.prepare(`INSERT INTO documentos (id, nombre, hash, contenido, path, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id, file.originalname, fileHash, contenidoExtraido, destPath, new Date().toISOString());
        log.info('📄 [DOC] Guardado:', safeName, 'chars:', (contenidoExtraido || '').length);
        resultados.push({ ok: true, reused: false, docId: id, nombre: file.originalname, tamaño: file.size, contenido: contenidoExtraido });
      } catch (fileErr) {
        log.error('❌ [DOC] Error procesando archivo', file && file.originalname, fileErr && fileErr.message);
        try { if (file && file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) { }
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

app.get('/api/private/documents', function (req, res) {
  try {
    try {
      var rows = db.prepare('SELECT id, nombre, created_at FROM documentos ORDER BY created_at DESC').all();
      return res.status(200).json({ ok: true, documentos: rows });
    } catch (dbErr) {
      log.warn('⚠️ [DOCS] No se pudo leer tabla documentos, listando desde filesystem:', dbErr && dbErr.message);
      var d = [];
      fs.readdirSync(docsDir).forEach(f => { try { var s = fs.statSync(path.join(docsDir, f)); if (s.isFile()) d.push({ nombre: f, tamaño: s.size }); } catch (e) { } });
      return res.status(200).json({ ok: true, documentos: d });
    }
  } catch (err) {
    log.error('❌ Error listando documentos:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Error al leer documentos' });
  }
});

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
      return res.status(400).json({ ok: false, error: 'El documento no tiene contenido legible extraído. Probá subirlo en formato .pdf, .docx o .txt' });
    }

    var MAX_CHARS_DOCUMENTO = 45000;
    if (texto.length > MAX_CHARS_DOCUMENTO) {
      log.warn(`⚠️ [ASK-DOC] Documento muy largo (${texto.length} chars). Truncando a ${MAX_CHARS_DOCUMENTO}.`);
      texto = truncarTextoInteligente(texto, MAX_CHARS_DOCUMENTO);
    }

    var prompt = 'Eres un asistente experto. Usa EXACTAMENTE el siguiente documento para responder. Si la respuesta no está en el documento, decilo claramente.\n\nDOCUMENTO:\n' + texto + '\n\nPREGUNTA:\n' + pregunta + '\n\nRESPONDE SOLO BASADO EN EL DOCUMENTO.';

    var estimatedTokens = Math.ceil(prompt.length / 3);
    var numCtx = Math.min(Math.max(estimatedTokens + 1024, 4096), 32768);
    numCtx = validarYAdjustarNumCtx('qwen2.5:14b', numCtx);

    let respuesta;
    try {
      respuesta = await usarGroq(prompt, 'llama-3.3-70b-versatile', { temperature: 0.0, max_tokens: 2048 });
    } catch (e) {
      log.warn('Groq falló, usando modelo local Ollama:', e.message);
      respuesta = await usarModelo('resumen', prompt, { num_ctx: numCtx, temperature: 0.0 });
    }

    return res.status(200).json({ ok: true, respuesta });
  } catch (err) {
    log.error('❌ Error en /api/private/ask-doc:', err && err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' });
  }
});

// ============================================================================
// INICIO DEL SERVIDOR
// ============================================================================
app.listen(PORT, () => {
  log.info(`🚀 ApiPrivada escuchando en http://localhost:${PORT}`);
});

module.exports = app;