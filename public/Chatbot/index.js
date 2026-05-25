/* ── DOM ── */
var sidebar = document.getElementById('sidebar');
var sidebarOverlay = document.getElementById('sidebarOverlay');
var sidebarScroll = document.getElementById('sidebarScroll');
var btnToggle = document.getElementById('btnToggle');
var iconToggle = document.getElementById('iconToggle');
var chatContainer = document.getElementById('chatContainer');
var userInput = document.getElementById('userInput');
var sendBtn = document.getElementById('sendBtn');
var fileInput = document.getElementById('fileInput');
var attachBtn = document.getElementById('attachBtn');
var filePreviewList = document.getElementById('filePreviewList');
var btnLogoutGear = document.getElementById('btnLogoutGear');

var selectedFiles = []; 
var MAX_FILE_SIZE = 50 * 1024 * 1024;
var MAX_FILES = 10;
var messages = [];
var isStreaming = false;
var sidebarOpen = true;
var currentConvId = null;
var currentDocContexts = []; 

function isMobile() { return window.innerWidth <= 768; }
var iconOpen = '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>';
var iconClosed = '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/>';
function updateToggleIcon() { iconToggle.innerHTML = sidebarOpen ? iconOpen : iconClosed; }

function toggleSidebar() { if (isMobile()) sidebar.classList.contains('open') ? closeSidebar() : openSidebar(); else { sidebarOpen = !sidebarOpen; sidebar.classList.toggle('collapsed', !sidebarOpen); updateToggleIcon(); } }
function openSidebar() { sidebar.classList.add('open'); sidebar.classList.remove('collapsed'); sidebarOverlay.style.display = 'block'; requestAnimationFrame(function() { sidebarOverlay.classList.add('visible'); }); sidebarOpen = true; updateToggleIcon(); }
function closeSidebar() { sidebar.classList.remove('open'); sidebarOverlay.classList.remove('visible'); setTimeout(function() { sidebarOverlay.style.display = 'none'; }, 300); if (!isMobile()) { sidebarOpen = false; sidebar.classList.add('collapsed'); } updateToggleIcon(); }

btnToggle.addEventListener('click', toggleSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);
function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

async function loadHistory() { sidebarScroll.innerHTML = ''; }
async function loadConversation(id) {}

function extractThink(text) { var m = text.match(/思索([\s\S]*?)<\/think>/i); return m ? m[1].trim() : ''; }
function removeThink(text) { return text.replace(/思索[\s\S]*?<\/think>/gi, '').trim(); }
function makeWelcome() { var d = document.createElement('div'); d.className = 'welcome-state'; d.id = 'welcomeState'; d.innerHTML = '<div class="welcome-icon"><img draggable="false" src="../Assets/LOGO IA CCR.png" alt=""></div><h2>Inicia una conversacion</h2><p>Escribe tu consulta abajo.</p>'; return d; }
function timeStr() { var n = new Date(); return String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0'); }
function formatFileSize(bytes) { if (bytes === 0) return '0 Bytes'; var k = 1024; var sizes = ['Bytes', 'KB', 'MB', 'GB']; var i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]; }

var docSvg = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

// NOMBRE UNIFICADO: 'archivos'
function uploadDocuments(files) {
  return new Promise(function (resolve, reject) {
    var formData = new FormData(); 
    for (var i = 0; i < files.length; i++) { formData.append('archivos', files[i]); }
    fetch('/api/upload', { method: 'POST', body: formData })
    .then(function (response) { return response.text().then(function (text) { var p; try { p = JSON.parse(text); } catch (e) { p = { ok: false, error: text }; } return { status: response.status, body: p }; }); })
    .then(function (result) { if (result.status >= 200 && result.status < 300 && result.body.ok) resolve(result.body); else reject(new Error((result.body && result.body.error) || 'Error en la subida')); })
    .catch(reject);
  });
}

attachBtn.addEventListener('click', function () { fileInput.click(); });
fileInput.addEventListener('change', function () {
  if (fileInput.files && fileInput.files.length > 0) {
    for (var i = 0; i < fileInput.files.length; i++) {
      if (selectedFiles.length >= MAX_FILES) { window.alert('Máximo ' + MAX_FILES + ' archivos.'); break; }
      var file = fileInput.files[i];
      if (file.size > MAX_FILE_SIZE) { window.alert(file.name + ' excede 50MB.'); continue; }
      selectedFiles.push(file);
    }
    renderFilePreviews(); fileInput.value = '';
  }
});

function renderFilePreviews() {
  filePreviewList.innerHTML = '';
  if (selectedFiles.length === 0) return;
  for (var i = 0; i < selectedFiles.length; i++) {
    var file = selectedFiles[i]; var chip = document.createElement('div'); chip.className = 'file-chip';
    chip.innerHTML = '<span class="file-chip-name">' + esc(file.name) + '</span><span class="file-chip-size">' + formatFileSize(file.size) + '</span><button class="file-chip-remove" data-index="' + i + '"><svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    filePreviewList.appendChild(chip);
  }
  filePreviewList.querySelectorAll('.file-chip-remove').forEach(function(btn) { btn.addEventListener('click', function() { selectedFiles.splice(parseInt(btn.getAttribute('data-index')), 1); renderFilePreviews(); }); });
}

function clearSelectedFiles() { selectedFiles = []; fileInput.value = ''; filePreviewList.innerHTML = ''; }

/* ═══════════════════════════════════════
   USUARIO: Carga, Ajustes y Desconexión
   ═══════════════════════════════════════ */

var optionsBtn = document.getElementById('optionsBtn');
var optionsDropdown = document.getElementById('optionsDropdown');
var btnLogout = document.getElementById('btnLogout');
var btnAjustes = document.getElementById('btnAjustes');
var settingsModal = document.getElementById('settingsModal');
var closeModalBtn = document.getElementById('closeModalBtn');
var btnChangePhoto = document.getElementById('btnChangePhoto');
var modalFileAvatar = document.getElementById('modalFileAvatar');
var settingsForm = document.getElementById('settingsForm');

// Suponiendo que guardas idUsuario e idConexion en localStorage al hacer Login en InicioSesion/index.html
// Ejemplo que debes tener en tu login: localStorage.setItem('idUsuario', data.idUsuario); localStorage.setItem('idConexion', data.idConexion);
var currentUserId = localStorage.getItem('idUsuario') || null;
var currentConnectionId = localStorage.getItem('idConexion') || null;

// ── Cargar datos del usuario al iniciar ──
async function loadUserInfo() {
  var nameEl = document.getElementById('userName');
  var avatarEl = document.getElementById('userAvatar');
  var avatarDefault = document.getElementById('userAvatarDefault');

  if (!currentUserId) {
    nameEl.textContent = 'Usuario';
    return;
  }

  try {
    // Llamada a la ruta pública que redirige a /auth/usuario/:idUsuario
    var response = await fetch('/api/usuario/' + currentUserId);
    if (!response.ok) throw new Error('No autenticado');

    var result = await response.json();
    
    if (result.exitoso && result.usuario) {
      var u = result.usuario;
      nameEl.textContent = u.usuario || u.nombre || 'Usuario';
      
      // Rellenar modal
      document.getElementById('modalName').value = u.usuario || u.nombre || '';
      
      // Avatar
      if (u.foto || u.avatar) {
        var imgUrl = u.foto || u.avatar;
        avatarEl.src = imgUrl;
        avatarEl.style.display = 'block';
        avatarDefault.style.display = 'none';
        
        document.getElementById('modalAvatarPreview').src = imgUrl;
        document.getElementById('modalAvatarPreview').style.display = 'block';
        document.getElementById('modalAvatarDefault').style.display = 'none';
      }
    } else {
      nameEl.textContent = 'Usuario';
    }
  } catch (err) {
    nameEl.textContent = 'Usuario';
    console.warn('No se pudo cargar info del usuario:', err.message);
  }
}

// ── Toggle del menú de la rueda ──
if (optionsBtn) {
  optionsBtn.querySelector('svg').addEventListener('click', function (e) {
    e.stopPropagation();
    optionsDropdown.classList.toggle('open');
  });
}

document.addEventListener('click', function (e) {
  if (optionsDropdown && !optionsBtn.contains(e.target)) {
    optionsDropdown.classList.remove('open');
  }
});

// ── Modal de Ajustes ──
if (btnAjustes) {
  btnAjustes.addEventListener('click', function() {
    optionsDropdown.classList.remove('open');
    settingsModal.classList.add('open');
  });
}

if (closeModalBtn) {
  closeModalBtn.addEventListener('click', function() {
    settingsModal.classList.remove('open');
  });
}

settingsModal.addEventListener('click', function(e) {
  if (e.target === settingsModal) settingsModal.classList.remove('open');
});

// Cambiar foto
if (btnChangePhoto) {
  btnChangePhoto.addEventListener('click', function() { modalFileAvatar.click(); });
}
document.getElementById('avatarEditPreview').addEventListener('click', function() { modalFileAvatar.click(); });

modalFileAvatar.addEventListener('change', function() {
  if (modalFileAvatar.files && modalFileAvatar.files[0]) {
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('modalAvatarPreview').src = e.target.result;
      document.getElementById('modalAvatarPreview').style.display = 'block';
      document.getElementById('modalAvatarDefault').style.display = 'none';
    };
    reader.readAsDataURL(modalFileAvatar.files[0]);
  }
});

// Guardar Ajustes (Llama a un endpoint que DEBES crear en tu API)
settingsForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  var newName = document.getElementById('modalName').value.trim();
  var newPassword = document.getElementById('modalPassword').value;
  var fileInput = document.getElementById('modalFileAvatar');

  if (!currentUserId) return alert('Error: No hay sesión activa.');

  var formData = new FormData();
  formData.append('idUsuario', currentUserId);
  if (newName) formData.append('usuario', newName);
  if (newPassword) formData.append('contrasena', newPassword);
  if (fileInput.files[0]) formData.append('foto', fileInput.files[0]);

  try {
    // ⚠️ DEBES CREAR ESTA RUTA EN TU API PÚBLICA Y PRIVADA
    var response = await fetch('/api/usuario/actualizar', {
      method: 'POST',
      body: formData
    });
    
    var result = await response.json();
    if (response.ok && result.exitoso) {
      // Actualizar UI
      document.getElementById('userName').textContent = newName;
      if (result.fotoUrl) {
        document.getElementById('userAvatar').src = result.fotoUrl;
        document.getElementById('userAvatar').style.display = 'block';
        document.getElementById('userAvatarDefault').style.display = 'none';
      }
      document.getElementById('modalPassword').value = '';
      settingsModal.classList.remove('open');
    } else {
      alert(result.error || 'Error al guardar');
    }
  } catch (err) {
    alert('Error de conexión al guardar ajustes');
  }
});

// ── Desconectarse ──
async function logout() {
  optionsDropdown.classList.remove('open');

  var overlay = document.createElement('div');
  overlay.className = 'logout-overlay';
  overlay.innerHTML = '<div class="logout-box"><p>Desconectando...</p><div class="spinner"></div></div>';
  document.body.appendChild(overlay);

  try {
    if (!currentConnectionId) throw new Error('No hay idConexion');
    
    // Llama al endpoint de tu API Pública
    var response = await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idConexion: currentConnectionId })
    });

    if (response.ok) {
      localStorage.removeItem('idUsuario');
      localStorage.removeItem('idConexion');
      // Redirigir al inicio de sesión
      window.location.replace('/');
    } else {
      throw new Error('Error al desconectarse');
    }
  } catch (err) {
    console.error('Error en logout:', err);
    overlay.remove();
    var errDiv = document.createElement('div');
    errDiv.className = 'message error';
    errDiv.textContent = 'No se pudo cerrar sesión. Intenta de nuevo.';
    chatContainer.appendChild(errDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

if (btnLogout) {
  btnLogout.addEventListener('click', logout);
}

// ── Ejecutar al cargar ──
loadUserInfo();

/* ═══════════════════════════════════════
   CHAT: Envío y Streaming
   ═══════════════════════════════════════ */

async function sendMessage() {
  var text = userInput.value.trim();
  var hasFiles = selectedFiles.length > 0;
  if ((!text && !hasFiles) || isStreaming) return;

  var ws = document.getElementById('welcomeState'); if (ws) ws.remove();

  if (hasFiles) {
    var filesToSend = selectedFiles.slice(); clearSelectedFiles();
    var uploadDiv = document.createElement('div'); uploadDiv.className = 'message user doc-message';
    var filesHtml = '';
    for (var f = 0; f < filesToSend.length; f++) filesHtml += '<div class="doc-info" style="margin-bottom:4px"><div class="doc-name">' + esc(filesToSend[f].name) + '</div><div class="doc-size">' + formatFileSize(filesToSend[f].size) + '</div></div>';
    uploadDiv.innerHTML = '<div class="doc-icon-wrap">' + docSvg + '</div><div style="flex:1;min-width:0"><div class="doc-status uploading">Leyendo ' + filesToSend.length + ' documento(s)...</div>' + filesHtml + '</div>';
    chatContainer.appendChild(uploadDiv); chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
      var result = await uploadDocuments(filesToSend);
      var successHtml = '';
      if (result.archivos) { for (var a = 0; a < result.archivos.length; a++) { successHtml += '<div class="doc-info" style="margin-bottom:4px"><div class="doc-name">' + esc(result.archivos[a].nombre) + '</div><div class="doc-status success">✓ Leído</div></div>'; if (result.archivos[a].contenido) currentDocContexts.push(result.archivos[a].contenido); } }
      uploadDiv.innerHTML = '<div class="doc-icon-wrap">' + docSvg + '</div><div style="flex:1;min-width:0">' + successHtml + '</div><div class="msg-time">' + timeStr() + '</div>';
    } catch (err) { uploadDiv.className = 'message error doc-message'; uploadDiv.innerHTML = '<div class="doc-icon-wrap">' + docSvg + '</div><div class="doc-info"><div class="doc-status error">Error: ' + esc(err.message) + '</div></div>'; }
    chatContainer.scrollTop = chatContainer.scrollHeight;
    if (!text) { userInput.focus(); return; }
  }

  var userDiv = document.createElement('div'); userDiv.className = 'message user';
  userDiv.innerHTML = esc(text) + '<div class="msg-time">' + timeStr() + '</div>';
  chatContainer.appendChild(userDiv); chatContainer.scrollTop = chatContainer.scrollHeight;

  var promptForAPI = text;
  if (currentDocContexts.length > 0) {
    promptForAPI = "[El usuario ha adjuntado " + currentDocContexts.length + " documento(s). A continuación se muestra el contenido extraído:\n---\n" + currentDocContexts.join('\n\n---\n\n') + "\n---\n]\n\nPregunta del usuario: " + text;
    currentDocContexts = [];
  }

  messages.push({ role: 'user', content: promptForAPI }); userInput.value = ''; sendBtn.disabled = true; isStreaming = true;
  var asstDiv = document.createElement('div'); asstDiv.className = 'message assistant'; asstDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  chatContainer.appendChild(asstDiv); chatContainer.scrollTop = chatContainer.scrollHeight; var fullContent = '';

  try {
    var body = { messages: messages }; if (currentConvId) body.conversation_id = currentConvId;
    var response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Error servidor');
    if (!response.body) throw new Error('No streaming');
    var reader = response.body.getReader(); var decoder = new TextDecoder(); var buffer = '';
    while (true) { var chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); var lines = buffer.split('\n'); buffer = lines.pop(); for (var i = 0; i < lines.length; i++) { var line = lines[i]; if (line.startsWith('data: ')) { var payload = line.substring(6); if (payload === '[DONE]') continue; try { var data = JSON.parse(payload); if (data.content) { fullContent += data.content; renderThinking(asstDiv, fullContent); chatContainer.scrollTop = chatContainer.scrollHeight; } } catch (e) {} } } }
  } catch (err) { asstDiv.className = 'message error'; asstDiv.innerHTML = 'Error: ' + esc(err.message); }
  if (fullContent) messages.push({ role: 'assistant', content: fullContent }); sendBtn.disabled = false; isStreaming = false; userInput.focus();
}

function renderThinking(div, full) { var tO = '思索', tC = ''; var depth = 0, lastEnd = 0, i = 0; while (i < full.length) { if (full.substring(i, i + tO.length) === tO) { depth++; i += tO.length; } else if (full.substring(i, i + tC.length) === tC && depth > 0) { depth--; lastEnd = i + tC.length; i += tC.length; } else i++; } var thinkPart = '', mainPart = ''; var completed = full.substring(0, lastEnd); var re = /思索([\s\S]*?)<\/think>/gi; var m; while ((m = re.exec(completed)) !== null) thinkPart += m[1]; var after = full.substring(lastEnd); if (depth > 0) thinkPart += after; else mainPart = after; var html = ''; if (thinkPart.trim()) html += '<div class="think-block">' + esc(thinkPart).replace(/\n/g, '<br>') + '</div>'; html += esc(mainPart).replace(/\n/g, '<br>'); if (!mainPart.trim() && !thinkPart.trim()) html = '<div class="typing-indicator"><span></span><span></span><span></span></div>'; if (mainPart.trim()) html += '<div class="msg-time">' + timeStr() + '</div>'; div.innerHTML = html; }

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
window.addEventListener('resize', function() { if (!isMobile()) { sidebar.classList.remove('open'); sidebarOverlay.style.display = 'none'; sidebarOverlay.classList.remove('visible'); sidebar.classList.toggle('collapsed', !sidebarOpen); updateToggleIcon(); } else sidebar.classList.remove('collapsed'); });

// ── Inicialización ──
loadHistory(); 
loadUserInfo(); 
userInput.focus();