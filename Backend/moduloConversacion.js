// Backend/moduloConversacion.js
/**
 * Gestión de Conversaciones con cifrado AES-256-GCM
 * - Retención de 30 días
 * - Clave derivada por usuario
 * - Metadatos legibles en columnas, contenido cifrado en BLOB
 */

var crypto = require('crypto');
var db = require('./data/db.js');
var encryption = require('./encryption.js');

var RETENCION_DIAS = 30;

var log = {
  info: function() {
    var args = Array.prototype.slice.call(arguments);
    console.log(new Date().toISOString(), 'ℹ️', args.join(' '));
  },
  warn: function() {
    var args = Array.prototype.slice.call(arguments);
    console.warn(new Date().toISOString(), '⚠️', args.join(' '));
  },
  error: function() {
    var args = Array.prototype.slice.call(arguments);
    console.error(new Date().toISOString(), '❌', args.join(' '));
  }
};

// ============================================================================
// INICIALIZACIÓN
// ============================================================================

function inicializarTablas() {
  try {
    db.prepare(
      'CREATE TABLE IF NOT EXISTS Conversacion (' +
      'id TEXT PRIMARY KEY,' +
      'idUsuario TEXT NOT NULL,' +
      'titulo TEXT NOT NULL DEFAULT \'Sin título\',' +
      'cantidadMensajes INTEGER DEFAULT 0,' +
      'fechaCreacion TEXT NOT NULL DEFAULT (datetime(\'now\')),' +
      'fechaActualizacion TEXT NOT NULL DEFAULT (datetime(\'now\')),' +
      'contenidoCifrado BLOB NOT NULL,' +
      'iv BLOB NOT NULL,' +
      'authTag BLOB NOT NULL,' +
      'FOREIGN KEY (idUsuario) REFERENCES Usuario(id) ON DELETE CASCADE' +
      ')'
    ).run();

    db.prepare('CREATE INDEX IF NOT EXISTS idx_conv_usuario ON Conversacion(idUsuario)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_conv_actualizacion ON Conversacion(fechaActualizacion)').run();

    log.info('✅ Tabla Conversacion verificada/creada');
  } catch (err) {
    if (err.message.indexOf('already exists') === -1) {
      log.error('❌ Error creando tabla Conversacion:', err.message);
      throw err;
    }
  }
}

// ============================================================================
// AUXILIARES
// ============================================================================

function generarTitulo(mensajes) {
  for (var i = 0; i < mensajes.length; i++) {
    if (mensajes[i].role === 'user') {
      var texto = mensajes[i].displayText || mensajes[i].content || '';
      var preguntaMatch = texto.match(/Pregunta del usuario:\s*(.+)/);
      if (preguntaMatch) texto = preguntaMatch[1];
      texto = texto.replace(/\n/g, ' ').trim();
      if (texto.length > 50) texto = texto.substring(0, 47) + '...';
      return texto || 'Sin título';
    }
  }
  return 'Sin título';
}

function extraerDisplayText(content) {
  if (!content) return '';
  var match = content.match(/Pregunta del usuario:\s*([\s\S]+)$/);
  return match ? match[1].trim() : content;
}

// ============================================================================
// CRUD
// ============================================================================

function crearConversacion(idUsuario, titulo) {
  try {
    if (!idUsuario) {
      return { exitoso: false, error: 'idUsuario requerido' };
    }

    var id = crypto.randomUUID();
    var tituloFinal = (titulo && titulo.trim()) ? titulo.trim().substring(0, 100) : 'Sin título';

    var contenidoInicial = JSON.stringify([]);
    var cifrado = encryption.encrypt(contenidoInicial, idUsuario);

    db.prepare(
      'INSERT INTO Conversacion (id, idUsuario, titulo, cantidadMensajes, contenidoCifrado, iv, authTag) ' +
      'VALUES (?, ?, ?, 0, ?, ?, ?)'
    ).run(id, idUsuario, tituloFinal, cifrado.encrypted, cifrado.iv, cifrado.authTag);

    log.info('📝 [CONV] Conversación creada:', id, 'usuario:', idUsuario);

    return {
      exitoso: true,
      id: id,
      titulo: tituloFinal
    };
  } catch (err) {
    log.error('❌ Error en crearConversacion:', err.message);
    return { exitoso: false, error: 'Error al crear conversación' };
  }
}

function guardarConversacion(id, idUsuario, mensajes) {
  try {
    if (!id || !idUsuario) {
      return { exitoso: false, error: 'id e idUsuario requeridos' };
    }

    var conv = db.prepare('SELECT id FROM Conversacion WHERE id = ? AND idUsuario = ?').get(id, idUsuario);
    if (!conv) {
      return { exitoso: false, error: 'Conversación no encontrada o no pertenece al usuario' };
    }

    if (!Array.isArray(mensajes)) {
      return { exitoso: false, error: 'mensajes debe ser un array' };
    }

    var tituloActual = db.prepare('SELECT titulo, cantidadMensajes FROM Conversacion WHERE id = ?').get(id);
    var nuevoTitulo = tituloActual.titulo;
    if (tituloActual.cantidadMensajes === 0 && mensajes.length > 0) {
      nuevoTitulo = generarTitulo(mensajes);
    }

    var contenidoJSON = JSON.stringify(mensajes);
    var cifrado = encryption.encrypt(contenidoJSON, idUsuario);

    db.prepare(
      'UPDATE Conversacion ' +
      'SET contenidoCifrado = ?, iv = ?, authTag = ?, ' +
      'cantidadMensajes = ?, titulo = ?, fechaActualizacion = datetime(\'now\') ' +
      'WHERE id = ? AND idUsuario = ?'
    ).run(cifrado.encrypted, cifrado.iv, cifrado.authTag, mensajes.length, nuevoTitulo, id, idUsuario);

    log.info('💾 [CONV] Guardada:', id, 'mensajes:', mensajes.length);

    return {
      exitoso: true,
      titulo: nuevoTitulo,
      cantidadMensajes: mensajes.length
    };
  } catch (err) {
    log.error('❌ Error en guardarConversacion:', err.message);
    return { exitoso: false, error: 'Error al guardar conversación' };
  }
}

function obtenerConversaciones(idUsuario) {
  try {
    if (!idUsuario) {
      return { exitoso: false, error: 'idUsuario requerido' };
    }

    var conversaciones = db.prepare(
      'SELECT id, titulo, cantidadMensajes, fechaCreacion, fechaActualizacion ' +
      'FROM Conversacion ' +
      'WHERE idUsuario = ? ' +
      'ORDER BY fechaActualizacion DESC'
    ).all(idUsuario);

    return {
      exitoso: true,
      conversaciones: conversaciones
    };
  } catch (err) {
    log.error('❌ Error en obtenerConversaciones:', err.message);
    return { exitoso: false, error: 'Error al obtener conversaciones' };
  }
}

function obtenerConversacion(id, idUsuario) {
  try {
    if (!id || !idUsuario) {
      return { exitoso: false, error: 'id e idUsuario requeridos' };
    }

    var conv = db.prepare(
      'SELECT id, titulo, cantidadMensajes, fechaCreacion, fechaActualizacion, ' +
      'contenidoCifrado, iv, authTag ' +
      'FROM Conversacion ' +
      'WHERE id = ? AND idUsuario = ?'
    ).get(id, idUsuario);

    if (!conv) {
      return { exitoso: false, error: 'Conversación no encontrada' };
    }

    var contenidoJSON = encryption.decrypt(conv.contenidoCifrado, conv.iv, conv.authTag, idUsuario);
    var mensajes = JSON.parse(contenidoJSON);

    var mensajesLimpios = [];
    for (var i = 0; i < mensajes.length; i++) {
      var msg = mensajes[i];
      if (msg.role === 'user') {
        mensajesLimpios.push({
          role: 'user',
          content: msg.content,
          displayText: msg.displayText || extraerDisplayText(msg.content),
          timestamp: msg.timestamp || ''
        });
      } else {
        mensajesLimpios.push({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp || ''
        });
      }
    }

    return {
      exitoso: true,
      conversacion: {
        id: conv.id,
        titulo: conv.titulo,
        cantidadMensajes: conv.cantidadMensajes,
        fechaCreacion: conv.fechaCreacion,
        fechaActualizacion: conv.fechaActualizacion,
        mensajes: mensajesLimpios
      }
    };
  } catch (err) {
    log.error('❌ Error en obtenerConversacion:', err.message);
    if (err.message.indexOf('Unsupported state') !== -1 || err.message.indexOf('auth tag') !== -1) {
      return { exitoso: false, error: 'Error al descifrar: datos corruptos o clave incorrecta' };
    }
    return { exitoso: false, error: 'Error al obtener conversación' };
  }
}

function actualizarTitulo(id, idUsuario, titulo) {
  try {
    if (!id || !idUsuario || !titulo) {
      return { exitoso: false, error: 'Parámetros requeridos' };
    }

    var result = db.prepare(
      'UPDATE Conversacion SET titulo = ?, fechaActualizacion = datetime(\'now\') ' +
      'WHERE id = ? AND idUsuario = ?'
    ).run(titulo.trim().substring(0, 100), id, idUsuario);

    if (result.changes === 0) {
      return { exitoso: false, error: 'Conversación no encontrada' };
    }

    return { exitoso: true, titulo: titulo.trim().substring(0, 100) };
  } catch (err) {
    log.error('❌ Error en actualizarTitulo:', err.message);
    return { exitoso: false, error: 'Error al actualizar título' };
  }
}

function eliminarConversacion(id, idUsuario) {
  try {
    if (!id || !idUsuario) {
      return { exitoso: false, error: 'Parámetros requeridos' };
    }

    var result = db.prepare('DELETE FROM Conversacion WHERE id = ? AND idUsuario = ?').run(id, idUsuario);

    if (result.changes === 0) {
      return { exitoso: false, error: 'Conversación no encontrada' };
    }

    log.info('🗑️ [CONV] Eliminada:', id, 'usuario:', idUsuario);
    return { exitoso: true, mensaje: 'Conversación eliminada' };
  } catch (err) {
    log.error('❌ Error en eliminarConversacion:', err.message);
    return { exitoso: false, error: 'Error al eliminar conversación' };
  }
}

function limpiarConversacionesExpiradas() {
  try {
    var result = db.prepare(
      'DELETE FROM Conversacion ' +
      'WHERE datetime(fechaActualizacion, \'+\' || ? || \' days\') < datetime(\'now\')'
    ).run(RETENCION_DIAS);

    if (result.changes > 0) {
      log.info('🧹 [CONV] Limpiadas ' + result.changes + ' conversaciones expiradas (>' + RETENCION_DIAS + ' días)');
    }

    return { eliminadas: result.changes };
  } catch (err) {
    log.error('❌ Error en limpiarConversacionesExpiradas:', err.message);
    return { eliminadas: 0, error: err.message };
  }
}

// ============================================================================
// INIT & EXPORT
// ============================================================================

inicializarTablas();

setInterval(limpiarConversacionesExpiradas, 30 * 60 * 1000);
setTimeout(limpiarConversacionesExpiradas, 15000);

module.exports = {
  crearConversacion: crearConversacion,
  guardarConversacion: guardarConversacion,
  obtenerConversaciones: obtenerConversaciones,
  obtenerConversacion: obtenerConversacion,
  actualizarTitulo: actualizarTitulo,
  eliminarConversacion: eliminarConversacion,
  limpiarConversacionesExpiradas: limpiarConversacionesExpiradas,
  RETENCION_DIAS: RETENCION_DIAS
};