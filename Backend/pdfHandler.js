// Backend/pdfHandler.js
const fs = require('fs');
const log = require('./modelManager').log;



// ✅ MOTOR NUEVO: Usar pdfjs-dist v2.16 (Motor oficial de Firefox - Versión ligera)
let pdfjsLib;
try {
  pdfjsLib = require('pdfjs-dist/build/pdf'); // ✅ Ruta para la versión 2.16
} catch (e1) {
  try {
    pdfjsLib = require('pdfjs-dist'); // Fallback genérico
  } catch (e2) {
    log.error('❌ No se pudo cargar pdfjs-dist. Ejecutá: npm install pdfjs-dist@2.16.105');
  }
}

/**
 * Extraer texto de un PDF usando el motor de Firefox
 */
async function extraerTextoPDF(buffer, filename) {
  if (!pdfjsLib) {
    return { text: '', pages: 0, method: 'none', warning: 'pdfjs-dist no está instalado.' };
  }

  if (!buffer || buffer.length === 0) {
    return { text: '', pages: 0, method: 'none', warning: 'Buffer vacío' };
  }

  const header = buffer.slice(0, 5).toString();
  if (header !== '%PDF-') {
    return { text: '', pages: 0, method: 'none', warning: 'No es un archivo PDF válido' };
  }

  try {
    // Cargar el documento (pdfjs-dist soporta Buffer nativamente)
    const doc = await pdfjsLib.getDocument({ data: buffer, useSystemFonts: true }).promise;
    const numPages = doc.numPages;
    let fullText = '';

    log.info(`📄 [PDF] ${filename}: Procesando ${numPages} páginas con motor Firefox...`);

    // Iterar página por página
    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      
      let pageText = '';
      let lastY = null;

      if (textContent && textContent.items) {
        for (let j = 0; j < textContent.items.length; j++) {
          const item = textContent.items[j];
          
          if (!item || item.str === undefined || item.str === null) continue;

          // Reconstruir saltos de línea basados en la posición Y
          if (lastY !== null && item.transform && item.transform[5] !== undefined) {
            const currentY = item.transform[5];
            
            if (Math.abs(currentY - lastY) > 2) {
              // Cambió de renglón
              pageText += '\n';
            } else {
              // ✅ MEJORA: Mismo renglón. Asegurar espacio entre palabras 
              // pero evitar doble espacio si ya viene en el item
              var lastChar = pageText.length > 0 ? pageText[pageText.length - 1] : '';
              var firstChar = item.str.length > 0 ? item.str[0] : '';
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

    log.info(`📄 [PDF] ${filename}: ${numPages} páginas, ${fullText.length} chars extraídos`);

    if (fullText.length === 0 && numPages > 0) {
      log.warn(`⚠️ [PDF] ${filename}: ${numPages} páginas pero 0 texto → PDF ESCANEADO o protegido`);
      return {
        text: '',
        pages: numPages,
        method: 'pdfjs-dist',
        warning: `PDF escaneado o protegido (${numPages} páginas sin texto accesible).`
      };
    }

    fullText = limpiarTextoPDF(fullText);

    return {
      text: fullText,
      pages: numPages,
      method: 'pdfjs-dist',
      warning: fullText.length > 0 ? null : 'No se pudo extraer texto'
    };

  } catch (err) {
    log.error(`❌ [PDF] Error parseando ${filename} con motor Firefox:`, err.message);

    // Fallback: Extracción bruta
    try {
      const rawText = extraerTextoBrutoPDF(buffer);
      if (rawText.length > 50) {
        log.info(`📄 [PDF] ${filename}: Extracción bruta obtuvo ${rawText.length} chars`);
        return {
          text: limpiarTextoPDF(rawText),
          pages: -1,
          method: 'raw-extraction',
          warning: 'PDF parseado con método alternativo.'
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
 * Extracción bruta de texto cuando todo lo demás falla
 */
function extraerTextoBrutoPDF(buffer) {
  const text = buffer.toString('latin1');
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let combined = '';
  let match;

  while ((match = streamRegex.exec(text)) !== null) {
    const streamContent = match[1];
    const textParts = streamContent.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)\s*Tj/g);
    if (textParts) {
      for (const part of textParts) {
        const extracted = part.match(/\(([^\\)]*(?:\\.[^\\)]*)*)\)/);
        if (extracted && extracted[1]) {
          combined += extracted[1].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
        }
      }
    }

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
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/ {3,}/g, '  ') // Reducir espacios múltiples a 2 máximo
    .replace(/\n{4,}/g, '\n\n') // Reducir saltos múltiples a 2
    .replace(/^ +/gm, '')
    .trim();
}

module.exports = { extraerTextoPDF, limpiarTextoPDF };