// Backend/moduloUser.js
/**
 * Módulo de Usuario - Extensión de la API Privada
 * Responsable de:
 * - Registro de nuevas cuentas de usuario
 * - Validación y procesos de cuenta
 * - Autenticación y login con protección contra SQL injection
 * - Gestión de historial de conexión
 * - Operaciones CRUD para Panel de Administración
 * - Sistema de inactividad (desconexión automática a los 45 min)
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');

// Importar la instancia de base de datos existente
const db = require('./data/db.js');

const log = {
  info: (...args) => console.log(new Date().toISOString(), 'ℹ️', ...args),
  warn: (...args) => console.warn(new Date().toISOString(), '⚠️', ...args),
  error: (...args) => console.error(new Date().toISOString(), '❌', ...args)
};

// ============================================================================
// INICIALIZACIÓN - Las tablas ya existen en app.db
// ============================================================================

const CODIGO_ADMIN = '01000101';

function inicializarTablas() {
  try {
    // Verificar que las tablas existentes tengan la estructura esperada
    const tablaUsuario = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Usuario'").get();
    const tablaHistorial = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='HistorialConexion'").get();

    if (!tablaUsuario) {
      log.warn('⚠️ Tabla Usuario no encontrada en la BD');
    } else {
      log.info('✅ Tabla Usuario existente verificada');
    }

    if (!tablaHistorial) {
      log.warn('⚠️ Tabla HistorialConexion no encontrada en la BD');
    } else {
      log.info('✅ Tabla HistorialConexion existente verificada');
    }

    // Crear tabla de códigos de validación (pendiente de email)
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS CodigosValidacion (
          id TEXT PRIMARY KEY,
          idUsuario TEXT NOT NULL,
          codigo TEXT NOT NULL,
          intentos INTEGER DEFAULT 5,
          generadoEn TEXT NOT NULL DEFAULT (datetime('now')),
          expiradoEn TEXT NOT NULL,
          validado INTEGER DEFAULT 0,
          FOREIGN KEY (idUsuario) REFERENCES Usuario(id) ON DELETE CASCADE
        )
      `).run();

      // Índice para búsquedas rápidas
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_validacion_usuario ON CodigosValidacion(idUsuario)`).run();
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_validacion_codigo ON CodigosValidacion(codigo)`).run();

      log.info('✅ Tabla CodigosValidacion verificada/creada');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        log.error('⚠️ Error creando tabla CodigosValidacion:', err.message);
      }
    }

  } catch (err) {
    log.error('❌ Error verificando tablas:', err.message);
    throw err;
  }
}

// ============================================================================
// VALIDACIONES
// ============================================================================

/**
 * Valida que el nombre de usuario sea seguro y cumpla con requisitos
 */
function validarUsuario(usuario) {
  if (!usuario || typeof usuario !== 'string') {
    return { valido: false, error: 'Usuario inválido' };
  }

  usuario = usuario.trim();

  if (usuario.length < 3) {
    return { valido: false, error: 'Usuario debe tener al menos 3 caracteres' };
  }

  if (usuario.length > 50) {
    return { valido: false, error: 'Usuario no puede exceder 50 caracteres' };
  }

  // Solo permitir alfanuméricos, guiones y guiones bajos
  if (!/^[a-zA-Z0-9_-]+$/.test(usuario)) {
    return { valido: false, error: 'Usuario solo puede contener letras, números, guiones y guiones bajos' };
  }

  return { valido: true };
}

/**
 * Valida que el correo tenga formato válido
 */
function validarCorreo(correo) {
  if (!correo || typeof correo !== 'string') {
    return { valido: false, error: 'Correo inválido' };
  }

  correo = correo.trim().toLowerCase();

  // Expresión regular simple pero efectiva para validar emails
  const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regexEmail.test(correo)) {
    return { valido: false, error: 'Formato de correo inválido' };
  }

  if (correo.length > 100) {
    return { valido: false, error: 'Correo demasiado largo' };
  }

  return { valido: true, correo };
}

/**
 * Valida que la contraseña cumpla con requisitos mínimos de seguridad
 */
function validarContrasena(contrasena) {
  if (!contrasena || typeof contrasena !== 'string') {
    return { valido: false, error: 'Contraseña inválida' };
  }

  if (contrasena.length < 8) {
    return { valido: false, error: 'Contraseña debe tener al menos 8 caracteres' };
  }

  if (contrasena.length > 128) {
    return { valido: false, error: 'Contraseña muy larga' };
  }

  // Verificar que tenga al menos: mayúscula, minúscula y número
  const tieneMayuscula = /[A-Z]/.test(contrasena);
  const tieneMinuscula = /[a-z]/.test(contrasena);
  const tieneNumero = /[0-9]/.test(contrasena);

  if (!tieneMayuscula || !tieneMinuscula || !tieneNumero) {
    return {
      valido: false,
      error: 'Contraseña debe contener mayúsculas, minúsculas y números'
    };
  }

  return { valido: true };
}

// ============================================================================
// FUNCIONES DE OPERACIONES DE USUARIO
// ============================================================================

/**
 * Registra un nuevo usuario en la base de datos
 * Usa Prepared Statements para proteger contra SQL Injection
 * 
 * @param {string} usuario - Nombre de usuario
 * @param {string} correo - Correo electrónico
 * @param {string} contrasena - Contraseña en texto plano
 * @returns {Promise<Object>} - Resultado del registro
 */
async function registrarUsuario(usuario, correo, contrasena) {
  try {
    // Validaciones de entrada
    const validUser = validarUsuario(usuario);
    if (!validUser.valido) {
      return {
        exitoso: false,
        error: validUser.error,
        codigo: 'USUARIO_INVALIDO'
      };
    }

    const validEmail = validarCorreo(correo);
    if (!validEmail.valido) {
      return {
        exitoso: false,
        error: validEmail.error,
        codigo: 'CORREO_INVALIDO'
      };
    }

    const validPass = validarContrasena(contrasena);
    if (!validPass.valido) {
      return {
        exitoso: false,
        error: validPass.error,
        codigo: 'CONTRASENA_INVALIDA'
      };
    }

    // Verificar si el usuario ya existe (prepared statement)
    const usuarioExistente = db.prepare(
      'SELECT id FROM Usuario WHERE NombreUsuario = ? OR Correo = ? LIMIT 1'
    ).get(usuario.trim(), validEmail.correo);

    if (usuarioExistente) {
      return {
        exitoso: false,
        error: 'Usuario o correo ya registrados',
        codigo: 'USUARIO_EXISTE'
      };
    }

    // Hash de la contraseña con bcrypt
    const saltRounds = 12;
    const contrasenaHasheada = await bcrypt.hash(contrasena, saltRounds);

    // Generar ID único
    const idUsuario = crypto.randomUUID();

    // Insertar nuevo usuario usando prepared statement (protegido contra SQL Injection)
    db.prepare(
      `INSERT INTO Usuario (
        id, NombreUsuario, Correo, Password, EstaConectado, FechaCreacionCuenta, FechaUltimaConexion
      ) VALUES (?, ?, ?, ?, ?, datetime('now'), NULL)`
    ).run(
      idUsuario,
      usuario.trim(),
      validEmail.correo,
      contrasenaHasheada,
      0
    );

    log.info(`✅ Usuario registrado exitosamente: ${usuario}`);

    return {
      exitoso: true,
      mensaje: 'Usuario registrado exitosamente',
      idUsuario: idUsuario,
      usuario: usuario,
      correo: validEmail.correo
    };

  } catch (err) {
    log.error('❌ Error en registrarUsuario:', err.message);
    return {
      exitoso: false,
      error: 'Error al registrar usuario',
      codigo: 'ERROR_REGISTRO'
    };
  }
}

/**
 * Autentica a un usuario verificando credenciales
 * Usa Prepared Statements para proteger contra SQL Injection
 * 
 * @param {string} usuario - Nombre de usuario
 * @param {string} contrasena - Contraseña en texto plano
 * @param {Object} datosConexion - Datos de la conexión (IP, UserAgent, etc.)
 * @returns {Promise<Object>} - Resultado de la autenticación
 */
async function autenticarUsuario(usuario, contrasena, datosConexion = {}) {
  try {
    if (!usuario || !contrasena) {
      return {
        exitoso: false,
        error: 'Usuario y contraseña son requeridos',
        codigo: 'CAMPOS_VACIOS'
      };
    }

    const usuarioEnBD = db.prepare(
      'SELECT id, NombreUsuario, Correo, Password, NombreVisible, FotoPerfilPath FROM Usuario WHERE NombreUsuario = ? LIMIT 1'
    ).get(usuario.trim());

    if (!usuarioEnBD) {
      log.warn(`⚠️ Intento de login fallido: usuario no encontrado: ${usuario}`);
      return {
        exitoso: false,
        error: 'Usuario o contraseña incorrectos',
        codigo: 'CREDENCIALES_INVALIDAS'
      };
    }

    const contrasenaValida = await bcrypt.compare(contrasena, usuarioEnBD.Password);

    if (!contrasenaValida) {
      log.warn(`⚠️ Intento de login fallido: contraseña incorrecta: ${usuario}`);
      return {
        exitoso: false,
        error: 'Usuario o contraseña incorrectos',
        codigo: 'CREDENCIALES_INVALIDAS'
      };
    }

    const stmt = db.prepare(
      `INSERT INTO HistorialConexion (
        idUsuario, IpOrigen, FechaConexion, FechaDesconexion, EsExitosa
      ) VALUES (?, ?, datetime('now'), NULL, 1)`
    );

    const result = stmt.run(
      usuarioEnBD.id,
      datosConexion.ip || 'desconocida'
    );

    const idConexion = result.lastInsertRowid;

    db.prepare(
      `UPDATE Usuario SET FechaUltimaConexion = datetime('now'), EstaConectado = 1 WHERE id = ?`
    ).run(usuarioEnBD.id);

    log.info(`✅ Usuario autenticado exitosamente: ${usuario}`);

    return {
      exitoso: true,
      mensaje: 'Autenticación exitosa',
      idUsuario: usuarioEnBD.id,
      usuario: usuarioEnBD.NombreUsuario,
      correo: usuarioEnBD.Correo,
      idConexion: idConexion,
      nombreVisible: usuarioEnBD.NombreVisible,
      fotoPerfilPath: usuarioEnBD.FotoPerfilPath
    };

  } catch (err) {
    log.error('❌ Error en autenticarUsuario:', err.message);
    return {
      exitoso: false,
      error: 'Error al autenticar usuario',
      codigo: 'ERROR_AUTENTICACION'
    };
  }
}

/**
 * Actualiza los datos de un usuario (nombre visible, contraseña, foto)
 * MODIFICADA: Permite bypass de contraseña actual si datos.esAdmin es true
 */
async function actualizarUsuario(idUsuario, datos) {
  try {
    if (!idUsuario) {
      return { exitoso: false, error: 'idUsuario requerido' };
    }

    const usuarioExistente = db.prepare('SELECT id FROM Usuario WHERE id = ?').get(idUsuario);
    if (!usuarioExistente) {
      return { exitoso: false, error: 'Usuario no encontrado' };
    }

    const campos = [];
    const valores = [];

    // Nombre visible
    if (datos.nombreVisible !== undefined) {
      const nombre = datos.nombreVisible.trim();
      if (nombre.length === 0) {
        return { exitoso: false, error: 'El nombre visible no puede estar vacío' };
      }
      if (nombre.length > 50) {
        return { exitoso: false, error: 'Nombre visible muy largo (máximo 50 caracteres)' };
      }
      campos.push('NombreVisible = ?');
      valores.push(nombre);
    }

    // Foto de perfil
    if (datos.fotoPerfilPath !== undefined) {
      campos.push('FotoPerfilPath = ?');
      valores.push(datos.fotoPerfilPath);
    }

    // Contraseña
    if (datos.contrasena && datos.contrasena.trim()) {
      
      // ✅ Si NO es admin, requiere la contraseña actual por seguridad
      if (!datos.esAdmin) {
        if (!datos.contrasenaActual) {
          return { exitoso: false, error: 'Debes ingresar tu contraseña actual para cambiarla' };
        }

        const verificacion = await verificarContrasena(idUsuario, datos.contrasenaActual);
        if (!verificacion.exitoso) {
          return { exitoso: false, error: verificacion.error };
        }
      }

      // Validar nueva contraseña
      const validPass = validarContrasena(datos.contrasena);
      if (!validPass.valido) {
        return { exitoso: false, error: validPass.error };
      }

      const hashedPassword = await bcrypt.hash(datos.contrasena, 12);
      campos.push('Password = ?');
      valores.push(hashedPassword);
    }

    if (campos.length === 0) {
      return { exitoso: false, error: 'No hay campos para actualizar' };
    }

    valores.push(idUsuario);

    const query = `UPDATE Usuario SET ${campos.join(', ')} WHERE id = ?`;
    const result = db.prepare(query).run(...valores);

    if (result.changes === 0) {
      return { exitoso: false, error: 'No se pudo actualizar el usuario' };
    }

    const usuario = db.prepare(
      `SELECT id, NombreUsuario, Correo, NombreVisible, FotoPerfilPath,
              EstaConectado, FechaCreacionCuenta, FechaUltimaConexion
       FROM Usuario WHERE id = ?`
    ).get(idUsuario);

    log.info(`✅ Usuario actualizado: ${idUsuario} | Campos: ${campos.map(c => c.split('=')[0].trim()).join(', ')}`);

    return {
      exitoso: true,
      mensaje: 'Usuario actualizado exitosamente',
      usuario: usuario
    };
  } catch (err) {
    log.error('❌ Error en actualizarUsuario:', err.message);
    return { exitoso: false, error: 'Error al actualizar usuario' };
  }
}


/**
 * Genera un código de 8 cifras aleatorio
 */
function generarCodigoAleatorio() {
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += Math.floor(Math.random() * 10);
  }
  return codigo;
}

/**
 * Crea un código de validación para un usuario registrado pero no validado
 * 
 * @param {string} idUsuario - ID del usuario
 * @returns {Object} - Resultado con el código generado
 */
function generarCodigoValidacion(idUsuario) {
  try {
    const codigo = generarCodigoAleatorio();
    const idCodigo = crypto.randomUUID();
    const ahora = new Date();
    const generadoEn = ahora.toISOString();

    // Expira en 10 minutos
    const expiradoEn = new Date(ahora.getTime() + 10 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO CodigosValidacion (
        id, idUsuario, codigo, intentos, generadoEn, expiradoEn, validado
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(idCodigo, idUsuario, codigo, 5, generadoEn, expiradoEn, 0);

    log.info(`📧 Código de validación generado para usuario: ${idUsuario}`);

    return {
      exitoso: true,
      codigo: codigo,
      idCodigo: idCodigo,
      expiraEn: 600 // segundos
    };
  } catch (err) {
    log.error('❌ Error en generarCodigoValidacion:', err.message);
    return {
      exitoso: false,
      error: 'Error al generar código',
      codigo: 'ERROR_CODIGO'
    };
  }
}

/**
 * Valida un código ingresado por el usuario
 * Si es el código de admin, valida automáticamente
 * 
 * @param {string} idUsuario - ID del usuario
 * @param {string} codigoIngresado - Código que ingresó el usuario
 * @returns {Object} - Resultado de la validación
 */
function validarCodigoValidacion(idUsuario, codigoIngresado) {
  try {
    // Buscar el código más reciente para este usuario
    const registroCodigo = db.prepare(
      `SELECT id, codigo, intentos, expiradoEn, validado 
       FROM CodigosValidacion 
       WHERE idUsuario = ? 
       ORDER BY generadoEn DESC 
       LIMIT 1`
    ).get(idUsuario);

    if (!registroCodigo) {
      return {
        exitoso: false,
        error: 'No se generó código para este usuario',
        codigo: 'SIN_CODIGO'
      };
    }

    // Verificar si ya fue validado
    if (registroCodigo.validado === 1) {
      return {
        exitoso: false,
        error: 'El código ya fue utilizado',
        codigo: 'CODIGO_USADO'
      };
    }

    // Verificar si expiró
    if (new Date(registroCodigo.expiradoEn) < new Date()) {
      return {
        exitoso: false,
        error: 'El código expiró. Solicite uno nuevo.',
        codigo: 'CODIGO_EXPIRADO'
      };
    }

    // Verificar intentos
    if (registroCodigo.intentos <= 0) {
      return {
        exitoso: false,
        error: 'Se agotaron los intentos. Solicite un código nuevo.',
        codigo: 'SIN_INTENTOS'
      };
    }

    // Verificar si es el código de administrador (SIEMPRE válido)
    if (codigoIngresado === CODIGO_ADMIN) {
      log.info(`🔐 Código de administrador validado para usuario: ${idUsuario}`);

      // Marcar como validado
      db.prepare(
        `UPDATE CodigosValidacion SET validado = 1 WHERE id = ?`
      ).run(registroCodigo.id);

      return {
        exitoso: true,
        mensaje: 'Código de administrador validado',
        esAdmin: true,
        idCodigo: registroCodigo.id
      };
    }

    // Comparar código
    if (codigoIngresado !== registroCodigo.codigo) {
      // Decrementar intentos
      const intentosRestantes = registroCodigo.intentos - 1;

      db.prepare(
        `UPDATE CodigosValidacion SET intentos = ? WHERE id = ?`
      ).run(intentosRestantes, registroCodigo.id);

      log.warn(`⚠️ Código incorrecto para usuario ${idUsuario}. Intentos restantes: ${intentosRestantes}`);

      return {
        exitoso: false,
        error: 'Código incorrecto',
        codigo: 'CODIGO_INCORRECTO',
        intentosRestantes: intentosRestantes
      };
    }

    // Código correcto - Marcar como validado
    db.prepare(
      `UPDATE CodigosValidacion SET validado = 1 WHERE id = ?`
    ).run(registroCodigo.id);

    // Marcar usuario como validado/activo (opcional - según tu BD)
    db.prepare(
      `UPDATE Usuario SET EstaConectado = 0 WHERE id = ?`
    ).run(idUsuario);

    log.info(`✅ Usuario validado exitosamente: ${idUsuario}`);

    return {
      exitoso: true,
      mensaje: 'Código validado correctamente',
      idCodigo: registroCodigo.id
    };

  } catch (err) {
    log.error('❌ Error en validarCodigoValidacion:', err.message);
    return {
      exitoso: false,
      error: 'Error al validar código',
      codigo: 'ERROR_VALIDACION'
    };
  }
}

/**
 * Limpia códigos expirados de la BD
 */
function limpiarCodigosExpirados() {
  try {
    const ahora = new Date().toISOString();

    const resultado = db.prepare(
      `DELETE FROM CodigosValidacion 
       WHERE expiradoEn < ? AND validado = 0`
    ).run(ahora);

    if (resultado.changes > 0) {
      log.info(`🧹 ${resultado.changes} códigos expirados eliminados`);
    }
  } catch (err) {
    log.error('⚠️ Error limpiando códigos expirados:', err.message);
  }
}

function registrarIntentoFallido(usuario, datosConexion = {}) {
  try {
    // Buscar el usuario
    const usuarioEnBD = db.prepare(
      'SELECT id FROM Usuario WHERE NombreUsuario = ? LIMIT 1'
    ).get(usuario.trim());

    if (!usuarioEnBD) {
      return;
    }

    db.prepare(
      `INSERT INTO HistorialConexion (
        idUsuario, IpOrigen, FechaConexion, FechaDesconexion, EsExitosa
      ) VALUES (?, ?, datetime('now'), datetime('now'), 0)`
    ).run(
      usuarioEnBD.id,
      datosConexion.ip || 'desconocida'
    );

    log.warn(`⚠️ Intento fallido registrado para: ${usuario}`);
  } catch (err) {
    log.error('❌ Error en registrarIntentoFallido:', err.message);
  }
}

/**
 * Obtiene información del usuario sin revelar datos sensibles
 */
function obtenerInfoUsuario(idUsuario) {
  try {
    const usuario = db.prepare(
      `SELECT id, NombreUsuario, Correo, NombreVisible, FotoPerfilPath,
               EstaConectado, FechaCreacionCuenta, FechaUltimaConexion
        FROM Usuario WHERE id = ? LIMIT 1`
    ).get(idUsuario);

    if (!usuario) {
      return { exitoso: false, error: 'Usuario no encontrado' };
    }

    return {
      exitoso: true,
      usuario: usuario
    };
  } catch (err) {
    log.error('❌ Error en obtenerInfoUsuario:', err.message);
    return { exitoso: false, error: 'Error al obtener información del usuario' };
  }
}

/**
 * Obtiene el historial de conexiones de un usuario
 */
function obtenerHistorialConexiones(idUsuario, limite = 20) {
  try {
    const historial = db.prepare(
      `SELECT id, FechaConexion, FechaDesconexion, EsExitosa, IpOrigen 
       FROM HistorialConexion 
       WHERE idUsuario = ? 
       ORDER BY FechaConexion DESC 
       LIMIT ?`
    ).all(idUsuario, limite);

    return {
      exitoso: true,
      historial: historial
    };
  } catch (err) {
    log.error('❌ Error en obtenerHistorialConexiones:', err.message);
    return { exitoso: false, error: 'Error al obtener historial de conexiones' };
  }
}

/**
 * Cierra la sesión de un usuario actualizando el historial de conexión
 */
function cerrarSesion(idConexion) {
  try {
    db.prepare(
      `UPDATE HistorialConexion 
       SET FechaDesconexion = datetime('now') 
       WHERE id = ?`
    ).run(idConexion);

    log.info(`✅ Sesión cerrada: ${idConexion}`);

    return {
      exitoso: true,
      mensaje: 'Sesión cerrada exitosamente'
    };
  } catch (err) {
    log.error('❌ Error en cerrarSesion:', err.message);
    return { exitoso: false, error: 'Error al cerrar sesión' };
  }
}

/**
 * Verifica si una contraseña en texto plano coincide con la del usuario
 */
async function verificarContrasena(idUsuario, contrasenaIngresada) {
  try {
    if (!idUsuario || !contrasenaIngresada) {
      return { exitoso: false, error: 'Parámetros requeridos' };
    }

    const usuario = db.prepare('SELECT Password FROM Usuario WHERE id = ? LIMIT 1').get(idUsuario);
    if (!usuario) {
      return { exitoso: false, error: 'Usuario no encontrado' };
    }

    const coincide = await bcrypt.compare(contrasenaIngresada, usuario.Password);
    if (!coincide) {
      return { exitoso: false, error: 'La contraseña actual es incorrecta' };
    }

    return { exitoso: true };
  } catch (err) {
    log.error('❌ Error en verificarContrasena:', err.message);
    return { exitoso: false, error: 'Error al verificar contraseña' };
  }
}

/**
 * Elimina un usuario recién creado si falló el envío del correo
 */
function eliminarUsuarioPendiente(idUsuario) {
  try {
    // Como CodigosValidacion tiene ON DELETE CASCADE, al borrar el usuario se borran sus códigos
    const result = db.prepare('DELETE FROM Usuario WHERE id = ?').run(idUsuario);
    if (result.changes > 0) {
      log.info(`🧹 Usuario pendiente eliminado (rollback): ${idUsuario}`);
    }
    return { exitoso: true };
  } catch (err) {
    log.error('❌ Error eliminando usuario pendiente:', err.message);
    return { exitoso: false };
  }
}

/**
 * Limpieza automática (Trigger): Elimina usuarios que no validaron su código en 10 minutos
 */
function limpiarUsuariosNoValidados() {
  try {
    // Buscar usuarios cuyo código expiró y nunca fue validado
    const usuariosCaducados = db.prepare(`
      SELECT DISTINCT u.id 
      FROM Usuario u
      INNER JOIN CodigosValidacion cv ON u.id = cv.idUsuario
      WHERE cv.validado = 0 
      AND cv.expiradoEn < datetime('now')
    `).all();

    if (usuariosCaducados.length === 0) return;

    const deleteStmt = db.prepare('DELETE FROM Usuario WHERE id = ?');
    let eliminados = 0;

    // Usar transacción para borrar rápido y seguro
    const borrarMuchos = db.transaction((usuarios) => {
      for (const user of usuarios) {
        deleteStmt.run(user.id);
        eliminados++;
      }
    });

    borrarMuchos(usuariosCaducados);
    if (eliminados > 0) log.info(`🧹 [CRON] Limpieza automática: ${eliminados} usuarios no validados eliminados.`);
  } catch (err) {
    log.error('❌ Error en limpieza de usuarios no validados:', err.message);
  }
}

// ============================================================================
// FUNCIONES CRUD PARA PANEL DE ADMINISTRACIÓN
// ============================================================================

/**
 * Obtiene todos los usuarios de la base de datos (Para el Panel Admin)
 */
function obtenerTodosLosUsuarios() {
  try {
    const usuarios = db.prepare(
      `SELECT id, NombreUsuario, Correo, NombreVisible, EstaConectado, FechaCreacionCuenta, FechaUltimaConexion FROM Usuario ORDER BY FechaCreacionCuenta DESC`
    ).all();
    return { exitoso: true, usuarios: usuarios };
  } catch (err) {
    log.error('❌ Error en obtenerTodosLosUsuarios:', err.message);
    return { exitoso: false, error: 'Error al obtener usuarios' };
  }
}

/**
 * Elimina un usuario por su ID (Para el Panel Admin)
 */
function eliminarUsuario(idUsuario) {
  try {

    // AÑADIR esta línea:
    db.prepare('DELETE FROM Conversacion WHERE idUsuario = ?').run(idUsuario);
        // También eliminar historial y códigos por integridad (CASCADE si está configurado, sino manual)
    db.prepare('DELETE FROM HistorialConexion WHERE idUsuario = ?').run(idUsuario);
    db.prepare('DELETE FROM CodigosValidacion WHERE idUsuario = ?').run(idUsuario);

    const result = db.prepare('DELETE FROM Usuario WHERE id = ?').run(idUsuario);
    if (result.changes === 0) return { exitoso: false, error: 'Usuario no encontrado' };

    log.info(`🗑️ Usuario eliminado por admin: ${idUsuario}`);
    return { exitoso: true, mensaje: 'Usuario eliminado correctamente' };
  } catch (err) {
    log.error('❌ Error en eliminarUsuario:', err.message);
    return { exitoso: false, error: 'Error al eliminar usuario' };
  }
}

// ============================================================================
// SISTEMA DE INACTIVIDAD - Desconexión automática tras 45 min
// ============================================================================

/**
 * Actualiza la marca de tiempo de última actividad de un usuario
 * Se llama desde el heartbeat del frontend y en cada acción del usuario
 * 
 * @param {string} idUsuario - ID del usuario
 * @returns {boolean} - true si se actualizó correctamente
 */
function actualizarActividad(idUsuario) {
  try {
    if (!idUsuario) return false;
    
    const result = db.prepare(
      `UPDATE Usuario SET FechaUltimaConexion = datetime('now') WHERE id = ? AND EstaConectado = 1`
    ).run(idUsuario);
    
    return result.changes > 0;
  } catch (err) {
    log.error('❌ Error en actualizarActividad:', err.message);
    return false;
  }
}

/**
 * Desconecta usuarios que llevan más de X minutos sin actividad
 * - Marca EstaConectado = 0 en la tabla Usuario
 * - Cierra sesiones abiertas (FechaDesconexion = now) en HistorialConexion
 * - Usa transacción para garantizar consistencia
 * 
 * @param {number} minutosInactividad - Minutos de inactividad para desconectar (default: 45)
 * @returns {Object} - { desconectados: number }
 */
function desconectarUsuariosInactivos(minutosInactividad = 45) {
  try {
    // Buscar usuarios conectados cuya última actividad fue hace más de X minutos
    const usuariosInactivos = db.prepare(
      `SELECT id, NombreUsuario FROM Usuario 
       WHERE EstaConectado = 1 
       AND FechaUltimaConexion IS NOT NULL
       AND datetime(FechaUltimaConexion, '+' || ? || ' minutes') < datetime('now')`
    ).all(minutosInactividad);

    if (usuariosInactivos.length === 0) {
      return { desconectados: 0 };
    }

    // Prepared statements para la transacción
    const cerrarHistorial = db.prepare(
      `UPDATE HistorialConexion 
       SET FechaDesconexion = datetime('now') 
       WHERE idUsuario = ? AND FechaDesconexion IS NULL`
    );

    const desconectar = db.prepare(
      `UPDATE Usuario SET EstaConectado = 0 WHERE id = ?`
    );

    let count = 0;

    // Transacción: todo o nada
    const desconectarTodo = db.transaction((usuarios) => {
      for (const u of usuarios) {
        cerrarHistorial.run(u.id);
        desconectar.run(u.id);
        count++;
        log.info(`⏰ [INACTIVIDAD] Usuario desconectado: ${u.NombreUsuario} (inactivo > ${minutosInactividad} min)`);
      }
    });

    desconectarTodo(usuariosInactivos);

    if (count > 0) {
      log.info(`⏰ [INACTIVIDAD] Total desconectados: ${count} usuario(s)`);
    }

    return { desconectados: count };
  } catch (err) {
    log.error('❌ Error en desconectarUsuariosInactivos:', err.message);
    return { desconectados: 0, error: err.message };
  }
}

// ============================================================================
// INICIALIZACIÓN Y EXPORTACIÓN
// ============================================================================

inicializarTablas();

// ✅ EJECUTAR TRIGGER DE LIMPIEZA CADA 5 MINUTOS
setInterval(limpiarUsuariosNoValidados, 5 * 60 * 1000); 

module.exports = {
  registrarUsuario,
  autenticarUsuario,
  registrarIntentoFallido,
  obtenerInfoUsuario,
  obtenerHistorialConexiones,
  cerrarSesion,
  generarCodigoValidacion,
  validarCodigoValidacion,
  limpiarCodigosExpirados,
  validarUsuario,
  validarCorreo,
  validarContrasena,
  inicializarTablas,
  CODIGO_ADMIN,
  actualizarUsuario,
  verificarContrasena,
  eliminarUsuarioPendiente,   
  limpiarUsuariosNoValidados, 
  obtenerTodosLosUsuarios,     
  eliminarUsuario,             
  actualizarActividad,         // ✅ NUEVO
  desconectarUsuariosInactivos // ✅ NUEVO
};