// Backend/modelManager.js
const fetch = global.fetch || require('node-fetch');
const crypto = require('crypto');

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const log = {
  info: (...args) => console.log(new Date().toISOString(), 'ℹ️', ...args),
  warn: (...args) => console.warn(new Date().toISOString(), '⚠️', ...args),
  error: (...args) => console.error(new Date().toISOString(), '❌', ...args)
};

// --- Copia aquí tu configuración de modelos, límites y context windows ---
const modelos = {
  router: ["qwen2.5:1.5b"],
  consulta_rapida: ["qwen2.5:3b", "llama3.2:1b", "phi3:mini"],
  resumen: ["qwen2.5:14b", "qwen2.5:3b"],
  redaccion: ["qwen2.5:14b", "llama3.1:8b"],
  razonamiento: ["deepseek-r1:7b", "deepseek-r1:14b"],
  codigo: ["codeqwen:7b", "qwen2.5:3b"],
  multimodal: ["llava:7b", "llava:13b"]
};

const modelLimits = {
  "qwen2.5:1.5b": 4, "phi3:mini": 3, "llama3.2:1b": 3,
  "qwen2.5:3b": 2, "deepseek-r1:1.5b": 2,
  "llama3.1:8b": 1, "deepseek-r1:7b": 1, "codeqwen:7b": 1,
  "qwen2.5:14b": 1, "deepseek-r1:14b": 1,
  "llava:7b": 1, "llava:13b": 1, "starcoder2:3b": 1
};

const maxCtxPorModelo = {
  "qwen2.5:1.5b": 32768, "phi3:mini": 3840, "deepseek-r1:1.5b": 8192,
  "llama3.2:1b": 8192, "qwen2.5:3b": 32768, "llama3.1:8b": 8192,
  "deepseek-r1:7b": 16384, "deepseek-r1:14b": 16384, "qwen2.5:14b": 32768,
  "codeqwen:7b": 16384, "starcoder2:3b": 16384, "llava:7b": 4096, "llava:13b": 4096
};

class ConcurrencyLimiter {
  constructor(limit) { this.limit = limit; this.running = 0; this.queue = []; }
  acquire() { return new Promise((resolve) => { if (this.running < this.limit) { this.running++; resolve(); } else { this.queue.push(resolve); } }); }
  tryAcquire() { if (this.running < this.limit) { this.running++; return true; } return false; }
  release() { this.running--; if (this.queue.length > 0) { this.running++; this.queue.shift()(); } }
}

const modelLimiters = {};
for (const name in modelLimits) modelLimiters[name] = new ConcurrencyLimiter(modelLimits[name]);

function calcularNumCtx(text, minCtx, maxCtx) {
  var estimatedTokens = Math.ceil((text || '').length / 3);
  var calculatedCtx = estimatedTokens + 1024;
  return Math.min(Math.max(calculatedCtx, minCtx || 4096), maxCtx || 32768);
}

function validarYAdjustarNumCtx(modelo, numCtx) {
  var limiteReal = maxCtxPorModelo[modelo] || 4096;
  if (numCtx > limiteReal + 50) {
    log.warn(`⚠️ [CTX] numCtx solicitado (${numCtx}) excede límite de ${modelo} (${limiteReal}). Ajustando a ${limiteReal}.`);
    return limiteReal;
  }
  if (numCtx > limiteReal) {
    log.info(`ℹ️ [CTX] numCtx (${numCtx}) dentro de tolerancia (+50) para ${modelo}. Ajustando a ${limiteReal}.`);
    return limiteReal;
  }
  return numCtx;
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
    if (modelLimiters[n] && modelLimiters[n].tryAcquire()) return n;
  }
  await modelLimiters[m[0]].acquire();
  return m[0];
}

async function usarModelo(categoria, prompt, opts) {
  opts = opts || {};
  const modelo = await obtenerYAdquirirModelo(categoria);
  const limiter = modelLimiters[modelo];

  var numCtx = opts.num_ctx || calcularNumCtx(prompt, 4096, 32768);
  numCtx = validarYAdjustarNumCtx(modelo, numCtx);

  log.info(`🧠 [MODELO] Categoría: ${categoria} → Modelo: ${modelo} | num_ctx: ${numCtx} | prompt_len: ${String(prompt).length}`);

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
    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Error en llamada a modelo: ' + errText);
    }
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

// --- Función para llamar Groq (chat completions estilo OpenAI) ---
async function usarGroq(prompt, model = 'llama-3.3-70b-versatile', opts = {}) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY no configurada en el entorno');
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false
  };
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  const res = await fetch(`${GROQ_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Groq API error: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
}

module.exports = {
  modelos,
  modelLimits,
  maxCtxPorModelo,
  modelLimiters,
  calcularNumCtx,
  validarYAdjustarNumCtx,
  cerrarModelo,
  obtenerYAdquirirModelo,
  usarModelo,
  usarGroq,
  log
};
