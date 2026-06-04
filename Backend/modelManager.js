// Backend/modelManager.js
const fetch = global.fetch || require('node-fetch');

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

const log = {
  info: (...args) => console.log(new Date().toISOString(), 'ℹ️', ...args),
  warn: (...args) => console.warn(new Date().toISOString(), '⚠️', ...args),
  error: (...args) => console.error(new Date().toISOString(), '❌', ...args)
};

// ============================================================================
// ESTRATEGIA HOT/COLD
// ============================================================================
// HOT  = Siempre en VRAM, a ellos se ruteará por defecto (~14.5GB total)
// COLD = Solo se cargan bajo demanda (multimodal)
// ============================================================================

const MODELOS_CALIENTES = {
  rapido:       "qwen2.5:3b",         // ~2GB   - Consultas, router fallback
  razonamiento: "deepseek-r1:7b",      // ~4.5GB - Lógica, análisis, código
  potente:      "qwen2.5:14b",         // ~8GB   - Resumen, redacción, docs
};

const MODELOS_FRIOS = {
  multimodal: "llava:7b",              // Solo para imágenes
  router:     "qwen2.5:1.5b",          // Solo si keywords no detectan categoría
};

const MAPEO_CATEGORIA_MODELO = {
  consulta_rapida: MODELOS_CALIENTES.rapido,
  resumen:         MODELOS_CALIENTES.potente,
  redaccion:       MODELOS_CALIENTES.potente,
  razonamiento:    MODELOS_CALIENTES.razonamiento,
  codigo:          MODELOS_CALIENTES.razonamiento,
  multimodal:      MODELOS_FRIOS.multimodal,
};

// ============================================================================
// CONCURRENCIA — Más slots porque los modelos PERMANECEN en VRAM
// ============================================================================
const modelLimits = {
  [MODELOS_CALIENTES.rapido]:       6,   // 6 consultas rápidas simultáneas
  [MODELOS_CALIENTES.razonamiento]: 3,   // 3 razonamientos simultáneos
  [MODELOS_CALIENTES.potente]:      2,   // 2 resúmenes/redacciones simultáneos
  [MODELOS_FRIOS.multimodal]:       1,   // 1 imagen a la vez
  [MODELOS_FRIOS.router]:           4,   // 4 llamadas al router
};

const maxCtxPorModelo = {
  [MODELOS_CALIENTES.rapido]:       32768,
  [MODELOS_CALIENTES.razonamiento]: 16384,
  [MODELOS_CALIENTES.potente]:      32768,
  [MODELOS_FRIOS.multimodal]:       4096,
  [MODELOS_FRIOS.router]:           32768,
};

// Keep alive: cuánto permanece el modelo en VRAM sin uso
const KEEP_ALIVE_CALIENTE = process.env.KEEP_ALIVE_CALIENTE || "10m";
const KEEP_ALIVE_FRIO     = process.env.KEEP_ALIVE_FRIO     || "3m";

// ============================================================================
// SEMÁFORO DE CONCURRENCIA
// ============================================================================
class ConcurrencyLimiter {
  constructor(limit) { this.limit = limit; this.running = 0; this.queue = []; }
  acquire() {
    return new Promise((resolve) => {
      if (this.running < this.limit) { this.running++; resolve(); }
      else { this.queue.push(resolve); }
    });
  }
  tryAcquire() {
    if (this.running < this.limit) { this.running++; return true; }
    return false;
  }
  release() {
    this.running--;
    if (this.queue.length > 0) { this.running++; this.queue.shift()(); }
  }
  get available() { return this.limit - this.running; }
  get queued() { return this.queue.length; }
}

const modelLimiters = {};
for (const name in modelLimits) {
  modelLimiters[name] = new ConcurrencyLimiter(modelLimits[name]);
}

// ============================================================================
// VERIFICACIÓN DE INTERNET + GROQ
// ============================================================================
let internetYGroqDisponible = false;
let ultimoCheckInternet = 0;
const INTERNET_CHECK_INTERVAL = 60000; // Revisar cada 1 minuto

async function verificarInternetYGroq() {
  if (!GROQ_API_KEY) return false;

  const ahora = Date.now();
  if (ahora - ultimoCheckInternet < INTERNET_CHECK_INTERVAL) {
    return internetYGroqDisponible;
  }
  ultimoCheckInternet = ahora;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${GROQ_API_BASE}/models`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      signal: controller.signal
    });
    clearTimeout(timeout);
    internetYGroqDisponible = response.ok;
  } catch {
    internetYGroqDisponible = false;
  }

  if (internetYGroqDisponible) log.info('🌐 Internet + Groq disponibles');
  else log.info('📴 Internet/Groq no disponibles → solo modelos locales');

  return internetYGroqDisponible;
}

// ============================================================================
// CTX HELPERS
// ============================================================================
function calcularNumCtx(text, minCtx, maxCtx) {
  var estimatedTokens = Math.ceil((text || '').length / 3);
  var calculatedCtx = estimatedTokens + 1024;
  return Math.min(Math.max(calculatedCtx, minCtx || 4096), maxCtx || 32768);
}

function validarYAdjustarNumCtx(modelo, numCtx) {
  var limiteReal = maxCtxPorModelo[modelo] || 4096;
  if (numCtx > limiteReal) return limiteReal;
  return numCtx;
}

// ============================================================================
// CATEGORIZACIÓN POR KEYWORDS (instantáneo, 0 latencia, 0 VRAM)
// ============================================================================
function categorizarPorKeywords(prompt) {
  const p = (prompt || '').toLowerCase();

  const patrones = [
    {
      categoria: 'multimodal',
      keywords: ['imagen', 'foto', 'gráfico', 'figura', 'diagrama',
        'describe la imagen', 'qué ves en', 'qué muestra',
        'analiza la imagen', 'observa la imagen', 'captura de pantalla',
        'screenshot', 'ver en la imagen']
    },
    {
      categoria: 'codigo',
      keywords: ['código', 'función', 'programa', 'script', 'debug',
        'python', 'javascript', 'api', 'html', 'css', 'sql',
        'variable', 'array', 'loop', 'class ', 'def ', 'function ',
        'import ', 'async', 'await', 'nodejs', 'react', 'git',
        'compilar', 'refactorizar', 'cómo implementar', 'programar',
        'algoritmo', 'bug', 'syntax error', 'código fuente',
        'error en mi código', 'query', 'stored procedure']
    },
    {
      categoria: 'razonamiento',
      keywords: [
        'razona', 'razonamiento', 'analiza', 'análisis', 'lógica', 'lógico',
        'deduce', 'inferir', 'resolver', 'problema matemát', 'calcular',
        'ecuación', 'demuestra', 'prueba que', 'explica por qué',
        'compara y contrasta', 'evalúa', 'critica', 'argumenta', 'filosof',
        'paradoja', 'contradicción', 'hipótesis', 'teorema',
        'paso a paso', 'piensa paso', 'think step', 'razonamiento lógico',
        'análisis crítico', 'resolver el siguiente', 'estrategia',
        'solución óptima', 'cuál es la mejor', 'justifica',
        'qué pasaría si', 'qué sucedería', 'implicaciones', 'consecuencias',
        'pros y contras', 'ventajas y desventajas', 'analiza este caso',
        'analiza esta situación', 'profundiza', 'profundo',
        'reflexiona', 'reflexión', 'deducción', 'inducción',
        'razonar', 'pensamiento crítico', 'discute', 'debate']
    },
    {
      categoria: 'resumen',
      keywords: ['resum', 'sintetiz', 'extrae los puntos', 'haz un resumen',
        'resume este', 'resumen de', 'tl;dr', 'tl dr',
        'idea principal', 'puntos clave', 'key points', 'summarize',
        'abstract', 'sintetizar', 'en resumen', 'en síntesis',
        'conclusiones de', 'hazme un resumen', 'resumir']
    },
    {
      categoria: 'redaccion',
      keywords: ['escrib', 'redact', 'crea un texto', 'genera un', 'compose',
        'ensayo', 'artículo', 'carta', 'correo', 'poema', 'cuento',
        'historia', 'narrativa', 'blog', 'escribir', 'redactar',
        'borrador', 'draft', 'elabora un texto', 'propón un',
        'redacción', 'propuesta de texto', 'genera contenido']
    },
  ];

  let mejorCategoria = null;
  let mejorPuntaje = 0;

  for (const patron of patrones) {
    let puntaje = 0;
    for (const kw of patron.keywords) {
      if (p.includes(kw)) puntaje++;
    }
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejorCategoria = patron.categoria;
    }
  }

  return mejorPuntaje >= 1 ? mejorCategoria : null;
}

// ============================================================================
// ROUTER COMPLETO: Keywords → Modelo router → Fallback
// ============================================================================
async function categorizar(prompt) {
  // PASO 1: Keywords (instantáneo, 0 latencia)
  const kw = categorizarPorKeywords(prompt);
  if (kw) {
    log.info(`🔑 [ROUTER] Keywords → ${kw}`);
    return kw;
  }

  // PASO 2: Modelo router pequeño (solo si keywords no detectaron)
  const modeloRouter = MODELOS_FRIOS.router;
  const limiter = modelLimiters[modeloRouter];
  await limiter.acquire();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: modeloRouter,
        prompt: `Clasifica esta tarea en EXACTAMENTE UNA de estas categorías: consulta_rapida, resumen, redaccion, razonamiento, codigo, multimodal. Solo responde con la categoría, nada más.\n\nTarea: ${prompt}`,
        stream: false,
        keep_alive: KEEP_ALIVE_FRIO
      })
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error('Router falló');
    const data = await response.json();

    // ✅ MATCHING ROBUSTO: buscar categoría dentro del texto (NO regex destructivo)
    let texto = (data.response || '').trim().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const categoriasValidas = [
      'consulta_rapida', 'resumen', 'redaccion',
      'razonamiento', 'codigo', 'multimodal'
    ];

    // Buscar con underscore
    for (const cat of categoriasValidas) {
      if (texto.includes(cat)) {
        log.info(`🎯 [ROUTER] Modelo → ${cat} (de: "${texto}")`);
        return cat;
      }
    }

    // Buscar sin underscore / variantes
    const variantes = {
      'consulta rapida': 'consulta_rapida', 'consulta': 'consulta_rapida',
      'resumen': 'resumen', 'resumir': 'resumen',
      'redaccion': 'redaccion', 'escritura': 'redaccion',
      'razonamiento': 'razonamiento', 'logica': 'razonamiento',
      'codigo': 'codigo', 'programacion': 'codigo', 'code': 'codigo',
      'multimodal': 'multimodal', 'imagen': 'multimodal'
    };

    for (const [key, value] of Object.entries(variantes)) {
      if (texto.includes(key)) {
        log.info(`🎯 [ROUTER] Modelo → ${value} (de: "${texto}")`);
        return value;
      }
    }

    // Fallback heurístico
    const fallback = prompt.length > 300 ? 'razonamiento' : 'consulta_rapida';
    log.warn(`⚠️ [ROUTER] No detectado en "${texto}". Fallback → ${fallback}`);
    return fallback;

  } catch (err) {
    clearTimeout(timeout);
    const fallback = prompt.length > 300 ? 'razonamiento' : 'consulta_rapida';
    log.warn(`⚠️ [ROUTER] Error: ${err.message}. Fallback → ${fallback}`);
    return fallback;
  } finally {
    limiter.release();
  }
}

// ============================================================================
// ADQUIRIR MODELO LOCAL
// ============================================================================
async function obtenerYAdquirirModelo(categoria) {
  const modelo = MAPEO_CATEGORIA_MODELO[categoria];
  if (!modelo) throw new Error('Categoría no encontrada: ' + categoria);

  const limiter = modelLimiters[modelo];
  if (!limiter) throw new Error('Sin limiter para modelo: ' + modelo);

  if (limiter.tryAcquire()) {
    log.info(`✅ [MODELO] ${modelo} adquirido para "${categoria}" (libres: ${limiter.available}, cola: ${limiter.queued})`);
    return modelo;
  }

  log.info(`⏳ [MODELO] ${modelo} ocupado para "${categoria}" (cola: ${limiter.queued}). Esperando...`);
  await limiter.acquire();
  log.info(`✅ [MODELO] ${modelo} adquirido tras espera para "${categoria}"`);
  return modelo;
}

// ============================================================================
// USAR MODELO LOCAL (Ollama, no-streaming)
// ============================================================================
async function usarModelo(categoria, prompt, opts) {
  opts = opts || {};
  const modelo = await obtenerYAdquirirModelo(categoria);
  const limiter = modelLimiters[modelo];
  const esFrio = Object.values(MODELOS_FRIOS).includes(modelo);
  const keepAlive = esFrio ? KEEP_ALIVE_FRIO : KEEP_ALIVE_CALIENTE;

  var numCtx = opts.num_ctx || calcularNumCtx(prompt, 4096, 32768);
  numCtx = validarYAdjustarNumCtx(modelo, numCtx);

  log.info(`🧠 [OLLAMA] ${modelo} | cat: ${categoria} | ctx: ${numCtx} | chars: ${prompt.length}`);

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
        keep_alive: keepAlive,
        options: {
          num_ctx: numCtx,
          temperature: opts.temperature !== undefined ? opts.temperature : 0.7
        }
      })
    });

    clearTimeout(timeout);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error('Error en modelo: ' + errText);
    }
    const data = await response.json();
    return data.message?.content || '';
  } catch (err) {
    clearTimeout(timeout);
    await cerrarModelo(modelo); // Solo cerrar en ERROR
    throw err;
  } finally {
    limiter.release();
  }
}

// ============================================================================
// GROQ (API remota, no-streaming)
// Solo se usa para razonamiento profundo con internet
// ============================================================================
async function usarGroq(prompt, model, opts) {
  opts = opts || {};
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY no configurada');

  const groqDisponible = await verificarInternetYGroq();
  if (!groqDisponible) throw new Error('Groq no disponible (sin internet)');

  const body = {
    model: model || 'deepseek-r1-distill-llama-70b',
    messages: [{ role: 'user', content: prompt }],
    stream: false
  };
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;

  log.info(`🌐 [GROQ] Modelo: ${body.model} | chars: ${prompt.length}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${GROQ_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify(body)
    });

    clearTimeout(timeout);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq API error: ${res.status} ${txt}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ============================================================================
// MODELO INTELIGENTE: Groq para razonamiento profundo, local para lo demás
// ============================================================================
async function usarModeloInteligente(categoria, prompt, opts) {
  // Para razonamiento: intentar Groq primero si hay internet
  if (categoria === 'razonamiento') {
    const groqDisponible = await verificarInternetYGroq();
    if (groqDisponible) {
      try {
        log.info('🌐 [INTELIGENTE] Razonamiento profundo con Groq...');
        return await usarGroq(prompt, 'deepseek-r1-distill-llama-70b', opts);
      } catch (e) {
        log.warn(`⚠️ [INTELIGENTE] Groq falló, usando local: ${e.message}`);
      }
    }
  }

  // Fallback a local SIEMPRE
  return usarModelo(categoria, prompt, opts);
}

// ============================================================================
// CERRAR MODELO (solo para errores / limpieza manual)
// ============================================================================
async function cerrarModelo(nombreModelo) {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: nombreModelo, prompt: '', keep_alive: 0 })
    });
  } catch (err) { /* ignore */ }
}

// ============================================================================
// PRECALENTAMIENTO: Cargar modelos calientes al arrancar
// ============================================================================
async function precalentarModelos() {
  log.info('🔥 [PREHEAT] Precalentando modelos calientes en VRAM...');

  for (const [rol, modelo] of Object.entries(MODELOS_CALIENTES)) {
    try {
      log.info(`🔥 [PREHEAT] Cargando ${modelo} (${rol})...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      const response = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelo,
          prompt: 'ok',
          stream: false,
          keep_alive: KEEP_ALIVE_CALIENTE
        })
      });

      clearTimeout(timeout);
      if (response.ok) log.info(`✅ [PREHEAT] ${modelo} cargado y listo`);
      else log.warn(`⚠️ [PREHEAT] Error cargando ${modelo}: ${response.status}`);
    } catch (err) {
      log.warn(`⚠️ [PREHEAT] No se pudo cargar ${modelo}: ${err.message}`);
    }
  }

  log.info('🔥 [PREHEAT] Precalentamiento completado');
}

// ============================================================================
// ESTADO DEL SISTEMA
// ============================================================================
function obtenerEstado() {
  const colas = {};
  for (const [modelo, limiter] of Object.entries(modelLimiters)) {
    colas[modelo] = {
      running: limiter.running,
      available: limiter.available,
      queued: limiter.queued,
      limite: limiter.limit
    };
  }
  return {
    modelosCalientes: MODELOS_CALIENTES,
    modelosFrios: MODELOS_FRIOS,
    mapeo: MAPEO_CATEGORIA_MODELO,
    colas,
    groqDisponible: internetYGroqDisponible,
    groqKeyConfigurada: !!GROQ_API_KEY
  };
}

module.exports = {
  MODELOS_CALIENTES,
  MODELOS_FRIOS,
  MAPEO_CATEGORIA_MODELO,
  modelLimits,
  maxCtxPorModelo,
  modelLimiters,
  KEEP_ALIVE_CALIENTE,
  KEEP_ALIVE_FRIO,
  OLLAMA_BASE,
  GROQ_API_BASE,
  GROQ_API_KEY,
  calcularNumCtx,
  validarYAdjustarNumCtx,
  cerrarModelo,
  obtenerYAdquirirModelo,
  usarModelo,
  usarGroq,
  usarModeloInteligente,
  categorizar,
  categorizarPorKeywords,
  verificarInternetYGroq,
  precalentarModelos,
  obtenerEstado,
  log
};