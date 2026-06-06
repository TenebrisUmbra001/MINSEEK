// Backend/ApiPrivada.js
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mammoth = require('mammoth');

// ❌ ELIMINADO: const pdfParse = require('pdf-parse');
// ✅ NUEVO: Importar tu módulo custom que evita el bug y usa renderPage
const { extraerTextoPDF } = require('./pdfHandler');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 6969;

// ============================================================================
// Model manager centralizado
// ============================================================================
const modelManager = require('./modelManager');
const {
  usarModelo,
  usarGroq,
  usarModeloInteligente,
  obtenerYAdquirirModelo,
  cerrarModelo,
  calcularNumCtx,
  validarYAdjustarNumCtx,
  modelLimiters,
  categorizar,
  verificarInternetYGroq,
  precalentarModelos,
  obtenerEstado,
  MODELOS_CALIENTES,
  MODELOS_FRIOS,
  KEEP_ALIVE_CALIENTE,
  KEEP_ALIVE_FRIO,
  OLLAMA_BASE,
  GROQ_API_BASE,
  GROQ_API_KEY
} = modelManager;

const log = modelManager.log;

const { enviarCodigoVerificacion, enviarCodigoRecuperacion } = require('./emailService');

// ============================================================================
// CORS — DEBE SER LO PRIMERO, ANTES QUE CUALQUIER OTRA COSA
// Firefox bloquea si los headers CORS no están en el orden correcto
// y si no aparecen TAMBIÉN en respuestas de error (401, 404, 500)
// ============================================================================
app.use((req, res, next) => {
  // 1️⃣ Origen permitido — NUNCA * con credentials
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:2054');
  
  // 2️⃣ Métodos permitidos
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  // 3️⃣ Headers permitidos en la petición
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // 4️⃣ Permitir credenciales (cookies, auth headers)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // 5️⃣ Cache de preflight (Firefox exige esto para no re-preflightear cada 5 min)
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // 6️⃣ Headers expuestos al frontend (para leer X-Model-Source, etc.)
  res.setHeader('Access-Control-Expose-Headers', 'X-Model-Source, X-Request-Id');

  // ✅ Responder preflight INMEDIATAMENTE sin pasar por más middleware
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

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
  limits: { fileSize: 5 * 1024 * 1024 },
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
const moduloUser = require('./moduloUser');

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
// ENDPOINTS BÁSICOS
// ============================================================================

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

// Estado del sistema de modelos en tiempo real
app.get('/api/status', (req, res) => {
  res.json({ ok: true, ...obtenerEstado() });
});

// ============================================================================
// EJECUCIÓN DIRECTA (no-streaming)
// ============================================================================
app.post('/api/private/execute', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ ok: false, error: 'Falta prompt' });

    const categoria = await categorizar(prompt);
    log.info(`📤 [EXECUTE] "${prompt.substring(0, 60)}..." → ${categoria}`);

    const respuesta = await usarModeloInteligente(categoria, prompt);
    return res.status(200).json({ ok: true, categoria, respuesta });
  } catch (error) {
    log.error('❌ Error en /api/private/execute:', error.message);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ============================================================================
// RUTA /chat — STREAMING CORREGIDO
// ============================================================================
app.post('/chat', async (req, res) => {
  let modeloEnUso = null;
  let limiterEnUso = null;

  try {
    const { messages } = req.body;
    if (!messages) return res.status(400).json({ error: 'Inválido' });

    const ultimoMensaje = messages.filter(m => m.role === 'user').pop();
    const prompt = ultimoMensaje ? ultimoMensaje.content : '';
    var totalContent = messages.map(m => m.content || '').join('');

    var categoria = await categorizar(prompt);
    log.info(`📂 [STREAM] Categoría: ${categoria} | chars: ${totalContent.length}`);

    var LIMITE_ABSOLUTO_CHARS = 50000;
    if (totalContent.length > LIMITE_ABSOLUTO_CHARS) {
      log.warn(`⚠️ [STREAM] Documento gigante (${totalContent.length} chars). Truncando a ${LIMITE_ABSOLUTO_CHARS}.`);
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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (categoria === 'razonamiento') {
      const groqDisponible = await verificarInternetYGroq();
      if (groqDisponible) {
        try {
          log.info('🌐 [STREAM] Intentando razonamiento profundo con Groq...');

          const groqRes = await fetch(`${GROQ_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'deepseek-r1-distill-llama-70b',
              messages: req.body.messages,
              stream: true,
              temperature: 0.6
            })
          });

          if (groqRes.ok) {
            log.info('✅ [STREAM] Conectado a Groq, streameando razonamiento profundo...');
            res.setHeader('X-Model-Source', 'groq');

            const reader = groqRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop();

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed === 'data: [DONE]') {
                  res.write('data: [DONE]\n\n');
                  continue;
                }
                if (trimmed.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(trimmed.substring(6));
                    const content = data.choices?.[0]?.delta?.content || '';
                    if (content) {
                      res.write(`data: ${JSON.stringify({ content })}\n\n`);
                    }
                  } catch (e) { /* ignore parse errors */ }
                }
              }
            }

            res.end();
            return; 
          } else {
            log.warn(`⚠️ [STREAM] Groq respondió ${groqRes.status}, fallback a Ollama`);
          }
        } catch (groqErr) {
          log.warn(`⚠️ [STREAM] Groq falló: ${groqErr.message}, fallback a Ollama`);
        }
      }
    }

    try {
      modeloEnUso = await obtenerYAdquirirModelo(categoria);
      limiterEnUso = modelLimiters[modeloEnUso];
      const esFrio = Object.values(MODELOS_FRIOS).includes(modeloEnUso);
      const keepAlive = esFrio ? KEEP_ALIVE_FRIO : KEEP_ALIVE_CALIENTE;

      var numCtx = calcularNumCtx(totalContent, 4096, 32768);
      numCtx = validarYAdjustarNumCtx(modeloEnUso, numCtx);

      res.setHeader('X-Model-Source', 'ollama');
      log.info(`🧠 [STREAM-OLLAMA] ${modeloEnUso} | cat: ${categoria} | ctx: ${numCtx}`);

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
            keep_alive: keepAlive,  
            options: { num_ctx: numCtx }
          })
        });

        clearTimeout(timeout);
        if (!response.ok) throw new Error('Error en stream de Ollama');

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
              if (chunk.done) res.write('data: [DONE]\n\n');
            } catch (e) { /* ignore parse errors */ }
          }
        }

        res.end();

      } catch (fetchErr) {
        clearTimeout(timeout);
        if (fetchErr.name === 'AbortError') {
          log.error(`⏱️ [STREAM] TIMEOUT de 15 min para ${modeloEnUso}.`);
          await cerrarModelo(modeloEnUso);  
          if (!res.headersSent) return res.status(504).json({ error: 'El modelo tardó demasiado. Intenta una pregunta más corta o un documento más pequeño.' });
          res.end();
        } else {
          await cerrarModelo(modeloEnUso);  
          throw fetchErr;
        }
      } finally {
        if (limiterEnUso) limiterEnUso.release();
      }

    } catch (modelErr) {
      if (limiterEnUso) limiterEnUso.release();
      throw modelErr;
    }

  } catch (error) {
    log.error('❌ Error en /chat:', error.message);
    if (!res.headersSent) return res.status(500).json({ error: 'Error en el servidor' });
    res.end();
  }
});

// ============================================================================
// RUTAS DE AUTENTICACIÓN
// ============================================================================

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

app.post('/auth/generar-codigo', async (req, res) => {
  try {
    const { idUsuario } = req.body;
    if (!idUsuario) { return res.status(400).json({ exitoso: false, error: 'idUsuario es requerido', codigo: 'CAMPO_FALTANTE' }); }

    const infoUser = moduloUser.obtenerInfoUsuario(idUsuario);
    if (!infoUser.exitoso || !infoUser.usuario.Correo) {
      return res.status(404).json({ exitoso: false, error: 'Usuario no encontrado o sin correo registrado' });
    }
    const correoDestino = infoUser.usuario.Correo;

    const resultado = moduloUser.generarCodigoValidacion(idUsuario);
    if (!resultado.exitoso) { return res.status(400).json(resultado); }

    const emailResult = await enviarCodigoVerificacion(correoDestino, resultado.codigo);
    
    if (!emailResult.exitoso) {
      log.error(`❌ [AUTH] Falló el envío de correo a ${correoDestino}. Ejecutando rollback de usuario...`);
      moduloUser.eliminarUsuarioPendiente(idUsuario);
      return res.status(500).json({ 
        exitoso: false, 
        error: 'No se pudo enviar el correo de verificación. Por favor, verifica que el correo sea correcto e intenta registrarte de nuevo.' 
      });
    }

    log.info(`📧 [AUTH] Código enviado por correo a: ${correoDestino}`);
    return res.status(200).json({ 
      exitoso: true, 
      mensaje: 'Código de verificación enviado a tu correo. Expira en 10 minutos.', 
      expiraEn: resultado.expiraEn
    });
  } catch (error) {
    log.error('❌ Error en /auth/generar-codigo:', error.message);
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
    const { idConexion, idUsuario } = req.body;
    if (!idConexion) { return res.status(400).json({ exitoso: false, error: 'idConexion es requerido', codigo: 'CAMPO_FALTANTE' }); }
    const resultado = moduloUser.cerrarSesion(idConexion);
    
    if (idUsuario) {
      db.prepare('UPDATE Usuario SET EstaConectado = 0 WHERE id = ?').run(idUsuario);
    }
    
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

app.get('/auth/usuarios', (req, res) => {
  const resultado = moduloUser.obtenerTodosLosUsuarios();
  if (!resultado.exitoso) return res.status(500).json(resultado);
  return res.status(200).json(resultado);
});

app.post('/auth/admin/actualizar-usuario', async (req, res) => {
  try {
    const { idUsuario, nombreVisible, contrasena } = req.body;
    const resultado = await moduloUser.actualizarUsuario(idUsuario, { nombreVisible, contrasena, esAdmin: true });
    if (!resultado.exitoso) return res.status(400).json(resultado);
    return res.status(200).json(resultado);
  } catch (error) {
    return res.status(500).json({ exitoso: false, error: 'Error del servidor' });
  }
});

app.post('/auth/admin/eliminar-usuario', (req, res) => {
  try {
    const { idUsuario } = req.body;
    const resultado = moduloUser.eliminarUsuario(idUsuario);
    if (!resultado.exitoso) return res.status(400).json(resultado);
    return res.status(200).json(resultado);
  } catch (error) {
    return res.status(500).json({ exitoso: false, error: 'Error del servidor' });
  }
});

// ============================================================================
// HEARTBEAT - El frontend envía un ping cada 5 min para mantener la sesión activa
// ============================================================================
app.post('/auth/heartbeat', (req, res) => {
  try {
    const { idUsuario } = req.body;
    if (!idUsuario) {
      return res.status(400).json({ exitoso: false, error: 'idUsuario requerido' });
    }

    const usuario = db.prepare('SELECT id, EstaConectado FROM Usuario WHERE id = ?').get(idUsuario);
    if (!usuario) {
      return res.status(404).json({ exitoso: false, error: 'Usuario no encontrado', sesionActiva: false });
    }

    if (!usuario.EstaConectado) {
      return res.status(401).json({ 
        exitoso: false, 
        error: 'Sesión expirada por inactividad', 
        sesionActiva: false,
        codigo: 'SESION_EXPIRADA'
      });
    }

    const actualizado = moduloUser.actualizarActividad(idUsuario);
    
    return res.status(200).json({ 
      exitoso: true, 
      activo: actualizado,
      sesionActiva: true
    });
  } catch (error) {
    log.error('❌ Error en /auth/heartbeat:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error del servidor' });
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
          // ✅ FIX: Usar pdfHandler en lugar de pdf-parse directamente
          else if (ext === '.pdf') {
            const pdfResult = await extraerTextoPDF(buffer, file.originalname);
            contenidoExtraido = pdfResult.text || '';
            if (pdfResult.warning) {
              log.warn(`⚠️ [DOC] PDF ${file.originalname}: ${pdfResult.warning}`);
            }
          }
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
    
    if (!texto || texto.length === 0) {
      return res.status(400).json({ 
        ok: false, 
        error: 'El documento está vacío. Puede que el PDF sea un escaneo (imagen sin texto seleccionable). Probá subirlo en formato .docx o .txt.' 
      });
    }
    
    if (texto.startsWith('[PDF escaneado')) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Este PDF es un escaneo (imagen sin texto seleccionable). No se puede consultar automáticamente. Probá: 1) Usar un PDF con texto seleccionable, 2) Convertir a .docx, 3) Copiar el texto a un .txt' 
      });
    }
    
    if (texto.startsWith('[Contenido no legible') || texto.startsWith('[Error al leer') || texto.startsWith('[Contenido .doc no legible')) {
      return res.status(400).json({ 
        ok: false, 
        error: 'El documento no tiene contenido legible extraído. Probá subirlo en formato .pdf con texto seleccionable, .docx o .txt' 
      });
    }

    var MAX_CHARS_DOCUMENTO = 45000;
    if (texto.length > MAX_CHARS_DOCUMENTO) {
      log.warn(`⚠️ [ASK-DOC] Documento muy largo (${texto.length} chars). Truncando a ${MAX_CHARS_DOCUMENTO}.`);
      texto = truncarTextoInteligente(texto, MAX_CHARS_DOCUMENTO);
    }

    var prompt = 'Eres un asistente experto. Usa EXACTAMENTE el siguiente documento para responder. Si la respuesta no está en el documento, decilo claramente.\n\nDOCUMENTO:\n' + texto + '\n\nPREGUNTA:\n' + pregunta + '\n\nRESPONDE SOLO BASADO EN EL DOCUMENTO.';

    var respuesta = await usarModelo('resumen', prompt, { temperature: 0.0 });

    return res.status(200).json({ ok: true, respuesta });
  } catch (err) {
    log.error('❌ Error en /api/private/ask-doc:', err && err.message);
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' });
  }
});

// ============================================================================
// RECUPERACIÓN DE CONTRASEÑA
// ============================================================================

const recoveryCodes = new Map();

setInterval(() => {
  const ahora = Date.now();
  for (const [id, data] of recoveryCodes) {
    if (ahora > data.expiry) recoveryCodes.delete(id);
  }
}, 5 * 60 * 1000);

app.post('/auth/recuperar-password', async (req, res) => {
  try {
    const { correo } = req.body;
    if (!correo) {
      return res.status(400).json({ exitoso: false, error: 'Correo requerido' });
    }

    const usuario = db.prepare('SELECT id, NombreUsuario, Correo FROM Usuario WHERE Correo = ?').get(correo);
    if (!usuario) {
      return res.status(404).json({ exitoso: false, error: 'No existe una cuenta asociada a ese correo' });
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const expiry = Date.now() + 10 * 60 * 1000; 

    recoveryCodes.set(usuario.id, { codigo, expiry, intentos: 0 });

    const emailResult = await enviarCodigoRecuperacion(usuario.Correo, codigo);
    if (!emailResult.exitoso) {
      log.error(`❌ [RECOVERY] Falló envío de correo a ${usuario.Correo}`);
      return res.status(500).json({ exitoso: false, error: 'No se pudo enviar el correo de recuperación. Intenta más tarde.' });
    }

    log.info(`📧 [RECOVERY] Código de recuperación enviado a: ${usuario.Correo}`);
    return res.status(200).json({
      exitoso: true,
      mensaje: 'Código de recuperación enviado a tu correo. Expira en 10 minutos.',
      idUsuario: usuario.id
    });
  } catch (error) {
    log.error('❌ Error en /auth/recuperar-password:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error del servidor' });
  }
});

app.post('/auth/restablecer-password', async (req, res) => {
  try {
    const { idUsuario, codigo, nuevaContrasena } = req.body;

    if (!idUsuario || !codigo || !nuevaContrasena) {
      return res.status(400).json({ exitoso: false, error: 'Todos los campos son requeridos' });
    }

    if (nuevaContrasena.length < 6) {
      return res.status(400).json({ exitoso: false, error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const usuario = db.prepare('SELECT id, NombreUsuario FROM Usuario WHERE id = ?').get(idUsuario);
    if (!usuario) {
      return res.status(404).json({ exitoso: false, error: 'Usuario no encontrado' });
    }

    const recoveryData = recoveryCodes.get(idUsuario);
    if (!recoveryData) {
      return res.status(400).json({ exitoso: false, error: 'No se solicitó recuperación para este usuario. Ingresa tu correo primero.' });
    }

    if (Date.now() > recoveryData.expiry) {
      recoveryCodes.delete(idUsuario);
      return res.status(400).json({ exitoso: false, error: 'El código ha expirado. Solicita uno nuevo.' });
    }

    recoveryData.intentos++;
    if (recoveryData.intentos > 5) {
      recoveryCodes.delete(idUsuario);
      return res.status(429).json({ exitoso: false, error: 'Demasiados intentos incorrectos. Solicita un código nuevo.' });
    }

    if (recoveryData.codigo !== codigo) {
      return res.status(400).json({ exitoso: false, error: `Código incorrecto. Intentos restantes: ${5 - recoveryData.intentos}` });
    }

    const resultado = await moduloUser.actualizarUsuario(idUsuario, {
      contrasena: nuevaContrasena,
      esAdmin: true
    });

    if (!resultado.exitoso) {
      log.error(`❌ [RECOVERY] Error al actualizar contraseña para ${idUsuario}: ${resultado.error}`);
      return res.status(400).json({ exitoso: false, error: resultado.error || 'No se pudo actualizar la contraseña' });
    }

    recoveryCodes.delete(idUsuario);

    log.info(`✅ [RECOVERY] Contraseña restablecida exitosamente para: ${usuario.NombreUsuario}`);
    return res.status(200).json({ exitoso: true, mensaje: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    log.error('❌ Error en /auth/restablecer-password:', error.message);
    return res.status(500).json({ exitoso: false, error: 'Error del servidor' });
  }
});

// ============================================================================
// INTERVALOS DE LIMPIEZA Y MANTENIMIENTO
// ============================================================================

setInterval(() => {
  moduloUser.desconectarUsuariosInactivos(45);
}, 5 * 60 * 1000);

setTimeout(() => {
  moduloUser.desconectarUsuariosInactivos(45);
}, 10000);

// ============================================================================
// ERROR HANDLER — Debe conservar headers CORS en respuestas de error
// ============================================================================
app.use((err, req, res, next) => {
  if (!res.get('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:2054');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  log.error('❌ [ERROR HANDLER]', err.message);
  
  res.status(err.status || 500).json({
    exitoso: false,
    error: 'Error interno del servidor',
    codigo: 'ERROR_SERVIDOR'
  });
});

// ============================================================================
// INICIO DEL SERVIDOR CON PRECALENTAMIENTO
// ============================================================================
app.listen(PORT, async () => {
  log.info(`🚀 ApiPrivada escuchando en http://localhost:${PORT}`);
  
  await precalentarModelos();
  
  log.info(`📊 Estado: ${JSON.stringify(obtenerEstado())}`);
});

module.exports = app;