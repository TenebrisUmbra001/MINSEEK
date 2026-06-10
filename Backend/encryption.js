// Backend/encryption.js
/**
 * Cifrado AES-256-GCM para conversaciones
 * - Clave derivada por usuario (HMAC-SHA256 de clave maestra + userId)
 * - Cada conversación tiene su propio IV aleatorio
 * - Auth tag garantiza integridad
 *
 * ⚠️ ENCRYPTION_KEY debe configurarse como variable de entorno
 *    NUNCA cambiarla (si cambia, todos los datos cifrados se pierden)
 */

var crypto = require('crypto');

var ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || null;
var masterKey = null;

function getMasterKey() {
  if (masterKey) return masterKey;

  if (ENCRYPTION_KEY) {
    masterKey = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (masterKey.length !== 32) {
      throw new Error('ENCRYPTION_KEY debe tener exactamente 64 caracteres hex (32 bytes)');
    }
  } else {
    console.warn('⚠️ [ENCRYPTION] ENCRYPTION_KEY no configurada. Usando clave temporal.');
    console.warn('⚠️ [ENCRYPTION] Configure ENCRYPTION_KEY en variables de entorno para producción.');
    masterKey = crypto.randomBytes(32);
  }

  return masterKey;
}

/**
 * Deriva una clave única por usuario usando HMAC-SHA256
 * Comprometer una clave no compromete las conversaciones de otros usuarios
 */
function deriveUserKey(userId) {
  var key = getMasterKey();
  var hmac = crypto.createHmac('sha256', key);
  hmac.update('iaccr-conv:' + userId);
  return hmac.digest();
}

/**
 * Cifra texto plano con AES-256-GCM
 * @param {string} plaintext
 * @param {string} userId
 * @returns {{ encrypted: Buffer, iv: Buffer, authTag: Buffer }}
 */
function encrypt(plaintext, userId) {
  var userKey = deriveUserKey(userId);
  var iv = crypto.randomBytes(12);
  var cipher = crypto.createCipheriv('aes-256-gcm', userKey, iv);

  var encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  var authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted,
    iv: iv,
    authTag: authTag
  };
}

/**
 * Descifra con AES-256-GCM
 * @throws {Error} si datos corruptos o clave incorrecta
 */
function decrypt(encrypted, iv, authTag, userId) {
  var userKey = deriveUserKey(userId);
  var decipher = crypto.createDecipheriv('aes-256-gcm', userKey, iv);
  decipher.setAuthTag(authTag);

  var decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Genera una clave maestra aleatoria (ejecutar una vez para configuración)
 */
function generarClaveMaestra() {
  var key = crypto.randomBytes(32);
  console.log('🔐 Clave maestra generada (guárdela como ENCRYPTION_KEY):');
  console.log(key.toString('hex'));
  return key.toString('hex');
}

try {
  getMasterKey();
  console.log('✅ [ENCRYPTION] Módulo de cifrado inicializado correctamente');
} catch (err) {
  console.error('❌ [ENCRYPTION] Error:', err.message);
}

module.exports = {
  encrypt: encrypt,
  decrypt: decrypt,
  generarClaveMaestra: generarClaveMaestra
};