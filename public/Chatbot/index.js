/* ── DOM ── */
var sidebar = document.getElementById('sidebar');
var sidebarOverlay = document.getElementById('sidebarOverlay');
var sidebarScroll = document.getElementById('sidebarScroll');
var btnToggle = document.getElementById('btnToggle');
var iconToggle = document.getElementById('iconToggle');
var btnNewChat = document.getElementById('btnNewChat');
var chatContainer = document.getElementById('chatContainer');
var userInput = document.getElementById('userInput');
var sendBtn = document.getElementById('sendBtn');

var fileInput = document.getElementById('fileInput');
var attachBtn = document.getElementById('attachBtn');
var filePreview = document.getElementById('filePreview');
var filePreviewName = document.getElementById('filePreviewName');
var filePreviewSize = document.getElementById('filePreviewSize');
var filePreviewRemove = document.getElementById('filePreviewRemove');
var selectedFile = null;
var MAX_FILE_SIZE = 50 * 1024 * 1024;

var messages = [];
var isStreaming = false;
var sidebarOpen = true;
var currentConvId = null;

function isMobile() { return window.innerWidth <= 768; }

var iconOpen = '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>';
var iconClosed = '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/>';

function updateToggleIcon() {
  iconToggle.innerHTML = sidebarOpen ? iconOpen : iconClosed;
}

/* ── Toggle sidebar ── */
function toggleSidebar() {
  if (isMobile()) {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  } else {
    sidebarOpen = !sidebarOpen;
    sidebar.classList.toggle('collapsed', !sidebarOpen);
    updateToggleIcon();
  }
}

function openSidebar() {
  sidebar.classList.add('open');
  sidebar.classList.remove('collapsed');
  sidebarOverlay.style.display = 'block';
  requestAnimationFrame(function() { sidebarOverlay.classList.add('visible'); });
  sidebarOpen = true;
  updateToggleIcon();
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
  setTimeout(function() { sidebarOverlay.style.display = 'none'; }, 300);
  if (!isMobile()) { sidebarOpen = false; sidebar.classList.add('collapsed'); }
  updateToggleIcon();
}

btnToggle.addEventListener('click', toggleSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

/* ── Escapar HTML ── */
function esc(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

/* ── Cargar historial REAL del servidor ── */
async function loadHistory() {
  sidebarScroll.innerHTML = '<div class="sidebar-empty"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="12" y1="12" x2="16" y2="14"/></svg>Cargando...</div>';

  try {
    var res = await fetch('/api/conversations');
    if (!res.ok) throw new Error(res.status);
    var data = await res.json();

    var convs = data.conversations || [];
    if (!convs.length) {
      sidebarScroll.innerHTML = '<div class="sidebar-empty"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Sin conversaciones aun</div>';
      return;
    }

    var dayNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    var monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var groups = {};
    var todayStr = new Date().toDateString();

    convs.forEach(function(c) {
      var d = new Date(c.date);
      var label;
      if (d.toDateString() === todayStr) {
        label = 'Hoy';
      } else {
        var yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) {
          label = 'Ayer';
        } else {
          label = dayNames[d.getDay()] + ', ' + d.getDate() + ' de ' + monthNames[d.getMonth()];
        }
      }
      if (!groups[label]) groups[label] = [];
      var h = String(d.getHours()).padStart(2,'0');
      var m = String(d.getMinutes()).padStart(2,'0');
      groups[label].push({
        id: c.id,
        title: c.title || 'Sin titulo',
        time: h + ':' + m,
        msgs: c.messages_count || 0
      });
    });

    var html = '';
    Object.keys(groups).forEach(function(label) {
      html += '<div class="day-group"><div class="day-label">' + esc(label) + '</div>';
      groups[label].forEach(function(c) {
        html += '<div class="conv-item" data-id="' + esc(c.id) + '">';
        html += '<div class="conv-dot"></div><div class="conv-info">';
        html += '<div class="conv-title">' + esc(c.title) + '</div>';
        html += '<div class="conv-meta">' + c.time + ' &middot; ' + c.msgs + ' mensajes</div>';
        html += '</div></div>';
      });
      html += '</div>';
    });

    sidebarScroll.innerHTML = html;

    sidebarScroll.querySelectorAll('.conv-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var id = item.getAttribute('data-id');
        loadConversation(id);
        sidebarScroll.querySelectorAll('.conv-item').forEach(function(i) { i.classList.remove('active'); });
        item.classList.add('active');
        if (isMobile()) closeSidebar();
      });
    });

  } catch (err) {
    sidebarScroll.innerHTML = '<div class="sidebar-empty"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Error al cargar historial</div>';
  }
}

/* ── Cargar conversación concreta del servidor ── */
async function loadConversation(id) {
  try {
    var res = await fetch('/api/conversations/' + id);
    if (!res.ok) throw new Error(res.status);
    var data = await res.json();

    currentConvId = id;
    messages = (data.messages || []).map(function(m) { return { role: m.role, content: m.content }; });

    chatContainer.innerHTML = '';
    messages.forEach(function(m) {
      var div = document.createElement('div');
      div.className = 'message ' + m.role;
      var html = '';
      if (m.role === 'assistant') {
        var think = extractThink(m.content);
        if (think) html += '<div class="think-block">' + esc(think).replace(/\n/g,'<br>') + '</div>';
        html += esc(removeThink(m.content)).replace(/\n/g,'<br>');
      } else {
        html += esc(m.content);
      }
      div.innerHTML = html;
      chatContainer.appendChild(div);
    });

    if (!messages.length) {
      chatContainer.appendChild(makeWelcome());
    }

    chatContainer.scrollTop = chatContainer.scrollHeight;

  } catch (err) {
    chatContainer.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'message error';
    div.textContent = 'Error al cargar la conversación';
    chatContainer.appendChild(div);
  }
}

/* ── Utilidades para pensar  ── */
function extractThink(text) {
  var m = text.match(/思索([\s\S]*?)<\/think>/i);
  return m ? m[1].trim() : '';
}
function removeThink(text) {
  return text.replace(/思索[\s\S]*?<\/think>/gi, '').trim();
}

function makeWelcome() {
  var d = document.createElement('div');
  d.className = 'welcome-state'; d.id = 'welcomeState';
  d.innerHTML = '<div class="welcome-icon"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><h2>Inicia una conversacion</h2><p>Escribe tu consulta abajo o elige una sugerencia para comenzar.</p><div class="welcome-hints"><div class="hint-chip" data-hint="Explicame como funciona el aprendizaje automático">Aprendizaje automático</div><div class="hint-chip" data-hint="Escribe un resumen sobre cambio climático">Cambio climático</div><div class="hint-chip" data-hint="Dame 5 ideas para un proyecto en Python">Proyectos Python</div><div class="hint-chip" data-hint="Qué diferencias hay entre TCP y UDP">TCP vs UDP</div></div>';
  bindHints(d);
  return d;
}

function bindHints(root) {
  root.querySelectorAll('.hint-chip').forEach(function(c) {
    c.addEventListener('click', function() {
      var h = c.getAttribute('data-hint');
      if (h) { userInput.value = h; sendMessage(); }
    });
  });
}
bindHints(document);

function timeStr() {
  var n = new Date();
  return String(n.getHours()).padStart(2,'0') + ':' + String(n.getMinutes()).padStart(2,'0');
}

/* ── Formatear tamaño de archivo ── */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  var k = 1024;
  var sizes = ['Bytes', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/* ── SVG para documento ── */
var docSvg = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

/* ── Subir documento al servidor ── */
function uploadDocument(file) {
  return new Promise(function (resolve, reject) {
    var formData = new FormData();
    formData.append('documento', file);

    fetch('/api/upload', {
      method: 'POST',
      body: formData
    })
    .then(function (response) {
      return response.text().then(function (text) {
        var parsed;
        try { parsed = JSON.parse(text); } catch (e) { parsed = { ok: false, error: text }; }
        return { status: response.status, body: parsed };
      });
    })
    .then(function (result) {
      if (result.status >= 200 && result.status < 300 && result.body.ok) {
        resolve(result.body);
      } else {
        reject(new Error((result.body && result.body.error) || 'Error en la subida'));
      }
    })
    .catch(function (err) {
      reject(err);
    });
  });
}

/* ── Eventos de archivo ── */
attachBtn.addEventListener('click', function () {
  fileInput.click();
});

fileInput.addEventListener('change', function () {
  if (fileInput.files && fileInput.files.length > 0) {
    var file = fileInput.files[0];
    if (file.size > MAX_FILE_SIZE) {
      window.alert('El archivo excede el tamaño máximo de 50MB');
      fileInput.value = '';
      return;
    }
    selectedFile = file;
    filePreviewName.textContent = file.name;
    filePreviewSize.textContent = formatFileSize(file.size);
    filePreview.style.display = '-webkit-flex';
    filePreview.style.display = 'flex';
  }
});

filePreviewRemove.addEventListener('click', function () {
  selectedFile = null;
  fileInput.value = '';
  filePreview.style.display = 'none';
});

/* ── Limpiar archivo seleccionado ── */
function clearSelectedFile() {
  selectedFile = null;
  fileInput.value = '';
  filePreview.style.display = 'none';
}

/* ── Enviar mensaje ── */
async function sendMessage() {
  var text = userInput.value.trim();
  var hasFile = selectedFile !== null;

  if ((!text && !hasFile) || isStreaming) return;

  var ws = document.getElementById('welcomeState');
  if (ws) ws.remove();

  // ── Subida de documento ──
  if (hasFile) {
    var file = selectedFile;
    clearSelectedFile();

    var uploadDiv = document.createElement('div');
    uploadDiv.className = 'message user doc-message';
    uploadDiv.innerHTML =
      '<div class="doc-icon-wrap">' + docSvg + '</div>' +
      '<div class="doc-info">' +
        '<div class="doc-name">' + esc(file.name) + '</div>' +
        '<div class="doc-size">' + formatFileSize(file.size) + '</div>' +
        '<div class="doc-status uploading">Subiendo...</div>' +
      '</div>';
    chatContainer.appendChild(uploadDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
      var result = await uploadDocument(file);
      uploadDiv.innerHTML =
        '<div class="doc-icon-wrap">' + docSvg + '</div>' +
        '<div class="doc-info">' +
          '<div class="doc-name">' + esc(result.nombre || file.name) + '</div>' +
          '<div class="doc-size">' + formatFileSize(result.tamaño || file.size) + '</div>' +
          '<div class="doc-status success">✓ Guardado correctamente</div>' +
        '</div>' +
        '<div class="msg-time">' + timeStr() + '</div>';
    } catch (err) {
      uploadDiv.className = 'message error doc-message';
      uploadDiv.innerHTML =
        '<div class="doc-icon-wrap">' + docSvg + '</div>' +
        '<div class="doc-info">' +
          '<div class="doc-name">' + esc(file.name) + '</div>' +
          '<div class="doc-status error">Error: ' + esc(err.message || 'Desconocido') + '</div>' +
        '</div>';
    }

    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Si solo se subió archivo sin texto, terminamos aquí
    if (!text) { loadHistory(); userInput.focus(); return; }
  }

  // ── Mensaje de texto al IA (flujo existente) ──
  var userDiv = document.createElement('div');
  userDiv.className = 'message user';
  userDiv.innerHTML = esc(text) + '<div class="msg-time">' + timeStr() + '</div>';
  chatContainer.appendChild(userDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  messages.push({ role: 'user', content: text });
  userInput.value = '';
  sendBtn.disabled = true;
  isStreaming = true;

  var asstDiv = document.createElement('div');
  asstDiv.className = 'message assistant';
  asstDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  chatContainer.appendChild(asstDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  var fullContent = '';

  try {
    var body = { messages: messages };
    if (currentConvId) body.conversation_id = currentConvId;

    var response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      var errText = await response.text();
      throw new Error(errText || 'Respuesta no válida del servidor');
    }

    var convId = response.headers.get('X-Conversation-Id');
    if (convId && !currentConvId) {
      currentConvId = convId;
    }

    if (!response.body) throw new Error('El navegador no admite streaming.');

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var chunk = await reader.read();
      var done = chunk.done;
      var value = chunk.value;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.startsWith('data: ')) {
          var payload = line.substring(6);
          if (payload === '[DONE]') continue;
          try {
            var data = JSON.parse(payload);
            if (data.content) {
              fullContent += data.content;
              renderThinking(asstDiv, fullContent);
              chatContainer.scrollTop = chatContainer.scrollHeight;
            }
          } catch (e) {}
        }
      }
    }
  } catch (err) {
    asstDiv.className = 'message error';
    asstDiv.innerHTML = 'Error: ' + esc(err.message);
  }

  if (fullContent) {
    messages.push({ role: 'assistant', content: fullContent });
  }

  sendBtn.disabled = false;
  isStreaming = false;
  loadHistory();
  userInput.focus();
}

/* ── Renderizar con bloques think ── */
function renderThinking(div, full) {
  var tO = '思索', tC = '';
  var depth = 0, lastEnd = 0, i = 0;
  while (i < full.length) {
    if (full.substring(i, i + tO.length) === tO) { depth++; i += tO.length; }
    else if (full.substring(i, i + tC.length) === tC && depth > 0) { depth--; lastEnd = i + tC.length; i += tC.length; }
    else i++;
  }
  var thinkPart = '', mainPart = '';
  var completed = full.substring(0, lastEnd);
  var re = /思索([\s\S]*?)<\/think>/gi;
  var m;
  while ((m = re.exec(completed)) !== null) thinkPart += m[1];
  var after = full.substring(lastEnd);
  if (depth > 0) thinkPart += after;
  else mainPart = after;
  var html = '';
  if (thinkPart.trim()) html += '<div class="think-block">' + esc(thinkPart).replace(/\n/g, '<br>') + '</div>';
  html += esc(mainPart).replace(/\n/g, '<br>');
  if (!mainPart.trim() && !thinkPart.trim()) html = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  if (mainPart.trim()) html += '<div class="msg-time">' + timeStr() + '</div>';
  div.innerHTML = html;
}

/* ── Eventos ── */
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

window.addEventListener('resize', function() {
  if (!isMobile()) {
    sidebar.classList.remove('open');
    sidebarOverlay.style.display = 'none';
    sidebarOverlay.classList.remove('visible');
    sidebar.classList.toggle('collapsed', !sidebarOpen);
    updateToggleIcon();
  } else {
    sidebar.classList.remove('collapsed');
  }
});

/* ── Arranque ── */
loadHistory();
userInput.focus();