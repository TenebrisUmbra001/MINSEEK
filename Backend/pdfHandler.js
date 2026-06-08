// Backend/pdfHandler.js
const fs = require('fs');
const log = require('./modelManager').log;

// ═══════════════════════════════════════════════════
// 1) pdf-parse (wrapper de pdfjs que YA configura el worker)
// ═══════════════════════════════════════════════════
let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  log.error('❌ No se pudo cargar pdf-parse. Ejecutá: npm install pdf-parse');
}

// ═══════════════════════════════════════════════════
// 2) OCR con tesseract.js (para PDFs escaneados)
// ═══════════════════════════════════════════════════
let tesseract;
try {
  tesseract = require('tesseract.js');
} catch (e) {
  log.warn('⚠️ tesseract.js no instalado. OCR no disponible. npm install tesseract.js');
}

// ═══════════════════════════════════════════════════
// 3) pdfjs-dist con WORKER configurado (para render → OCR)
// ═══════════════════════════════════════════════════
let pdfjsLib;
try {
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
  const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
  log.info('✅ pdfjs-dist con worker configurado');
} catch (e1) {
  try {
    pdfjsLib = require('pdfjs-dist/build/pdf');
    try {
      const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.js');
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
    } catch (wErr) {
      // Worker no encontrado, usar fake worker
      log.warn('⚠️ pdfjs-dist worker no encontrado, usando fake worker');
    }
  } catch (e2) {
    log.warn('⚠️ pdfjs-dist no disponible para render');
  }
}

// ═══════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ═══════════════════════════════════════════════════

function esPDFValido(buffer) {
  if (!buffer || buffer.length === 0) return false;
  return buffer.slice(0, 5).toString() === '%PDF-';
}

function limpiarTextoPDF(text) {
  if (!text) return '';
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/ {3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n')
    .replace(/^ +/gm, '')
    .trim();
}

// ═══════════════════════════════════════════════════
// MÉTODO 1: pdf-parse (el más simple y confiable)
// ═══════════════════════════════════════════════════
async function extraerConPdfParse(buffer, filename) {
  if (!pdfParse) return null;

  try {
    const data = await pdfParse(buffer);

    log.info(`📄 [pdf-parse] ${filename}: ${data.numpages} páginas, ${data.text.length} chars`);

    if (data.text && data.text.trim().length > 10) {
      return {
        text: limpiarTextoPDF(data.text),
        pages: data.numpages,
        method: 'pdf-parse',
        warning: null
      };
    }

    // Texto insuficiente → probablemente escaneado
    log.warn(`⚠️ [pdf-parse] ${filename}: ${data.numpages} páginas pero solo ${data.text.trim().length} chars de texto → PDF ESCANEADO`);
    return null;

  } catch (err) {
    log.error(`❌ [pdf-parse] Error en ${filename}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// MÉTODO 2: pdfjs-dist directo (con worker)
// ═══════════════════════════════════════════════════
async function extraerConPdfjs(buffer, filename) {
  if (!pdfjsLib) return null;

  try {
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      verbosity: 0  // Silenciar warnings internos
    }).promise;

    const numPages = doc.numPages;
    let fullText = '';
    let totalItems = 0;
    let itemsConTexto = 0;

    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();

      let pageText = '';
      let lastY = null;

      if (textContent && textContent.items) {
        for (const item of textContent.items) {
          totalItems++;

          if (!item || item.str === undefined || item.str === null) continue;
          if (item.str.trim() === '') continue;

          itemsConTexto++;

          // Reconstruir saltos de línea basados en posición Y
          if (lastY !== null && item.transform && item.transform[5] !== undefined) {
            const currentY = item.transform[5];
            if (Math.abs(currentY - lastY) > 2) {
              pageText += '\n';
            } else {
              const lastChar = pageText.length > 0 ? pageText[pageText.length - 1] : '';
              const firstChar = item.str[0];
              if (lastChar !== ' ' && lastChar !== '\n' && firstChar !== ' ') {
                pageText += ' ';
              }
            }
          }

          pageText += item.str;

          if (item.transform && item.transform[5] !== undefined) {
            lastY = item.transform[5];
          }
        }
      }

      fullText += pageText + '\n\n';
    }

    fullText = fullText.trim();

    log.info(`📄 [pdfjs-dist] ${filename}: ${numPages} páginas, ${totalItems} items, ${itemsConTexto} con texto, ${fullText.length} chars`);

    if (fullText.length > 10) {
      return {
        text: limpiarTextoPDF(fullText),
        pages: numPages,
        method: 'pdfjs-dist',
        warning: null
      };
    }

    return null;

  } catch (err) {
    log.error(`❌ [pdfjs-dist] Error en ${filename}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// MÉTODO 3: OCR con tesseract.js (para PDFs escaneados)
// ═══════════════════════════════════════════════════
async function extraerConOCR(buffer, filename) {
  if (!pdfjsLib || !tesseract) {
    log.warn('⚠️ OCR no disponible (falta pdfjs-dist o tesseract.js)');
    return null;
  }

  // Canvas para Node.js
  let canvasModule;
  try {
    canvasModule = require('canvas');
  } catch (e) {
    log.warn('⚠️ Módulo "canvas" no instalado. Renderizado no disponible. npm install canvas');
    return null;
  }

  try {
    log.info(`🔍 [OCR] ${filename}: Iniciando OCR para PDF escaneado...`);

    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      verbosity: 0
    }).promise;

    const numPages = doc.numPages;
    let fullText = '';
    const MAX_PAGES_OCR = 20; // Limitar páginas para no demorar eternamente

    const worker = await tesseract.createWorker('spa+eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          // Progreso silencioso (no inundar el log)
        }
      }
    });

    const pagesToProcess = Math.min(numPages, MAX_PAGES_OCR);

    for (let i = 1; i <= pagesToProcess; i++) {
      try {
        const page = await doc.getPage(i);
        
        // Renderizar a imagen (escala para calidad de OCR)
        const scale = 2.0; // 2x para mejor calidad de OCR
        const viewport = page.getViewport({ scale });
        
        const canvas = canvasModule.createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;

        // Convertir canvas a buffer de imagen
        const imageBuffer = canvas.toBuffer('image/png');

        // OCR sobre la imagen
        const { data: { text } } = await worker.recognize(imageBuffer);
        
        if (text && text.trim().length > 0) {
          fullText += text + '\n\n';
        }

        log.info(`🔍 [OCR] ${filename} página ${i}/${pagesToProcess}: ${text.trim().length} chars`);

      } catch (pageErr) {
        log.warn(`⚠️ [OCR] Error en página ${i}: ${pageErr.message}`);
      }
    }

    await worker.terminate();

    fullText = fullText.trim();

    if (numPages > MAX_PAGES_OCR) {
      log.info(`🔍 [OCR] ${filename}: Procesadas ${MAX_PAGES_OCR}/${numPages} páginas (límite)`);
    }

    log.info(`🔍 [OCR] ${filename}: ${pagesToProcess} páginas procesadas, ${fullText.length} chars`);

    if (fullText.length > 10) {
      return {
        text: limpiarTextoPDF(fullText),
        pages: numPages,
        method: 'ocr-tesseract',
        warning: numPages > MAX_PAGES_OCR 
          ? `OCR aplicado a las primeras ${MAX_PAGES_OCR} de ${numPages} páginas.` 
          : null
      };
    }

    return null;

  } catch (err) {
    log.error(`❌ [OCR] Error en ${filename}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// MÉTODO 4: Extracción bruta (último recurso)
// ═══════════════════════════════════════════════════
function extraerTextoBrutoPDF(buffer) {
  const text = buffer.toString('latin1');
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let combined = '';
  let match;

  while ((match = streamRegex.exec(text)) !== null) {
    const streamContent = match[1];

    // Tj operator
    const textParts = streamContent.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*Tj/g);
    if (textParts) {
      for (const part of textParts) {
        const extracted = part.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/);
        if (extracted && extracted[1]) {
          combined += extracted[1]
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '')
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')');
        }
      }
    }

    // TJ operator
    const tjParts = streamContent.match(/\[([^\]]*\([^\]]*\)[^\]]*)\]\s*TJ/g);
    if (tjParts) {
      for (const part of tjParts) {
        const strings = part.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/g);
        if (strings) {
          for (const s of strings) {
            const cleaned = s.slice(1, -1)
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '');
            combined += cleaned;
          }
          combined += ' ';
        }
      }
    }
  }

  return combined
    .replace(/[^\x20-\x7E\n\ráéíóúüñÁÉÍÓÚÜÑ¿¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: Pipeline de extracción
// ═══════════════════════════════════════════════════
async function extraerTextoPDF(buffer, filename) {
  // Validación básica
  if (!esPDFValido(buffer)) {
    return {
      text: '',
      pages: 0,
      method: 'none',
      warning: 'No es un archivo PDF válido'
    };
  }

  log.info(`📄 [PDF] ${filename}: Iniciando extracción...`);

  // ── PASO 1: pdf-parse (rápido, confiable) ──
  const result1 = await extraerConPdfParse(buffer, filename);
  if (result1 && result1.text.length > 0) return result1;

  // ── PASO 2: pdfjs-dist directo (con worker) ──
  const result2 = await extraerConPdfjs(buffer, filename);
  if (result2 && result2.text.length > 0) return result2;

  // ── PASO 3: Extracción bruta ──
  try {
    const rawText = extraerTextoBrutoPDF(buffer);
    if (rawText.length > 50) {
      log.info(`📄 [raw] ${filename}: ${rawText.length} chars extraídos`);
      return {
        text: limpiarTextoPDF(rawText),
        pages: -1,
        method: 'raw-extraction',
        warning: 'PDF parseado con método bruto.'
      };
    }
  } catch (err) {
    log.error(`❌ [raw] Extracción bruta falló: ${err.message}`);
  }

  // ── PASO 4: OCR (para PDFs escaneados) ──
  const result4 = await extraerConOCR(buffer, filename);
  if (result4 && result4.text.length > 0) return result4;

  // ── NADA FUNCIONÓ ──
  log.error(`❌ [PDF] ${filename}: Todos los métodos fallaron`);
  return {
    text: '',
    pages: 0,
    method: 'failed',
    warning: 'No se pudo extraer texto. El PDF puede ser escaneado (instalá tesseract.js y canvas para OCR).'
  };
}

module.exports = { extraerTextoPDF, limpiarTextoPDF };