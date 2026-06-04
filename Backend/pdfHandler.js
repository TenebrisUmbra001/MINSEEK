// Backend/pdfHandler.js
const fs = require('fs');
const log = require('./modelManager').log;

// ✅ FIX: Importar pdf-parse evitando el bug del archivo de test
let pdfParse;
try {
  // Intentar importar la versión que no carga tests
  pdfParse = require('pdf-parse/lib/pdf-parse.js');
} catch (e) {
  try {
    pdfParse = require('pdf-parse');
  } catch (e2) {
    log.error('❌ No se pudo cargar pdf-parse:', e2.message);
    pdfParse = null;
  }
}

/**
 * Extraer texto de un PDF con diagnóstico completo
 * @param {Buffer} buffer - Buffer del archivo PDF
 * @param {string} filename - Nombre del archivo (para logs)
 * @returns {{ text: string, pages: number, method: string, warning: string|null }}
 */
async function extraerTextoPDF(buffer, filename) {
  if (!pdfParse) {
    return {
      text: '',
      pages: 0,
      method: 'none',
      warning: 'pdf-parse no está disponible. Instalá: npm install pdf-parse'
    };
  }

  if (!buffer || buffer.length === 0) {
    return { text: '', pages: 0, method: 'none', warning: 'Buffer vacío' };
  }

  // Verificar que es un PDF real (magic bytes)
  const header = buffer.slice(0, 5).toString();
  if (header !== '%PDF-') {
    log.warn(`⚠️ [PDF] ${filename} no tiene header %PDF- válido. Header: "${header}"`);
    return { text: '', pages: 0, method: 'none', warning: 'No es un archivo PDF válido' };
  }

  try {
    // ✅ Opciones para manejar PDFs grandes y complejos
    const options = {
      maxPages: 500,           // Limitar páginas para no colgar
      pagerender: renderPage,  // Función custom de renderizado
    };

    const data = await pdfParse(buffer, options);

    let text = (data.text || '').trim();
    const pages = data.numpages || 0;

    log.info(`📄 [PDF] ${filename}: ${pages} páginas, ${text.length} chars extraídos`);

    // ✅ DIAGNÓSTICO: Detectar PDF escaneado (imagen sin texto)
    if (text.length === 0 && pages > 0) {
      log.warn(`⚠️ [PDF] ${filename}: ${pages} páginas pero 0 texto → PDF ESCANEADO (imagen)`);
      return {
        text: '',
        pages,
        method: 'pdf-parse',
        warning: `PDF escaneado (${pages} páginas sin capa de texto). Necesitás OCR para extraer el contenido. Convertí el PDF a texto antes de subirlo, o usá un PDF con capa de texto seleccionable.`
      };
    }

    // ✅ DIAGNÓSTICO: Detectar texto sospechosamente corto
    if (text.length > 0 && text.length < pages * 10) {
      log.warn(`⚠️ [PDF] ${filename}: Texto muy corto (${text.length} chars para ${pages} páginas) → Posible PDF parcialmente escaneado`);
      return {
        text,
        pages,
        method: 'pdf-parse',
        warning: `PDF con poco texto extraíble (${text.length} chars en ${pages} páginas). Puede que parte del contenido sea imagen.`
      };
    }

    // Limpiar texto extraído
    text = limpiarTextoPDF(text);

    return {
      text,
      pages,
      method: 'pdf-parse',
      warning: text.length > 0 ? null : 'No se pudo extraer texto del PDF'
    };

  } catch (err) {
    log.error(`❌ [PDF] Error parseando ${filename}:`, err.message);

    // ✅ FALLBACK: Intentar extracción bruta si pdf-parse falla
    try {
      const rawText = extraerTextoBrutoPDF(buffer);
      if (rawText.length > 50) {
        log.info(`📄 [PDF] ${filename}: Extracción bruta obtuvo ${rawText.length} chars`);
        return {
          text: limpiarTextoPDF(rawText),
          pages: -1,
          method: 'raw-extraction',
          warning: 'PDF parseado con método alternativo. Puede contener errores.'
        };
      }
    } catch (rawErr) {
      log.error(`❌ [PDF] Extracción bruta también falló:`, rawErr.message);
    }

    return {
      text: '',
      pages: 0,
      method: 'failed',
      warning: `Error al leer PDF: ${err.message}`
    };
  }
}

/**
 * Función custom de renderizado de página para pdf-parse
 * Captura más texto que el render por defecto
 */
function renderPage(pageData) {
  const renderOptions = {
    normalizeWhitespace: true,
    disableCombineTextItems: false
  };

  return pageData.getTextContent(renderOptions)
    .then(function(textContent) {
      let text = '';
      let lastY = null;

      if (textContent && textContent.items) {
        for (const item of textContent.items) {
          if (item.str === undefined) continue;

          // Detectar salto de línea por cambio de posición Y
          if (lastY !== null && item.transform && item.transform[5] !== undefined) {
            const currentY = item.transform[5];
            if (Math.abs(currentY - lastY) > 2) {
              text += '\n';
            }
          }

          text += item.str;

          if (item.transform && item.transform[5] !== undefined) {
            lastY = item.transform[5];
          }
        }
      }

      return text;
    })
    .catch(() => '');
}

/**
 * Extracción bruta de texto cuando pdf-parse falla
 * Busca streams de texto entre BT...ET en el PDF
 */
function extraerTextoBrutoPDF(buffer) {
  const text = buffer.toString('latin1');

  // Buscar streams de texto
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let combined = '';
  let match;

  while ((match = streamRegex.exec(text)) !== null) {
    const streamContent = match[1];
    // Buscar texto entre paréntesis en operadores Tj, TJ, ', "
    const textParts = streamContent.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*Tj/g);
    if (textParts) {
      for (const part of textParts) {
        const extracted = part.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/);
        if (extracted && extracted[1]) {
          combined += extracted[1].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
        }
      }
    }

    // Buscar arrays de texto TJ
    const tjParts = streamContent.match(/\[([^\]]*\([^\]]*\)[^\]]*)\]\s*TJ/g);
    if (tjParts) {
      for (const part of tjParts) {
        const strings = part.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/g);
        if (strings) {
          for (const s of strings) {
            const cleaned = s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '');
            combined += cleaned;
          }
          combined += ' ';
        }
      }
    }
  }

  // Filtrar caracteres no legibles
  combined = combined.replace(/[^\x20-\x7E\n\ráéíóúüñÁÉÍÓÚÜÑ¿¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return combined;
}

/**
 * Limpiar texto extraído de PDF
 */
function limpiarTextoPDF(text) {
  if (!text) return '';

  return text
    // Eliminar caracteres nulos y de control
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalizar espacios múltiples
    .replace(/ {3,}/g, '  ')
    // Normalizar saltos de línea múltiples
    .replace(/\n{4,}/g, '\n\n')
    // Eliminar espacios al inicio de línea
    .replace(/^ +/gm, '')
    .trim();
}

module.exports = { extraerTextoPDF, limpiarTextoPDF };