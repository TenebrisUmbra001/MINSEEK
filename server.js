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
// CORS — PRIMERO QUE TODO
// ============================================================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Expose-Headers', 'X-Model-Source');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// ============================================================================
// MIDDLEWARES
// ============================================================================
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Demasiados intentos.', standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'Demasiadas solicitudes.', standardHeaders: true, legacyHeaders: false });
var uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Demasiadas subidas.', standardHeaders: true, legacyHeaders: false });

var uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
var uploadUserPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'InicioSesion', 'index.html')));

const DOMINIO_ZIMBRA = 'mail.das.pdr';
function validarEmailZimbra(email) { const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; if (!e.test(email)) return { valid: false, error: 'Formato inválido' }; if (!email.endsWith(`@${DOMINIO_ZIMBRA}`)) return { valid: false, error: `Debe terminar en @${DOMINIO_ZIMBRA}` }; if (!/^[a-zA-Z0-9._-]+$/.test(email.split('@')[0])) return { valid: false, error: 'Caracteres inválidos' }; return { valid: true }; }

async function forwardToPrivate(path, body, options = {}) {
  const maxRetries = options.maxRetries ?? 2; const baseDelay = options.baseDelay ?? 300; let attempt = 0;
  while (true) { attempt++; const c = new AbortController(); const t = setTimeout(() => c.abort(), options.timeoutMs ?? 90000); try { const r = await fetch(`${PRIVATE_API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(PRIVATE_API_TOKEN ? { 'Authorization': `Bearer ${PRIVATE_API_TOKEN}` } : {}) }, signal: c.signal, body: JSON.stringify(body) }); clearTimeout(t); const txt = await r.text(); let p; try { p = JSON.parse(txt); } catch { p = txt; } return { status: r.status, body: p }; } catch (err) { clearTimeout(t); if (attempt > maxRetries) throw err; await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100))); } }
}

async function forwardGetToPrivate(path, options = {}) {
  const maxRetries = options.maxRetries ?? 2; const baseDelay = options.baseDelay ?? 300; let attempt = 0;
  while (true) { attempt++; const c = new AbortController(); const t = setTimeout(() => c.abort(), options.timeoutMs ?? 30000); try { const r = await fetch(`${PRIVATE_API_URL}${path}`, { method: 'GET', headers: { ...(PRIVATE_API_TOKEN ? { 'Authorization': `Bearer ${PRIVATE_API_TOKEN}` } : {}) }, signal: c.signal }); clearTimeout(t); const txt = await r.text(); let p; try { p = JSON.parse(txt); } catch { p = txt; } return { status: r.status, body: p }; } catch (err) { clearTimeout(t); if (attempt > maxRetries) throw err; await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100))); } }
}

// ============================================================================
// RUTAS DE AUTENTICACIÓN
// ============================================================================

app.post('/api/registro', authLimiter, async (req, res) => {
  try {
    const { usuario, correo, contrasena } = req.body;
    if (!usuario || !correo || !contrasena) return res.status(400).json({ error: 'Campos requeridos' });
    const v = validarEmailZimbra(correo);
    if (!v.valid) return res.status(400).json({ error: v.error });
    const result = await forwardToPrivate('/auth/register', { usuario, correo, contrasena });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

app.post('/api/generar-codigo', authLimiter, async (req, res) => {
  try {
    const { idUsuario } = req.body;
    if (!idUsuario) return res.status(400).json({ error: 'idUsuario requerido' });
    const result = await forwardToPrivate('/auth/generar-codigo', { idUsuario });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

app.post('/api/validar-codigo', authLimiter, async (req, res) => {
  try {
    const { idUsuario, codigo } = req.body;
    if (!idUsuario || !codigo) return res.status(400).json({ error: 'Parámetros requeridos' });
    const result = await forwardToPrivate('/auth/validar-codigo', { idUsuario, codigo });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { usuario, contrasena } = req.body;
    if (!usuario || !contrasena) return res.status(400).json({ error: 'Requeridos' });
    const result = await forwardToPrivate('/auth/login', { usuario, contrasena });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const { idConexion, idUsuario } = req.body;
    if (!idConexion) return res.status(400).json({ error: 'idConexion requerido' });
    const result = await forwardToPrivate('/auth/logout', { idConexion, idUsuario });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

app.get('/api/usuario/:idUsuario', async (req, res) => {
  try {
    const result = await forwardGetToPrivate(`/auth/usuario/${req.params.idUsuario}`);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

app.post('/api/usuario/actualizar', uploadUserPhoto.single('foto'), async (req, res) => {
  try {
    const { idUsuario, nombreVisible, contrasena, contrasenaActual } = req.body;
    if (!idUsuario) return res.status(400).json({ exitoso: false, error: 'idUsuario requerido' });

    var form = new FormData();
    form.append('idUsuario', idUsuario);
    if (nombreVisible !== undefined) form.append('nombreVisible', nombreVisible);
    if (contrasena) form.append('contrasena', contrasena);
    if (contrasenaActual) form.append('contrasenaActual', contrasenaActual);
    if (req.file) {
      form.append('foto', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });
    }

    var headers = form.getHeaders();
    if (PRIVATE_API_TOKEN) headers['Authorization'] = 'Bearer ' + PRIVATE_API_TOKEN;

    var response = await fetch(PRIVATE_API_URL + '/auth/actualizar-usuario', {
      method: 'POST',
      headers: headers,
      body: form.getBuffer()
    });

    var result;
    try {
      var text = await response.text();
      result = JSON.parse(text);
    } catch (e) {
      result = { exitoso: false, error: 'Respuesta inválida de la API' };
    }

    if (result.exitoso && result.usuario && result.usuario.FotoPerfilPath) {
      result.fotoUrl = '/api/usuario-foto/' + idUsuario;
    }

    return res.status(response.status).json(result);
  } catch (error) {
    console.error('Error proxy actualizar usuario:', error.message);
    return res.status(502).json({ exitoso: false, error: 'Error de conexión al actualizar' });
  }
});

app.get('/api/usuario-foto/:idUsuario', async (req, res) => {
  try {
    var headers = {};
    if (PRIVATE_API_TOKEN) headers['Authorization'] = 'Bearer ' + PRIVATE_API_TOKEN;

    var response = await fetch(PRIVATE_API_URL + '/auth/usuario-foto/' + req.params.idUsuario, { headers: headers });

    if (!response.ok) return res.status(404).send('Foto no encontrada');

    var contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    var reader = response.body.getReader();
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      res.write(chunk.value);
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) return res.status(502).send('Error');
    res.end();
  }
});

app.get('/api/historial/:idUsuario', async (req, res) => {
  try {
    const limite = req.query.limite || 20;
    const result = await forwardGetToPrivate(`/auth/historial/${req.params.idUsuario}?limite=${limite}`);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

// ============================================================================
// RUTAS DE CHAT Y EJECUCIÓN
// ============================================================================

app.post('/public/execute', async (req, res) => {
  try {
    const { prompt } = req.body;
    const result = await forwardToPrivate('/api/private/execute', { prompt: prompt.toString().trim().slice(0, 20000) }, { maxRetries: 2, timeoutMs: 120000 });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error' });
  }
});

app.post('/api/chat', chatLimiter, async (req, res) => {
  try {
    const response = await fetch(`${PRIVATE_API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(PRIVATE_API_TOKEN ? { 'Authorization': `Bearer ${PRIVATE_API_TOKEN}` } : {}) },
      body: JSON.stringify(req.body)
    });
    if (!response.ok) {
      // Pasar el código de sesión expirada al frontend
      if (response.status === 401) {
        return res.status(401).json({ error: 'Sesión expirada por inactividad', codigo: 'SESION_EXPIRADA' });
      }
      return res.status(response.status).json({ error: 'Error API Privada' });
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
    res.end();
  } catch (error) {
    return res.status(502).json({ error: 'Error' });
  }
});

// ============================================================================
// RUTAS - SUBIDA MÚLTIPLE
// ============================================================================
app.post('/api/upload', uploadLimiter, uploadMemory.array('archivos', 10), function (req, res) {
  if (!req.files || req.files.length === 0) return res.status(400).json({ ok: false, error: 'No se recibieron archivos' });

  var form = new FormData();
  for (var i = 0; i < req.files.length; i++) {
    form.append('archivos', req.files[i].buffer, { filename: req.files[i].originalname, contentType: req.files[i].mimetype });
  }

  var headers = form.getHeaders();
  if (PRIVATE_API_TOKEN) headers['Authorization'] = 'Bearer ' + PRIVATE_API_TOKEN;

  fetch(PRIVATE_API_URL + '/api/private/upload', { method: 'POST', headers: headers, body: form.getBuffer() })
    .then(function (response) { return response.text().then(function (text) { var p; try { p = JSON.parse(text); } catch (e) { p = { ok: false, error: text }; } return { status: response.status, body: p }; }); })
    .then(function (result) { return res.status(result.status).json(result.body); })
    .catch(function (error) { console.error('Error proxy upload:', error.message); return res.status(502).json({ ok: false, error: 'Error al conectar' }); });
});

app.get('/api/documents', function (req, res) {
  var h = {};
  if (PRIVATE_API_TOKEN) h['Authorization'] = 'Bearer ' + PRIVATE_API_TOKEN;
  fetch(PRIVATE_API_URL + '/api/private/documents', { headers: h })
    .then(r => r.text().then(t => { var p; try { p = JSON.parse(t); } catch (e) { p = { ok: false }; } return { status: r.status, body: p }; }))
    .then(r => res.status(r.status).json(r.body))
    .catch(() => res.status(502).json({ error: 'Error' }));
});

app.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.get('/api/usuarios', async (req, res) => {
  try {
    const result = await forwardGetToPrivate('/auth/usuarios');
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

app.post('/api/admin/actualizar-usuario', async (req, res) => {
  try {
    const { idUsuario, nombreVisible, contrasena } = req.body;
    if (!idUsuario) return res.status(400).json({ exitoso: false, error: 'idUsuario requerido' });
    const result = await forwardToPrivate('/auth/admin/actualizar-usuario', { idUsuario, nombreVisible, contrasena });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

app.post('/api/admin/eliminar-usuario', async (req, res) => {
  try {
    const { idUsuario } = req.body;
    if (!idUsuario) return res.status(400).json({ exitoso: false, error: 'idUsuario requerido' });
    const result = await forwardToPrivate('/auth/admin/eliminar-usuario', { idUsuario });
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(502).json({ error: 'Error servidor' });
  }
});

// ============================================================================
// RECUPERACIÓN DE CONTRASEÑA
// ============================================================================

app.post('/api/recuperar-password', authLimiter, async (req, res) => {
  try {
    const { correo } = req.body;
    if (!correo) return res.status(400).json({ exitoso: false, error: 'Correo requerido' });
    const v = validarEmailZimbra(correo);
    if (!v.valid) return res.status(400).json({ exitoso: false, error: v.error });
    const result = await forwardToPrivate('/auth/recuperar-password', { correo });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Error en /api/recuperar-password:', error.message);
    return res.status(502).json({ exitoso: false, error: 'Error del servidor' });
  }
});

app.post('/api/restablecer-password', authLimiter, async (req, res) => {
  try {
    const { idUsuario, codigo, nuevaContrasena } = req.body;
    if (!idUsuario || !codigo || !nuevaContrasena) {
      return res.status(400).json({ exitoso: false, error: 'Todos los campos son requeridos' });
    }
    const result = await forwardToPrivate('/auth/restablecer-password', { idUsuario, codigo, nuevaContrasena });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Error en /api/restablecer-password:', error.message);
    return res.status(502).json({ exitoso: false, error: 'Error del servidor' });
  }
});

app.get('/recuperar-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'RecuperarPassword', 'index.html'));
});

// ============================================================================
// PROXY - CONVERSACIONES
// ============================================================================

app.post('/api/conversaciones/crear', function (req, res) {
  forwardToPrivate('/auth/conversaciones/crear', req.body)
    .then(function (result) { return res.status(result.status).json(result.body); })
    .catch(function () { return res.status(502).json({ exitoso: false, error: 'Error servidor' }); });
});

app.post('/api/conversaciones/:id/guardar', function (req, res) {
  forwardToPrivate('/auth/conversaciones/' + req.params.id + '/guardar', req.body)
    .then(function (result) { return res.status(result.status).json(result.body); })
    .catch(function () { return res.status(502).json({ exitoso: false, error: 'Error servidor' }); });
});

app.get('/api/conversaciones/:idUsuario', function (req, res) {
  forwardGetToPrivate('/auth/conversaciones/' + req.params.idUsuario)
    .then(function (result) { return res.status(result.status).json(result.body); })
    .catch(function () { return res.status(502).json({ exitoso: false, error: 'Error servidor' }); });
});

app.get('/api/conversacion/:id', function (req, res) {
  var idUsuario = req.query.idUsuario;
  if (!idUsuario) return res.status(400).json({ exitoso: false, error: 'idUsuario requerido' });
  forwardGetToPrivate('/auth/conversacion/' + req.params.id + '?idUsuario=' + encodeURIComponent(idUsuario))
    .then(function (result) { return res.status(result.status).json(result.body); })
    .catch(function () { return res.status(502).json({ exitoso: false, error: 'Error servidor' }); });
});

app.post('/api/conversacion/:id/titulo', function (req, res) {
  forwardToPrivate('/auth/conversacion/' + req.params.id + '/titulo', req.body)
    .then(function (result) { return res.status(result.status).json(result.body); })
    .catch(function () { return res.status(502).json({ exitoso: false, error: 'Error servidor' }); });
});

app.post('/api/conversacion/:id/eliminar', function (req, res) {
  forwardToPrivate('/auth/conversacion/' + req.params.id + '/eliminar', req.body)
    .then(function (result) { return res.status(result.status).json(result.body); })
    .catch(function () { return res.status(502).json({ exitoso: false, error: 'Error servidor' }); });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================
app.use((err, req, res, next) => {
  if (!res.get('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  console.error('❌ [ERROR HANDLER]', err.message);
  res.status(err.status || 500).json({ exitoso: false, error: 'Error interno del servidor' });
});

app.listen(PORT, () => { console.log(`✅ API Pública corriendo en http://localhost:${PORT}`); });