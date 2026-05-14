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

/* ── Nueva conversación ── */
btnNewChat.addEventListener('click', function() {
  messages = [];
  currentConvId = null;
  chatContainer.innerHTML = '';
  chatContainer.appendChild(makeWelcome());
  sidebarScroll.querySelectorAll('.conv-item').forEach(function(i) { i.classList.remove('active'); });
  if (isMobile()) closeSidebar();
  userInput.focus();
});

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

/* ── Enviar mensaje ── */
async function sendMessage() {
  var text = userInput.value.trim();
  if (!text || isStreaming) return;

  var ws = document.getElementById('welcomeState');
  if (ws) ws.remove();

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
  var tO = '<tool_call>', tC = '';
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