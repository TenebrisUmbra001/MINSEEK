// Backend/pdfHandler.js
const fs = require('fs');
const log = require('./modelManager').log;

// ✅ Motor principal: pdf-parse (infalible, no requiere worker)
let pdfParse = null;
try {
  pdfParse = require('pdf-parse');
  log.info('✅ pdf-parse cargado correctamente');
} catch (e) {
  log.error('❌ pdf-parse no pudo cargar:', e.message);
}

/**
 * Limpiar texto extraído de PDF
 */
function limpiarTextoPDF(text) {
  if (!text) return '';
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/ {3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n')
    .replace(/^ +/gm, '')
    .trim();
}

/**
 * Extraer texto de un PDF
 */
async function extraerTextoPDF(buffer, filename) {
  if (!buffer || buffer.length === 0) {
    return { text: '', pages: 0, method: 'none', warning: 'Buffer vacío' };
  }

  const header = buffer.slice(0, 5).toString();
  if (header !== '%PDF-') {
    return { text: '', pages: 0, method: 'none', warning: 'No es un archivo PDF válido' };
  }

  if (!pdfParse) {
    return { text: '', pages: 0, method: 'none', warning: 'pdf-parse no está instalado.' };
  }

  try {
    log.info(`📄 [PDF] Extrayendo texto de ${filename} con pdf-parse...`);
    const data = await pdfParse(buffer);

    log.info(`📄 [PDF] ${filename}: ${data.numpages} páginas, ${data.text.length} chars extraídos`);

    if (data.text && data.text.trim().length > 0) {
      return {
        text: limpiarTextoPDF(data.text),
        pages: data.numpages,
        method: 'pdf-parse',
        warning: null
      };
    }

    // Si llega aquí, el PDF no tiene texto (es una imagen escaneada)
    log.warn(`⚠️ [PDF] ${filename}: ${data.numpages} páginas pero 0 texto -> PDF ESCANEADO`);
    return {
      text: '',
      pages: data.numpages,
      method: 'pdf-parse-empty',
      warning: 'PDF escaneado o protegido (sin texto seleccionable).'
    };

  } catch (err) {
    log.error(`❌ [PDF] Error con pdf-parse en ${filename}: ${err.message}`);

    // Fallback: Extracción bruta
    try {
      log.info(`📄 [PDF] Intentando extracción bruta para ${filename}...`);
      const rawText = buffer.toString('latin1');
      const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let combined = '';
      let match;

      while ((match = streamRegex.exec(rawText)) !== null) {
        const streamContent = match[1];
        const textParts = streamContent.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*Tj/g);
        if (textParts) {
          for (const part of textParts) {
            const extracted = part.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/);
            if (extracted && extracted[1]) {
              combined += extracted[1].replace(/\\n/g, '\n').replace(/\\r/g, '');
            }
          }
        }
        const tjParts = streamContent.match(/\[([^\]]*\([^\]]*\)[^\]]*)\]\s*TJ/g);
        if (tjParts) {
          for (const part of tjParts) {
            const strings = part.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/g);
            if (strings) {
              for (const s of strings) {
                combined += s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '');
              }
              combined += ' ';
            }
          }
        }
      }

      combined = combined.replace(/[^\x20-\x7E\n\ráéíóúüñÁÉÍÓÚÜÑ¿¡]/g, ' ').replace(/\s+/g, ' ').trim();

      if (combined.length > 50) {
        log.info(`✅ [PDF] ${filename}: Extracción bruta obtuvo ${combined.length} chars`);
        return {
          text: limpiarTextoPDF(combined),
          pages: -1,
          method: 'raw-extraction',
          warning: 'Extraído con método bruto'
        };
      }
    } catch (rawErr) {
      log.error(`❌ [PDF] Extracción bruta también falló: ${rawErr.message}`);
    }

    return {
      text: '',
      pages: 0,
      method: 'failed',
      warning: `Error al leer PDF: ${err.message}`
    };
  }
}

module.exports = { extraerTextoPDF, limpiarTextoPDF };