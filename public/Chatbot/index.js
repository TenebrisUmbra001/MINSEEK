/* ── Protección: Verificar que hay sesión activa ── */
(function verificarSesion() {
  var idUsuario = sessionStorage.getItem('idUsuario');
  var idConexion = sessionStorage.getItem('idConexion');
  if (!idUsuario || !idConexion) {
    window.location.replace('/');
    return;
  }
})();

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

// ✅ sessionStorage — se borra al cerrar la pestaña
var currentUserId = sessionStorage.getItem('idUsuario') || null;
var currentConnectionId = sessionStorage.getItem('idConexion') || null;

// ✅ Helper: obtener ID del usuario
function getUserId() {
  return sessionStorage.getItem('idUsuario') || currentUserId;
}

// ── Cargar datos del usuario al iniciar ──
async function loadUserInfo() {
  var nameEl = document.getElementById('userName');
  var avatarEl = document.getElementById('userAvatar');
  var avatarDefault = document.getElementById('userAvatarDefault');

  var userId = getUserId();

  if (!userId) {
    nameEl.textContent = 'Usuario';
    return;
  }

  if (!currentUserId) currentUserId = userId;

  try {
    var response = await fetch('/api/usuario/' + userId);
    if (!response.ok) throw new Error('No autenticado');

    var result = await response.json();

    if (result.exitoso && result.usuario) {
      var u = result.usuario;

      // Guardar idUsuario en sessionStorage por si no estaba
      if (u.id && !sessionStorage.getItem('idUsuario')) {
        sessionStorage.setItem('idUsuario', u.id);
        currentUserId = u.id;
      }

      // Usar NombreVisible, con fallback a NombreUsuario
      var displayName = (u.NombreVisible && u.NombreVisible !== 'Usuario')
        ? u.NombreVisible
        : u.NombreUsuario || 'Usuario';
      nameEl.textContent = displayName;

      // Rellenar modal
      document.getElementById('modalNombreVisible').value = u.NombreVisible || '';

      // Guardar NombreUsuario en un data-attr para el botón reset
      var nombreVisibleInput = document.getElementById('modalNombreVisible');
      if (u.NombreUsuario) {
        nombreVisibleInput.setAttribute('data-username', u.NombreUsuario);
      }

      // Avatar
      if (u.FotoPerfilPath) {
        var imgUrl = '/api/usuario-foto/' + userId + '?t=' + Date.now();

        avatarEl.src = imgUrl;
        avatarEl.style.display = 'block';
        avatarDefault.style.display = 'none';
        avatarEl.onerror = function () {
          avatarEl.style.display = 'none';
          avatarDefault.style.display = 'block';
        };

        document.getElementById('modalAvatarPreview').src = imgUrl;
        document.getElementById('modalAvatarPreview').style.display = 'block';
        document.getElementById('modalAvatarDefault').style.display = 'none';
        document.getElementById('modalAvatarPreview').onerror = function () {
          document.getElementById('modalAvatarPreview').style.display = 'none';
          document.getElementById('modalAvatarDefault').style.display = 'block';
        };
      } else {
        avatarEl.style.display = 'none';
        avatarDefault.style.display = 'block';
        document.getElementById('modalAvatarPreview').style.display = 'none';
        document.getElementById('modalAvatarDefault').style.display = 'block';
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

// ✅ IR AL PANEL DE ADMINISTRACIÓN (AÑADIDO AQUÍ)
var btnAdminPanel = document.getElementById('btnAdminPanel');
if (btnAdminPanel) {
  btnAdminPanel.addEventListener('click', function () {
    optionsDropdown.classList.remove('open');
    // Abre el panel en una nueva pestaña para no perder la sesión del chat
    window.open('/AdminPanel/index.html', '_blank');
  });
}

// ── Modal de Ajustes ──
if (btnAjustes) {
  btnAjustes.addEventListener('click', function () {
    optionsDropdown.classList.remove('open');
    // Resetear sección de contraseña
    var passFields = document.getElementById('passwordSectionFields');
    var passToggle = document.getElementById('btnPasswordSection');
    if (passFields) { passFields.classList.remove('open'); }
    if (passToggle) { passToggle.classList.remove('active'); }
    // Limpiar campos de contraseña
    var cp = document.getElementById('modalCurrentPassword');
    var np = document.getElementById('modalNewPassword');
    var cnp = document.getElementById('modalConfirmPassword');
    if (cp) cp.value = '';
    if (np) { np.value = ''; np.disabled = true; }
    if (cnp) { cnp.value = ''; cnp.disabled = true; }
    var matchHint = document.getElementById('passwordMatchHint');
    if (matchHint) { matchHint.textContent = ''; matchHint.className = 'form-hint'; }
    // Refrescar datos
    loadUserInfo();
    settingsModal.classList.add('open');
  });
}

if (closeModalBtn) {
  closeModalBtn.addEventListener('click', function () {
    settingsModal.classList.remove('open');
  });
}

settingsModal.addEventListener('click', function (e) {
  if (e.target === settingsModal) settingsModal.classList.remove('open');
});

// ── Cambiar foto ──
if (btnChangePhoto) {
  btnChangePhoto.addEventListener('click', function () { modalFileAvatar.click(); });
}
document.getElementById('avatarEditPreview').addEventListener('click', function () { modalFileAvatar.click(); });

modalFileAvatar.addEventListener('change', function () {
  if (modalFileAvatar.files && modalFileAvatar.files[0]) {
    if (modalFileAvatar.files[0].size > 5 * 1024 * 1024) {
      alert('La imagen no debe superar 5MB.');
      modalFileAvatar.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      document.getElementById('modalAvatarPreview').src = e.target.result;
      document.getElementById('modalAvatarPreview').style.display = 'block';
      document.getElementById('modalAvatarDefault').style.display = 'none';
    };
    reader.readAsDataURL(modalFileAvatar.files[0]);
  }
});

// ── Botón restablecer nombre visible ──
var btnResetNombre = document.getElementById('btnResetNombre');
if (btnResetNombre) {
  btnResetNombre.addEventListener('click', function () {
    var nombreVisibleInput = document.getElementById('modalNombreVisible');
    var username = nombreVisibleInput.getAttribute('data-username') || '';
    if (username) {
      nombreVisibleInput.value = username;
    }
  });
}

// ── Sección de contraseña: toggle colapsable ──
var btnPasswordSection = document.getElementById('btnPasswordSection');
var passwordSectionFields = document.getElementById('passwordSectionFields');

if (btnPasswordSection && passwordSectionFields) {
  btnPasswordSection.addEventListener('click', function () {
    var isOpen = passwordSectionFields.classList.contains('open');
    if (isOpen) {
      passwordSectionFields.classList.remove('open');
      btnPasswordSection.classList.remove('active');
    } else {
      passwordSectionFields.classList.add('open');
      btnPasswordSection.classList.add('active');
    }
  });
}

// ── Contraseña actual → habilitar nueva contraseña ──
var modalCurrentPassword = document.getElementById('modalCurrentPassword');
var modalNewPassword = document.getElementById('modalNewPassword');
var modalConfirmPassword = document.getElementById('modalConfirmPassword');

if (modalCurrentPassword) {
  modalCurrentPassword.addEventListener('input', function () {
    var hasValue = this.value.trim().length > 0;
    if (modalNewPassword) modalNewPassword.disabled = !hasValue;
    if (modalConfirmPassword) modalConfirmPassword.disabled = !hasValue;
    if (!hasValue) {
      if (modalNewPassword) modalNewPassword.value = '';
      if (modalConfirmPassword) modalConfirmPassword.value = '';
      var matchHint = document.getElementById('passwordMatchHint');
      if (matchHint) { matchHint.textContent = ''; matchHint.className = 'form-hint'; }
    }
  });
}

// ── Verificar coincidencia de contraseñas nuevas ──
if (modalConfirmPassword) {
  modalConfirmPassword.addEventListener('input', function () {
    var matchHint = document.getElementById('passwordMatchHint');
    if (!matchHint) return;

    var newPass = modalNewPassword ? modalNewPassword.value : '';
    var confirmPass = this.value;

    if (confirmPass.length === 0) {
      matchHint.textContent = '';
      matchHint.className = 'form-hint';
    } else if (newPass === confirmPass) {
      matchHint.textContent = '✓ Las contraseñas coinciden';
      matchHint.className = 'form-hint match';
    } else {
      matchHint.textContent = '✗ Las contraseñas no coinciden';
      matchHint.className = 'form-hint no-match';
    }
  });
}

// ── Toggle visibilidad contraseña (botones ojo) ──
document.querySelectorAll('.btn-toggle-password').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var targetId = this.getAttribute('data-target');
    if (!targetId) return;
    var input = document.getElementById(targetId);
    if (!input) return;

    if (input.type === 'password') {
      input.type = 'text';
      this.classList.add('showing');
    } else {
      input.type = 'password';
      this.classList.remove('showing');
    }
  });
});

// ── Guardar Ajustes ──
settingsForm.addEventListener('submit', async function (e) {
  e.preventDefault();

  var userId = getUserId();
  if (!userId) {
    alert('Error: No hay sesión activa. Intenta recargar la página.');
    return;
  }

  var newName = document.getElementById('modalNombreVisible').value.trim();
  if (!newName) {
    alert('El nombre visible no puede estar vacío.');
    return;
  }

  var formData = new FormData();
  formData.append('idUsuario', userId);
  formData.append('nombreVisible', newName);

  // Foto si se seleccionó
  var avatarInput = document.getElementById('modalFileAvatar');
  if (avatarInput.files && avatarInput.files[0]) {
    formData.append('foto', avatarInput.files[0]);
  }

  // Contraseña: verificar los 3 campos
  var passFieldsOpen = passwordSectionFields && passwordSectionFields.classList.contains('open');
  if (passFieldsOpen) {
    var currentPass = modalCurrentPassword ? modalCurrentPassword.value : '';
    var newPass = modalNewPassword ? modalNewPassword.value : '';
    var confirmPass = modalConfirmPassword ? modalConfirmPassword.value : '';

    if (currentPass || newPass || confirmPass) {
      if (!currentPass) {
        alert('Debes ingresar tu contraseña actual.');
        return;
      }
      if (!newPass) {
        alert('Debes ingresar la nueva contraseña.');
        return;
      }
      if (newPass.length < 8) {
        alert('La nueva contraseña debe tener al menos 8 caracteres.');
        return;
      }
      if (!/[A-Z]/.test(newPass) || !/[a-z]/.test(newPass) || !/[0-9]/.test(newPass)) {
        alert('La nueva contraseña debe contener mayúsculas, minúsculas y números.');
        return;
      }
      if (newPass !== confirmPass) {
        alert('La nueva contraseña y la confirmación no coinciden.');
        return;
      }

      formData.append('contrasenaActual', currentPass);
      formData.append('contrasena', newPass);
    }
  }

  // Deshabilitar botón
  var saveBtn = settingsForm.querySelector('.btn-save-settings');
  var originalText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando...';

  try {
    var response = await fetch('/api/usuario/actualizar', {
      method: 'POST',
      body: formData
    });

    var result = await response.json();

    if (response.ok && result.exitoso) {
      // Actualizar sidebar
      document.getElementById('userName').textContent = newName;

      // Actualizar foto
      if (result.fotoUrl || (result.usuario && result.usuario.FotoPerfilPath)) {
        var newImgUrl = '/api/usuario-foto/' + userId + '?t=' + Date.now();
        document.getElementById('userAvatar').src = newImgUrl;
        document.getElementById('userAvatar').style.display = 'block';
        document.getElementById('userAvatarDefault').style.display = 'none';
        document.getElementById('modalAvatarPreview').src = newImgUrl;
        document.getElementById('modalAvatarPreview').style.display = 'block';
        document.getElementById('modalAvatarDefault').style.display = 'none';
      }

      // Limpiar campos de contraseña
      if (modalCurrentPassword) modalCurrentPassword.value = '';
      if (modalNewPassword) { modalNewPassword.value = ''; modalNewPassword.disabled = true; }
      if (modalConfirmPassword) { modalConfirmPassword.value = ''; modalConfirmPassword.disabled = true; }
      var matchHint = document.getElementById('passwordMatchHint');
      if (matchHint) { matchHint.textContent = ''; matchHint.className = 'form-hint'; }

      // Cerrar sección de contraseña
      if (passwordSectionFields) passwordSectionFields.classList.remove('open');
      if (btnPasswordSection) btnPasswordSection.classList.remove('active');

      // Limpiar file input
      avatarInput.value = '';

      // Cerrar modal
      settingsModal.classList.remove('open');
    } else {
      alert(result.error || 'Error al guardar los cambios.');
    }
  } catch (err) {
    alert('Error de conexión al guardar ajustes.');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
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
    var connId = sessionStorage.getItem('idConexion') || currentConnectionId;
    if (!connId) throw new Error('No hay idConexion');

    var response = await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idConexion: connId })
    });

    if (response.ok) {
      sessionStorage.removeItem('idUsuario');
      sessionStorage.removeItem('idConexion');
      sessionStorage.removeItem('usuario');
      sessionStorage.removeItem('correo');
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