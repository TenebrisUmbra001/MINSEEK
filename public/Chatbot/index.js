/* ── Protección: Verificar que hay sesión activa ── */
(function verificarSesion() {
  var idUsuario = sessionStorage.getItem('idUsuario');
  var idConexion = sessionStorage.getItem('idConexion');
  if (!idUsuario || !idConexion) {
    window.location.replace('/');
    return;
  }
  iniciarHeartbeat(idUsuario);
})();

// ============================================================================
// SISTEMA DE INACTIVIDAD
// ============================================================================
var heartbeatInterval = null;
var idUsuarioActual = null;

function iniciarHeartbeat(idUsuario) {
  detenerHeartbeat();
  idUsuarioActual = idUsuario;

  heartbeatInterval = setInterval(function() {
    fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ idUsuario: idUsuarioActual })
    })
    .then(function(response) { return response.json(); })
    .then(function(data) {
      if (!data.sesionActiva || data.codigo === 'SESION_EXPIRADA') {
        detenerHeartbeat();
        cerrarSesionPorInactividad();
      }
      if (!data.exitoso && (response.status === 401 || response.status === 404)) {
        detenerHeartbeat();
        cerrarSesionPorInactividad();
      }
    })
    .catch(function(e) {
      console.warn('⚠️ Heartbeat error de red:', e.message);
    });
  }, 5 * 60 * 1000);

  fetch('/api/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ idUsuario: idUsuarioActual })
  }).catch(function() {});
}

function detenerHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function cerrarSesionPorInactividad() {
  sessionStorage.clear();
  alert('Tu sesión ha expirado por inactividad (más de 45 minutos sin actividad).');
  window.location.replace('/');
}

// ============================================================================
// DOM & VARIABLES
// ============================================================================
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
var convSaveTimer = null;

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

function extractThink(text) { var m = text.match(/思索([\s\S]*?)<\/think>/i); return m ? m[1].trim() : ''; }
function removeThink(text) { return text.replace(/思索[\s\S]*?<\/think>/gi, '').trim(); }
function makeWelcome() { var d = document.createElement('div'); d.className = 'welcome-state'; d.id = 'welcomeState'; d.innerHTML = '<div class="welcome-icon"><img draggable="false" src="../Assets/LOGO IA CCR.png" alt=""></div><h2>Inicia una conversacion</h2><p>Escribe tu consulta abajo.</p>'; return d; }

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function timeStr() { var n = new Date(); return pad2(n.getHours()) + ':' + pad2(n.getMinutes()); }

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
  var removeBtns = filePreviewList.querySelectorAll('.file-chip-remove');
  for (var j = 0; j < removeBtns.length; j++) {
    removeBtns[j].addEventListener('click', function() { selectedFiles.splice(parseInt(this.getAttribute('data-index')), 1); renderFilePreviews(); });
  }
}

function clearSelectedFiles() { selectedFiles = []; fileInput.value = ''; filePreviewList.innerHTML = ''; }

/* ═══════════════════════════════════════
   USUARIO
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

var currentUserId = sessionStorage.getItem('idUsuario') || null;
var currentConnectionId = sessionStorage.getItem('idConexion') || null;

function getUserId() {
  return sessionStorage.getItem('idUsuario') || currentUserId;
}

function loadUserInfo() {
  var nameEl = document.getElementById('userName');
  var avatarEl = document.getElementById('userAvatar');
  var avatarDefault = document.getElementById('userAvatarDefault');
  var userId = getUserId();

  if (!userId) { nameEl.textContent = 'Usuario'; return; }
  if (!currentUserId) currentUserId = userId;

  fetch('/api/usuario/' + userId)
  .then(function(response) {
    if (!response.ok) throw new Error('No autenticado');
    return response.json();
  })
  .then(function(result) {
    if (result.exitoso && result.usuario) {
      var u = result.usuario;
      if (u.id && !sessionStorage.getItem('idUsuario')) {
        sessionStorage.setItem('idUsuario', u.id);
        currentUserId = u.id;
      }
      var displayName = (u.NombreVisible && u.NombreVisible !== 'Usuario') ? u.NombreVisible : u.NombreUsuario || 'Usuario';
      nameEl.textContent = displayName;
      document.getElementById('modalNombreVisible').value = u.NombreVisible || '';
      var nombreVisibleInput = document.getElementById('modalNombreVisible');
      if (u.NombreUsuario) nombreVisibleInput.setAttribute('data-username', u.NombreUsuario);

      if (u.FotoPerfilPath) {
        var imgUrl = '/api/usuario-foto/' + userId + '?t=' + Date.now();
        avatarEl.src = imgUrl; avatarEl.style.display = 'block'; avatarDefault.style.display = 'none';
        avatarEl.onerror = function () { avatarEl.style.display = 'none'; avatarDefault.style.display = 'block'; };
        document.getElementById('modalAvatarPreview').src = imgUrl;
        document.getElementById('modalAvatarPreview').style.display = 'block';
        document.getElementById('modalAvatarDefault').style.display = 'none';
        document.getElementById('modalAvatarPreview').onerror = function () {
          document.getElementById('modalAvatarPreview').style.display = 'none';
          document.getElementById('modalAvatarDefault').style.display = 'block';
        };
      } else {
        avatarEl.style.display = 'none'; avatarDefault.style.display = 'block';
        document.getElementById('modalAvatarPreview').style.display = 'none';
        document.getElementById('modalAvatarDefault').style.display = 'block';
      }
    } else { nameEl.textContent = 'Usuario'; }
  })
  .catch(function(err) { nameEl.textContent = 'Usuario'; console.warn('No se pudo cargar info del usuario:', err.message); });
}

if (optionsBtn) {
  optionsBtn.querySelector('svg').addEventListener('click', function (e) { e.stopPropagation(); optionsDropdown.classList.toggle('open'); });
}
document.addEventListener('click', function (e) { if (optionsDropdown && !optionsBtn.contains(e.target)) optionsDropdown.classList.remove('open'); });

var btnAdminPanel = document.getElementById('btnAdminPanel');
if (btnAdminPanel) { btnAdminPanel.addEventListener('click', function () { optionsDropdown.classList.remove('open'); window.open('/AdminPanel/index.html', '_blank'); }); }

if (btnAjustes) {
  btnAjustes.addEventListener('click', function () {
    optionsDropdown.classList.remove('open');
    var passFields = document.getElementById('passwordSectionFields');
    var passToggle = document.getElementById('btnPasswordSection');
    if (passFields) passFields.classList.remove('open');
    if (passToggle) passToggle.classList.remove('active');
    var cp = document.getElementById('modalCurrentPassword');
    var np = document.getElementById('modalNewPassword');
    var cnp = document.getElementById('modalConfirmPassword');
    if (cp) cp.value = '';
    if (np) { np.value = ''; np.disabled = true; }
    if (cnp) { cnp.value = ''; cnp.disabled = true; }
    var matchHint = document.getElementById('passwordMatchHint');
    if (matchHint) { matchHint.textContent = ''; matchHint.className = 'form-hint'; }
    loadUserInfo(); settingsModal.classList.add('open');
  });
}
if (closeModalBtn) { closeModalBtn.addEventListener('click', function () { settingsModal.classList.remove('open'); }); }
settingsModal.addEventListener('click', function (e) { if (e.target === settingsModal) settingsModal.classList.remove('open'); });

if (btnChangePhoto) { btnChangePhoto.addEventListener('click', function () { modalFileAvatar.click(); }); }
document.getElementById('avatarEditPreview').addEventListener('click', function () { modalFileAvatar.click(); });

modalFileAvatar.addEventListener('change', function () {
  if (modalFileAvatar.files && modalFileAvatar.files[0]) {
    if (modalFileAvatar.files[0].size > 5 * 1024 * 1024) { alert('La imagen no debe superar 5MB.'); modalFileAvatar.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      document.getElementById('modalAvatarPreview').src = e.target.result;
      document.getElementById('modalAvatarPreview').style.display = 'block';
      document.getElementById('modalAvatarDefault').style.display = 'none';
    };
    reader.readAsDataURL(modalFileAvatar.files[0]);
  }
});

var btnResetNombre = document.getElementById('btnResetNombre');
if (btnResetNombre) { btnResetNombre.addEventListener('click', function () { var nombreVisibleInput = document.getElementById('modalNombreVisible'); var username = nombreVisibleInput.getAttribute('data-username') || ''; if (username) nombreVisibleInput.value = username; }); }

var btnPasswordSection = document.getElementById('btnPasswordSection');
var passwordSectionFields = document.getElementById('passwordSectionFields');
if (btnPasswordSection && passwordSectionFields) {
  btnPasswordSection.addEventListener('click', function () {
    var isOpen = passwordSectionFields.classList.contains('open');
    if (isOpen) { passwordSectionFields.classList.remove('open'); btnPasswordSection.classList.remove('active'); }
    else { passwordSectionFields.classList.add('open'); btnPasswordSection.classList.add('active'); }
  });
}

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

if (modalConfirmPassword) {
  modalConfirmPassword.addEventListener('input', function () {
    var matchHint = document.getElementById('passwordMatchHint'); if (!matchHint) return;
    var newPass = modalNewPassword ? modalNewPassword.value : ''; var confirmPass = this.value;
    if (confirmPass.length === 0) { matchHint.textContent = ''; matchHint.className = 'form-hint'; }
    else if (newPass === confirmPass) { matchHint.textContent = '✓ Las contraseñas coinciden'; matchHint.className = 'form-hint match'; }
    else { matchHint.textContent = '✗ Las contraseñas no coinciden'; matchHint.className = 'form-hint no-match'; }
  });
}

var togglePassBtns = document.querySelectorAll('.btn-toggle-password');
for (var t = 0; t < togglePassBtns.length; t++) {
  togglePassBtns[t].addEventListener('click', function () {
    var targetId = this.getAttribute('data-target'); if (!targetId) return;
    var input = document.getElementById(targetId); if (!input) return;
    if (input.type === 'password') { input.type = 'text'; this.classList.add('showing'); }
    else { input.type = 'password'; this.classList.remove('showing'); }
  });
}

settingsForm.addEventListener('submit', function (e) {
  e.preventDefault();
  var userId = getUserId();
  if (!userId) { alert('Error: No hay sesión activa.'); return; }
  var newName = document.getElementById('modalNombreVisible').value.trim();
  if (!newName) { alert('El nombre visible no puede estar vacío.'); return; }

  var formData = new FormData();
  formData.append('idUsuario', userId);
  formData.append('nombreVisible', newName);

  var avatarInput = document.getElementById('modalFileAvatar');
  if (avatarInput.files && avatarInput.files[0]) formData.append('foto', avatarInput.files[0]);

  var passFieldsOpen = passwordSectionFields && passwordSectionFields.classList.contains('open');
  if (passFieldsOpen) {
    var currentPass = modalCurrentPassword ? modalCurrentPassword.value : '';
    var newPass = modalNewPassword ? modalNewPassword.value : '';
    var confirmPass = modalConfirmPassword ? modalConfirmPassword.value : '';
    if (currentPass || newPass || confirmPass) {
      if (!currentPass) { alert('Debes ingresar tu contraseña actual.'); return; }
      if (!newPass) { alert('Debes ingresar la nueva contraseña.'); return; }
      if (newPass.length < 8) { alert('La nueva contraseña debe tener al menos 8 caracteres.'); return; }
      if (!/[A-Z]/.test(newPass) || !/[a-z]/.test(newPass) || !/[0-9]/.test(newPass)) { alert('La nueva contraseña debe contener mayúsculas, minúsculas y números.'); return; }
      if (newPass !== confirmPass) { alert('La nueva contraseña y la confirmación no coinciden.'); return; }
      formData.append('contrasenaActual', currentPass);
      formData.append('contrasena', newPass);
    }
  }

  var saveBtn = settingsForm.querySelector('.btn-save-settings');
  var originalText = saveBtn.textContent;
  saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';

  fetch('/api/usuario/actualizar', { method: 'POST', body: formData })
  .then(function(response) { return response.json(); })
  .then(function(result) {
    if (result.exitoso) {
      document.getElementById('userName').textContent = newName;
      if (result.fotoUrl || (result.usuario && result.usuario.FotoPerfilPath)) {
        var newImgUrl = '/api/usuario-foto/' + userId + '?t=' + Date.now();
        document.getElementById('userAvatar').src = newImgUrl; document.getElementById('userAvatar').style.display = 'block'; document.getElementById('userAvatarDefault').style.display = 'none';
        document.getElementById('modalAvatarPreview').src = newImgUrl; document.getElementById('modalAvatarPreview').style.display = 'block'; document.getElementById('modalAvatarDefault').style.display = 'none';
      }
      if (modalCurrentPassword) modalCurrentPassword.value = '';
      if (modalNewPassword) { modalNewPassword.value = ''; modalNewPassword.disabled = true; }
      if (modalConfirmPassword) { modalConfirmPassword.value = ''; modalConfirmPassword.disabled = true; }
      var matchHint = document.getElementById('passwordMatchHint'); if (matchHint) { matchHint.textContent = ''; matchHint.className = 'form-hint'; }
      if (passwordSectionFields) passwordSectionFields.classList.remove('open');
      if (btnPasswordSection) btnPasswordSection.classList.remove('active');
      avatarInput.value = '';
      settingsModal.classList.remove('open');
    } else { alert(result.error || 'Error al guardar.'); }
  })
  .catch(function() { alert('Error de conexión al guardar ajustes.'); })
  .finally(function() { saveBtn.disabled = false; saveBtn.textContent = originalText; });
});

function logout() {
  detenerHeartbeat(); optionsDropdown.classList.remove('open');
  var overlay = document.createElement('div'); overlay.className = 'logout-overlay';
  overlay.innerHTML = '<div class="logout-box"><p>Desconectando...</p><div class="spinner"></div></div>';
  document.body.appendChild(overlay);

  var connId = sessionStorage.getItem('idConexion') || currentConnectionId;
  var userId = sessionStorage.getItem('idUsuario') || currentUserId;
  if (!connId) { alert('Error: No hay sesión.'); overlay.remove(); return; }

  fetch('/api/logout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idConexion: connId, idUsuario: userId })
  })
  .then(function(response) {
    if (response.ok) {
      sessionStorage.removeItem('idUsuario'); sessionStorage.removeItem('idConexion'); sessionStorage.removeItem('usuario'); sessionStorage.removeItem('correo');
      window.location.replace('/');
    } else { throw new Error('Error'); }
  })
  .catch(function(err) {
    overlay.remove(); var errDiv = document.createElement('div'); errDiv.className = 'message error';
    errDiv.textContent = 'No se pudo cerrar sesión. Intenta de nuevo.'; chatContainer.appendChild(errDiv); chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}
if (btnLogout) btnLogout.addEventListener('click', logout);

loadUserInfo();

/* ═══════════════════════════════════════
   SISTEMA DE CONVERSACIONES
   ═══════════════════════════════════════ */

// ── Cargar historial en sidebar ──
function loadHistory() {
  var userId = getUserId();
  if (!userId) { sidebarScroll.innerHTML = ''; return; }

  fetch('/api/conversaciones/' + userId)
  .then(function(response) { return response.json(); })
  .then(function(result) {
    if (!result.exitoso || !result.conversaciones) {
      sidebarScroll.innerHTML = '<div class="conv-empty">No hay conversaciones</div>';
      return;
    }
    renderConversaciones(result.conversaciones);
  })
  .catch(function(err) {
    console.warn('Error cargando historial:', err);
    sidebarScroll.innerHTML = '<div class="conv-empty">Error al cargar</div>';
  });
}

// ── Agrupar y renderizar conversaciones ──
function renderConversaciones(convs) {
  sidebarScroll.innerHTML = '';
  if (!convs || convs.length === 0) {
    sidebarScroll.innerHTML = '<div class="conv-empty">No hay conversaciones</div>';
    return;
  }

  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  var ayer = new Date(hoy.getTime()); ayer.setDate(ayer.getDate() - 1);
  var semana = new Date(hoy.getTime()); semana.setDate(semana.getDate() - 7);
  var mes = new Date(hoy.getTime()); mes.setDate(mes.getDate() - 30);

  var grupos = { 'Hoy': [], 'Ayer': [], 'Ultimos 7 dias': [], 'Ultimos 30 dias': [] };

  for (var i = 0; i < convs.length; i++) {
    var c = convs[i];
    var fecha = new Date(c.fechaActualizacion || c.fechaCreacion);
    fecha.setHours(0, 0, 0, 0);

    if (fecha.getTime() === hoy.getTime()) grupos['Hoy'].push(c);
    else if (fecha.getTime() === ayer.getTime()) grupos['Ayer'].push(c);
    else if (fecha > semana) grupos['Ultimos 7 dias'].push(c);
    else if (fecha > mes) grupos['Ultimos 30 dias'].push(c);
  }

  var keys = ['Hoy', 'Ayer', 'Ultimos 7 dias', 'Ultimos 30 dias'];
  for (var g = 0; g < keys.length; g++) {
    var grupo = grupos[keys[g]];
    if (grupo.length === 0) continue;

    var label = document.createElement('div');
    label.className = 'conv-group-label';
    label.textContent = keys[g];
    sidebarScroll.appendChild(label);

    for (var j = 0; j < grupo.length; j++) {
      sidebarScroll.appendChild(crearConvItem(grupo[j]));
    }
  }
}

function crearConvItem(conv) {
  var item = document.createElement('div');
  item.className = 'conv-item' + (conv.id === currentConvId ? ' active' : '');
  item.setAttribute('data-id', conv.id);

  var title = document.createElement('span');
  title.className = 'conv-title';
  title.textContent = conv.titulo || 'Sin titulo';
  title.title = conv.titulo || 'Sin titulo';

  var deleteBtn = document.createElement('button');
  deleteBtn.className = 'conv-delete';
  deleteBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  deleteBtn.title = 'Eliminar conversacion';

  item.addEventListener('click', function(e) {
    if (e.target.closest('.conv-delete')) return;
    cargarConversacion(conv.id);
  });

  deleteBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    eliminarConversacion(conv.id, conv.titulo);
  });

  item.appendChild(title);
  item.appendChild(deleteBtn);
  return item;
}

// ── Cargar una conversacion pasada ──
function cargarConversacion(id) {
  var userId = getUserId();
  if (!userId || !id) return;

  fetch('/api/conversacion/' + id + '?idUsuario=' + encodeURIComponent(userId))
  .then(function(response) { return response.json(); })
  .then(function(result) {
    if (!result.exitoso || !result.conversacion) {
      console.warn('Error cargando conversacion:', result.error);
      return;
    }

    var conv = result.conversacion;
    currentConvId = conv.id;

    chatContainer.innerHTML = '';
    messages = [];

    for (var i = 0; i < conv.mensajes.length; i++) {
      var msg = conv.mensajes[i];
      messages.push({ role: msg.role, content: msg.content });

      if (msg.role === 'user') {
        var displayText = msg.displayText || msg.content;
        var userDiv = document.createElement('div');
        userDiv.className = 'message user';
        userDiv.innerHTML = esc(displayText) + '<div class="msg-time">' + (msg.timestamp || '') + '</div>';
        chatContainer.appendChild(userDiv);
      } else if (msg.role === 'assistant') {
        var asstDiv = document.createElement('div');
        asstDiv.className = 'message assistant';
        renderThinking(asstDiv, msg.content);
        chatContainer.appendChild(asstDiv);
      }
    }

    chatContainer.scrollTop = chatContainer.scrollHeight;

    var items = sidebarScroll.querySelectorAll('.conv-item');
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle('active', items[j].getAttribute('data-id') === id);
    }

    if (isMobile()) closeSidebar();
  })
  .catch(function(err) {
    console.warn('Error cargando conversacion:', err);
  });
}

// ── Eliminar una conversacion ──
function eliminarConversacion(id, titulo) {
  var userId = getUserId();
  if (!userId || !id) return;

  var nombre = (titulo || 'Sin titulo');
  if (nombre.length > 30) nombre = nombre.substring(0, 27) + '...';

  if (!window.confirm('Eliminar "' + nombre + '"?')) return;

  fetch('/api/conversacion/' + id + '/eliminar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idUsuario: userId })
  })
  .then(function(response) { return response.json(); })
  .then(function(result) {
    if (result.exitoso) {
      if (currentConvId === id) {
        currentConvId = null;
        messages = [];
        chatContainer.innerHTML = '';
        chatContainer.appendChild(makeWelcome());
      }
      loadHistory();
    } else {
      alert('Error: ' + (result.error || 'No se pudo eliminar'));
    }
  })
  .catch(function(err) {
    console.warn('Error eliminando conversacion:', err);
  });
}

// ── Guardar conversacion actual ──
function saveConversation() {
  var userId = getUserId();
  if (!userId || messages.length === 0) return;

  var mensajesParaGuardar = [];
  for (var i = 0; i < messages.length; i++) {
    var msg = {
      role: messages[i].role,
      content: messages[i].content
    };
    if (messages[i].displayText) msg.displayText = messages[i].displayText;
    if (messages[i].timestamp) msg.timestamp = messages[i].timestamp;
    mensajesParaGuardar.push(msg);
  }

  if (!currentConvId) {
    fetch('/api/conversaciones/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idUsuario: userId })
    })
    .then(function(response) { return response.json(); })
    .then(function(result) {
      if (result.exitoso && result.id) {
        currentConvId = result.id;
        guardarMensajesEnServidor(currentConvId, userId, mensajesParaGuardar);
      } else {
        console.warn('Error creando conversacion:', result.error);
      }
    })
    .catch(function(err) {
      console.warn('Error creando conversacion:', err);
    });
  } else {
    guardarMensajesEnServidor(currentConvId, userId, mensajesParaGuardar);
  }
}

function guardarMensajesEnServidor(convId, userId, mensajes) {
  fetch('/api/conversaciones/' + convId + '/guardar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idUsuario: userId, mensajes: mensajes })
  })
  .then(function(response) { return response.json(); })
  .then(function(result) {
    if (result.exitoso) {
      if (result.titulo) {
        loadHistory();
      }
    } else {
      console.warn('Error guardando conversacion:', result.error);
    }
  })
  .catch(function(err) {
    console.warn('Error guardando conversacion:', err);
  });
}

// ── Auto-guardar con debounce ──
function scheduleSave() {
  if (convSaveTimer) clearTimeout(convSaveTimer);
  convSaveTimer = setTimeout(function() {
    saveConversation();
  }, 2000);
}

// ── Nueva conversacion ──
function nuevaConversacion() {
  currentConvId = null;
  messages = [];
  chatContainer.innerHTML = '';
  chatContainer.appendChild(makeWelcome());
  userInput.value = '';
  clearSelectedFiles();
  userInput.focus();

  var items = sidebarScroll.querySelectorAll('.conv-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove('active');
  }
}

/* ═══════════════════════════════════════
   CHAT: Envio y Streaming
   ═══════════════════════════════════════ */
function sendMessage() {
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

    uploadDocuments(filesToSend).then(function(result) {
      var successHtml = '';
      if (result.archivos) { for (var a = 0; a < result.archivos.length; a++) { successHtml += '<div class="doc-info" style="margin-bottom:4px"><div class="doc-name">' + esc(result.archivos[a].nombre) + '</div><div class="doc-status success">✓ Leido</div></div>'; if (result.archivos[a].contenido) currentDocContexts.push(result.archivos[a].contenido); } }
      uploadDiv.innerHTML = '<div class="doc-icon-wrap">' + docSvg + '</div><div style="flex:1;min-width:0">' + successHtml + '</div><div class="msg-time">' + timeStr() + '</div>';
      if (!text) { userInput.focus(); return; }
      continueSendMessage(text);
    }).catch(function(err) {
      uploadDiv.className = 'message error doc-message'; uploadDiv.innerHTML = '<div class="doc-icon-wrap">' + docSvg + '</div><div class="doc-info"><div class="doc-status error">Error: ' + esc(err.message) + '</div></div>';
      chatContainer.scrollTop = chatContainer.scrollHeight; userInput.focus();
    });
  } else {
    continueSendMessage(text);
  }
}

function continueSendMessage(text) {
  var now = timeStr();
  var userDiv = document.createElement('div'); userDiv.className = 'message user';
  userDiv.innerHTML = esc(text) + '<div class="msg-time">' + now + '</div>';
  chatContainer.appendChild(userDiv); chatContainer.scrollTop = chatContainer.scrollHeight;

  var promptForAPI = text;
  if (currentDocContexts.length > 0) {
    promptForAPI = "[El usuario ha adjuntado " + currentDocContexts.length + " documento(s). A continuacion se muestra el contenido extraido:\n---\n" + currentDocContexts.join('\n\n---\n\n') + "\n---\n]\n\nPregunta del usuario: " + text;
    currentDocContexts = [];
  }

  // Guardar con displayText para separar texto visible del contexto de docs
  messages.push({ role: 'user', content: promptForAPI, displayText: text, timestamp: now });
  userInput.value = ''; sendBtn.disabled = true; isStreaming = true;
  var asstDiv = document.createElement('div'); asstDiv.className = 'message assistant'; asstDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  chatContainer.appendChild(asstDiv); chatContainer.scrollTop = chatContainer.scrollHeight; var fullContent = '';

  var body = { messages: messages }; if (currentConvId) body.conversation_id = currentConvId;

  fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(function(response) {
    if (!response.ok) throw new Error('Error servidor');

    // FIREFOX 43 FALLBACK: Si el navegador no soporta ReadableStream
    if (!response.body || !response.body.getReader) {
      return response.text().then(function(text) {
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('data: ') === 0) {
            var payload = line.substring(6);
            if (payload === '[DONE]') continue;
            try { var data = JSON.parse(payload); if (data.content) fullContent += data.content; } catch (e) {}
          }
        }
        renderThinking(asstDiv, fullContent); chatContainer.scrollTop = chatContainer.scrollHeight;
        return;
      });
    }

    // NAVEGADORES MODERNOS: Streaming nativo
    var reader = response.body.getReader(); var decoder = new TextDecoder(); var buffer = '';
    function readChunk() {
      return reader.read().then(function(chunk) {
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split('\n'); buffer = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('data: ') === 0) {
            var payload = line.substring(6);
            if (payload === '[DONE]') continue;
            try { var data = JSON.parse(payload); if (data.content) { fullContent += data.content; renderThinking(asstDiv, fullContent); chatContainer.scrollTop = chatContainer.scrollHeight; } } catch (e) {}
          }
        }
        return readChunk();
      });
    }
    return readChunk();
  })
  .then(function() {
    if (fullContent) {
      var nowAsst = timeStr();
      messages.push({ role: 'assistant', content: fullContent, timestamp: nowAsst });
    }
    sendBtn.disabled = false; isStreaming = false; userInput.focus();
    scheduleSave();
  })
  .catch(function(err) {
    asstDiv.className = 'message error'; asstDiv.innerHTML = 'Error: ' + esc(err.message);
    sendBtn.disabled = false; isStreaming = false; userInput.focus();
  });
}

function renderThinking(div, full) { var tO = '思索', tC = ''; var depth = 0, lastEnd = 0, i = 0; while (i < full.length) { if (full.substring(i, i + tO.length) === tO) { depth++; i += tO.length; } else if (full.substring(i, i + tC.length) === tC && depth > 0) { depth--; lastEnd = i + tC.length; i += tC.length; } else i++; } var thinkPart = '', mainPart = ''; var completed = full.substring(0, lastEnd); var re = /思索([\s\S]*?)<\/think>/gi; var m; while ((m = re.exec(completed)) !== null) thinkPart += m[1]; var after = full.substring(lastEnd); if (depth > 0) thinkPart += after; else mainPart = after; var html = ''; if (thinkPart.trim()) html += '<div class="think-block">' + esc(thinkPart).replace(/\n/g, '<br>') + '</div>'; html += esc(mainPart).replace(/\n/g, '<br>'); if (!mainPart.trim() && !thinkPart.trim()) html = '<div class="typing-indicator"><span></span><span></span><span></span></div>'; if (mainPart.trim()) html += '<div class="msg-time">' + timeStr() + '</div>'; div.innerHTML = html; }

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
window.addEventListener('resize', function() { if (!isMobile()) { sidebar.classList.remove('open'); sidebarOverlay.style.display = 'none'; sidebarOverlay.classList.remove('visible'); sidebar.classList.toggle('collapsed', !sidebarOpen); updateToggleIcon(); } else sidebar.classList.remove('collapsed'); });

/* ═══════════════════════════════════════
   BOTONES SIDEBAR
   ═══════════════════════════════════════ */

// Nueva conversacion
var btnNewChat = document.getElementById('btnNewChat');
if (btnNewChat) {
  btnNewChat.addEventListener('click', function() {
    nuevaConversacion();
  });
}

// Logo → nueva conversacion
var sidebarLogoIcon = document.getElementById('sidebarLogoIcon');
if (sidebarLogoIcon) {
  sidebarLogoIcon.addEventListener('click', function() {
    nuevaConversacion();
  });
}

/* ═══════════════════════════════════════
   GUARDAR AL SALIR DE LA PAGINA
   ═══════════════════════════════════════ */
window.addEventListener('beforeunload', function() {
  if (messages.length === 0) return;

  var userId = getUserId();
  if (!userId) return;

  var mensajesParaGuardar = [];
  for (var i = 0; i < messages.length; i++) {
    var msg = { role: messages[i].role, content: messages[i].content };
    if (messages[i].displayText) msg.displayText = messages[i].displayText;
    if (messages[i].timestamp) msg.timestamp = messages[i].timestamp;
    mensajesParaGuardar.push(msg);
  }

  var body = { idUsuario: userId, mensajes: mensajesParaGuardar };

  // Firefox 43 compatible: sync XHR en beforeunload
  try {
    if (currentConvId) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/conversaciones/' + currentConvId + '/guardar', false);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify(body));
    } else {
      // Crear conversacion primero
      var xhr1 = new XMLHttpRequest();
      xhr1.open('POST', '/api/conversaciones/crear', false);
      xhr1.setRequestHeader('Content-Type', 'application/json');
      xhr1.send(JSON.stringify({ idUsuario: userId }));
      if (xhr1.status === 201) {
        try {
          var r = JSON.parse(xhr1.responseText);
          if (r.exitoso && r.id) {
            var xhr2 = new XMLHttpRequest();
            xhr2.open('POST', '/api/conversaciones/' + r.id + '/guardar', false);
            xhr2.setRequestHeader('Content-Type', 'application/json');
            xhr2.send(JSON.stringify(body));
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
});

// ── Inicializar ──
loadHistory();
loadUserInfo();
userInput.focus();