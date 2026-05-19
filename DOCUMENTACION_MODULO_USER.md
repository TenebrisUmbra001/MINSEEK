# Documentación - Módulo de Usuario

## 📋 Resumen

El módulo de usuario (`moduloUser.js`) es una **extensión especializada de la API privada** que centraliza toda la lógica de:
- ✅ Registro de nuevas cuentas de usuario
- ✅ Autenticación y login con protección contra SQL Injection
- ✅ Gestión de historial de conexiones
- ✅ Validación de datos de seguridad

**Importante:** Este módulo funciona con la estructura de base de datos existente en `app.db` y no intenta crear nuevas tablas.

## 🏗️ Arquitectura del Flujo

```
┌─────────────────┐
│  API Pública    │  (Puerto 2054)
│  server.js      │
└────────┬────────┘
         │
         │ Llamadas a endpoints
         │ /api/registro
         │ /api/login
         ▼
┌─────────────────────────────────────┐
│  API Privada - ApiPrivada.js        │  (Puerto 6969)
│  ├─ /auth/register (nueva)          │
│  ├─ /auth/login (nueva)             │
│  ├─ /auth/logout (nueva)            │
│  ├─ /auth/usuario/:id (nueva)       │
│  └─ /auth/historial/:id (nueva)     │
└────────┬────────────────────────────┘
         │
         │ Llama a funciones
         │
         ▼
┌─────────────────────────────────────┐
│  Módulo Usuario - moduloUser.js     │
│  ├─ registrarUsuario()              │
│  ├─ autenticarUsuario()             │
│  ├─ cerrarSesion()                  │
│  ├─ obtenerInfoUsuario()            │
│  ├─ obtenerHistorialConexiones()    │
│  └─ Validaciones de datos           │
└────────┬────────────────────────────┘
         │
         │ Usa Prepared Statements
         │ (Protección contra SQL Injection)
         │
         ▼
┌─────────────────────────────────────┐
│  Base de Datos SQLite - app.db      │
│  ├─ Tabla: Usuario                  │
│  └─ Tabla: HistorialConexion        │
└─────────────────────────────────────┘
```

## 🔐 Seguridad Implementada

### 1. **Protección contra SQL Injection**
El módulo utiliza **Prepared Statements** (consultas parametrizadas) en todas las operaciones con la BD:

```javascript
// ✅ SEGURO - Prepared Statement
db.prepare(
  'SELECT id FROM Usuario WHERE NombreUsuario = ? OR Correo = ? LIMIT 1'
).get(usuario, correo);

// ❌ INSEGURO - Concatenación directa (NO usado)
// db.prepare(`SELECT * FROM Usuario WHERE NombreUsuario = '${usuario}'`).all();
```

### 2. **Encriptación de Contraseñas**
- Se usa **bcrypt** con 12 rondas de salt
- Las contraseñas nunca se almacenan en texto plano
- La verificación usa `bcrypt.compare()` (protegido contra timing attacks)

### 3. **Validaciones Robustas**
- **Usuario**: 3-50 caracteres, solo alfanuméricos, guiones y guiones bajos
- **Correo**: Validación de formato y longitud máxima
- **Contraseña**: Mínimo 8 caracteres, requiere mayúscula, minúscula y número

### 4. **Gestión de Errores**
- No se revela información específica sobre usuarios/correos existentes
- Mensajes genéricos en fallos de autenticación
- Logging detallado para auditoría interna

### 5. **Historial de Conexiones**
- Cada login exitoso crea un registro en `HistorialConexion`
- Se guarda IP del cliente
- Permite detectar intentos de acceso no autorizados

## 📊 Estructura de Datos Existente

### Tabla: Usuario
```sql
CREATE TABLE IF NOT EXISTS Usuario (
    id TEXT PRIMARY KEY,              -- UUID único del usuario
    NombreUsuario TEXT NOT NULL UNIQUE,  -- Nombre de usuario (único)
    Password TEXT NOT NULL,           -- Hash bcrypt
    Correo TEXT NOT NULL UNIQUE,      -- Email (único)
    FechaCreacionCuenta TEXT NOT NULL DEFAULT (datetime('now')),
    FechaUltimaConexion TEXT,         -- Última conexión exitosa
    EstaConectado INTEGER NOT NULL DEFAULT 0  -- 0=Desconectado, 1=Conectado
);
```

### Tabla: HistorialConexion
```sql
CREATE TABLE IF NOT EXISTS HistorialConexion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- ID auto-incremento
    idUsuario TEXT NOT NULL,          -- Referencia a Usuario.id
    IpOrigen TEXT NOT NULL,           -- IP del cliente
    FechaConexion TEXT NOT NULL DEFAULT (datetime('now')), -- Momento del evento
    FechaDesconexion TEXT,            -- Cuando se cerró sesión
    EsExitosa INTEGER NOT NULL DEFAULT 1,  -- 1=exitoso, 0=fallido
    FOREIGN KEY (idUsuario) REFERENCES Usuario(id) ON DELETE CASCADE
);
```

## 🔌 Endpoints de la API Privada

### 1. Registro de Usuario
**POST** `/auth/register`

**Request:**
```json
{
  "usuario": "juan_perez",
  "correo": "juan@example.com",
  "contrasena": "MiPassword123"
}
```

**Respuesta Exitosa (201):**
```json
{
  "exitoso": true,
  "mensaje": "Usuario registrado exitosamente",
  "usuario": "juan_perez",
  "correo": "juan@example.com"
}
```

**Respuesta Error (400):**
```json
{
  "exitoso": false,
  "error": "Usuario debe tener al menos 3 caracteres",
  "codigo": "USUARIO_INVALIDO"
}
```

### 2. Login de Usuario
**POST** `/auth/login`

**Request:**
```json
{
  "usuario": "juan_perez",
  "contrasena": "MiPassword123"
}
```

**Respuesta Exitosa (200):**
```json
{
  "exitoso": true,
  "mensaje": "Autenticación exitosa",
  "idUsuario": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "usuario": "juan_perez",
  "correo": "juan@example.com",
  "idConexion": 42
}
```

**Respuesta Error (401):**
```json
{
  "exitoso": false,
  "error": "Usuario o contraseña incorrectos",
  "codigo": "CREDENCIALES_INVALIDAS"
}
```

### 3. Logout de Usuario
**POST** `/auth/logout`

**Request:**
```json
{
  "idConexion": 42
}
```

**Respuesta Exitosa (200):**
```json
{
  "exitoso": true,
  "mensaje": "Sesión cerrada exitosamente"
}
```

### 4. Obtener Información del Usuario
**GET** `/auth/usuario/:idUsuario`

**Respuesta Exitosa (200):**
```json
{
  "exitoso": true,
  "usuario": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "NombreUsuario": "juan_perez",
    "Correo": "juan@example.com",
    "EstaConectado": 1,
    "FechaCreacionCuenta": "2026-05-18T10:30:00.000Z",
    "FechaUltimaConexion": "2026-05-18T15:45:00.000Z"
  }
}
```

### 5. Obtener Historial de Conexiones
**GET** `/auth/historial/:idUsuario?limite=20`

**Respuesta Exitosa (200):**
```json
{
  "exitoso": true,
  "historial": [
    {
      "id": 42,
      "FechaConexion": "2026-05-18T15:45:00.000Z",
      "FechaDesconexion": "2026-05-18T16:00:00.000Z",
      "EsExitosa": 1,
      "IpOrigen": "192.168.1.100"
    },
    {
      "id": 41,
      "FechaConexion": "2026-05-18T10:30:00.000Z",
      "FechaDesconexion": null,
      "EsExitosa": 1,
      "IpOrigen": "192.168.1.100"
    }
  ]
}
```

## 🔄 Flujo de Registro

```
1. Usuario envía POST a /api/registro (API Pública)
   ↓
2. API Pública valida email Zimbra
   ↓
3. Reenvía a /auth/register (API Privada)
   ↓
4. API Privada llama a moduloUser.registrarUsuario()
   ↓
5. Módulo valida:
   - Usuario (3-50 caracteres, formato válido)
   - Correo (formato y longitud)
   - Contraseña (8+ caracteres, mayús/minús/números)
   ↓
6. Verifica que usuario/correo no existan (Prepared Statement)
   ↓
7. Hash contraseña con bcrypt (12 rondas)
   ↓
8. Inserta en BD (Prepared Statement)
   ↓
9. Retorna respuesta exitosa/error
```

## 🔄 Flujo de Login

```
1. Usuario envía POST a /api/login (API Pública)
   ↓
2. API Pública reenvía a /auth/login (API Privada)
   ↓
3. API Privada llama a moduloUser.autenticarUsuario()
   ↓
4. Busca usuario en BD (Prepared Statement)
   ↓
5. Si no existe → Error genérico (seguridad)
   ↓
6. Compara contraseña con bcrypt.compare()
   ↓
7. Si es incorrecta → Error genérico
   ↓
8. Si es correcta:
   - Registra en HistorialConexion (con IP)
   - Actualiza FechaUltimaConexion y EstaConectado
   - Retorna idConexion para futuro logout
   ↓
10. Retorna respuesta con tokens/session
```

## 🚀 Funciones Exportadas

```javascript
const moduloUser = require('./moduloUser');

// Registro
await moduloUser.registrarUsuario(usuario, correo, contrasena);

// Autenticación
await moduloUser.autenticarUsuario(usuario, contrasena, datosConexion);

// Sesión
moduloUser.cerrarSesion(idConexion);

// Información
moduloUser.obtenerInfoUsuario(idUsuario);
moduloUser.obtenerHistorialConexiones(idUsuario, limite);

// Validaciones (útiles para frontend)
moduloUser.validarUsuario(usuario);
moduloUser.validarCorreo(correo);
moduloUser.validarContrasena(contrasena);
```

## 📝 Códigos de Error

| Código | Descripción |
|--------|-------------|
| `USUARIO_INVALIDO` | Usuario no cumple requisitos |
| `CORREO_INVALIDO` | Formato de correo inválido |
| `CONTRASENA_INVALIDA` | Contraseña no cumple requisitos |
| `USUARIO_EXISTE` | Usuario o correo ya registrados |
| `CREDENCIALES_INVALIDAS` | Usuario o contraseña incorrectos |
| `CAMPOS_VACIOS` | Faltan campos requeridos |
| `ERROR_REGISTRO` | Error genérico en registro |
| `ERROR_AUTENTICACION` | Error genérico en autenticación |
| `ERROR_SERVIDOR` | Error interno del servidor |

## 🧪 Ejemplo de Uso Completo

### Desde JavaScript del cliente

```javascript
// Registro
const respRegistro = await fetch('/api/registro', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    usuario: 'juan_perez',
    correo: 'juan@example.com',
    contrasena: 'MiPassword123'
  })
});

const dataReg = await respRegistro.json();
console.log(dataReg.exitoso ? '✅ Registrado' : '❌ Error');

// Login
const respLogin = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    usuario: 'juan_perez',
    contrasena: 'MiPassword123'
  })
});

const dataLogin = await respLogin.json();
if (dataLogin.exitoso) {
  // Guardar idConexion para logout posterior
  sessionStorage.setItem('idConexion', dataLogin.idConexion);
  sessionStorage.setItem('idUsuario', dataLogin.idUsuario);
  window.location.href = '/dashboard';
}

// Logout
const respLogout = await fetch('/api/logout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    idConexion: sessionStorage.getItem('idConexion')
  })
});

if ((await respLogout.json()).exitoso) {
  sessionStorage.clear();
  window.location.href = '/';
}
```

## ⚙️ Configuración

### Requisitos
- Node.js v14+
- `express` (ya instalado)
- `better-sqlite3` (ya instalado)
- `bcrypt` (ya instalado)

### Instalación de dependencias (si falta)
```bash
npm install bcrypt better-sqlite3
```

## 📊 Monitoreo y Logs

El módulo genera logs detallados:

```
✅ ℹ️ Usuario registrado exitosamente: juan_perez
✅ ✅ Usuario autenticado exitosamente: juan_perez
⚠️ ⚠️ Intento de login fallido: contraseña incorrecta: juan_perez
❌ ❌ Error en registrarUsuario: UNIQUE constraint failed
```

## 🔍 Auditoría

Puedes revisar intentos de acceso:

```javascript
// Obtener historial de un usuario
GET /auth/historial/f47ac10b-58cc-4372-a567-0e02b2c3d479?limite=50
```

Esto mostrará todos los intentos (exitosos y fallidos) con IP y timestamp.

## 🛡️ Mejores Prácticas Implementadas

✅ Prepared Statements (todos los SQL)
✅ Bcrypt con 12 rondas de salt
✅ Validaciones en frontend y backend
✅ Mensajes de error genéricos
✅ Logging de auditoría
✅ Historial de conexiones
✅ Rate limiting (en API pública)
✅ Comprobación de credenciales segura
✅ Índices en BD para performance

## 📚 Archivos Modificados

- ✅ `Backend/moduloUser.js` - **NUEVO** - Módulo completo de usuario adaptado a tu BD
- ✅ `Backend/ApiPrivada.js` - **MODIFICADO** - Se agregaron 5 rutas de auth
- ✅ `Backend/data/db.js` - **SIN CAMBIOS** - Compatible
- ✅ `app.db` - **COMPATIBLE** - Usa estructura existente

## 🎯 Próximos Pasos (Opcionales)

1. **Recuperación de contraseña**: Agregar ruta de reset
2. **Verificación de email**: Enviar confirmación por correo
3. **2FA**: Autenticación de dos factores
4. **Tokens JWT**: Para stateless authentication
5. **Roles y permisos**: Sistema de autorización

## 🔌 Endpoints de la API Privada

### 1. Registro de Usuario
**POST** `/auth/register`

```json
{
  "usuario": "juan_perez",
  "correo": "juan@example.com",
  "contrasena": "MiPassword123"
}
```

**Respuesta Exitosa (201)**
```json
{
  "exitoso": true,
  "mensaje": "Usuario registrado exitosamente",
  "usuario": "juan_perez",
  "correo": "juan@example.com"
}
```

**Respuesta Error (400)**
```json
{
  "exitoso": false,
  "error": "Usuario debe tener al menos 3 caracteres",
  "codigo": "USUARIO_INVALIDO"
}
```

### 2. Login de Usuario
**POST** `/auth/login`

```json
{
  "usuario": "juan_perez",
  "contrasena": "MiPassword123"
}
```

**Respuesta Exitosa (200)**
```json
{
  "exitoso": true,
  "mensaje": "Autenticación exitosa",
  "idUsuario": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "usuario": "juan_perez",
  "correo": "juan@example.com",
  "idConexion": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Respuesta Error (401)**
```json
{
  "exitoso": false,
  "error": "Usuario o contraseña incorrectos",
  "codigo": "CREDENCIALES_INVALIDAS"
}
```

### 3. Logout de Usuario
**POST** `/auth/logout`

```json
{
  "idConexion": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Respuesta Exitosa (200)**
```json
{
  "exitoso": true,
  "mensaje": "Sesión cerrada exitosamente"
}
```

### 4. Obtener Información del Usuario
**GET** `/auth/usuario/:idUsuario`

**Respuesta Exitosa (200)**
```json
{
  "exitoso": true,
  "usuario": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "usuario": "juan_perez",
    "correo": "juan@example.com",
    "EstaConectado": 1,
    "FechaCreacion": "2026-05-18T10:30:00.000Z",
    "FechaUltimaConexion": "2026-05-18T15:45:00.000Z",
    "EstaActivo": 1
  }
}
```

### 5. Obtener Historial de Conexiones
**GET** `/auth/historial/:idUsuario?limite=20`

**Respuesta Exitosa (200)**
```json
{
  "exitoso": true,
  "historial": [
    {
      "id": "evt-123",
      "FechaConexion": "2026-05-18T15:45:00.000Z",
      "FechaDesconexion": "2026-05-18T16:00:00.000Z",
      "EsExitosa": 1,
      "DireccionIP": "192.168.1.100"
    },
    {
      "id": "evt-122",
      "FechaConexion": "2026-05-18T10:30:00.000Z",
      "FechaDesconexion": null,
      "EsExitosa": 1,
      "DireccionIP": "192.168.1.100"
    }
  ]
}
```

## 🔄 Flujo de Registro

```
1. Usuario envía POST a /api/registro (API Pública)
   ↓
2. API Pública valida email Zimbra
   ↓
3. Reenvía a /auth/register (API Privada)
   ↓
4. API Privada llama a moduloUser.registrarUsuario()
   ↓
5. Módulo valida:
   - Usuario (3-50 caracteres, formato válido)
   - Correo (formato y longitud)
   - Contraseña (8+ caracteres, mayús/minús/números)
   ↓
6. Verifica que usuario/correo no existan (Prepared Statement)
   ↓
7. Hash contraseña con bcrypt (12 rondas)
   ↓
8. Inserta en BD (Prepared Statement)
   ↓
9. Retorna respuesta exitosa/error
```

## 🔄 Flujo de Login

```
1. Usuario envía POST a /api/login (API Pública)
   ↓
2. API Pública reenvía a /auth/login (API Privada)
   ↓
3. API Privada llama a moduloUser.autenticarUsuario()
   ↓
4. Busca usuario en BD (Prepared Statement)
   ↓
5. Si no existe → Error genérico (seguridad)
   ↓
6. Verifica si cuenta está activa
   ↓
7. Compara contraseña con bcrypt.compare()
   ↓
8. Si es incorrecta → Error genérico
   ↓
9. Si es correcta:
   - Registra en HistorialConexion (con IP y UserAgent)
   - Retorna idConexion para futuro logout
   - Triggers automáticos actualizan FechaUltimaConexion
   ↓
10. Retorna respuesta con tokens/session
```

## 🚀 Funciones Exportadas

```javascript
const moduloUser = require('./moduloUser');

// Registro
await moduloUser.registrarUsuario(usuario, correo, contrasena);

// Autenticación
await moduloUser.autenticarUsuario(usuario, contrasena, datosConexion);

// Sesión
moduloUser.cerrarSesion(idConexion);

// Información
moduloUser.obtenerInfoUsuario(idUsuario);
moduloUser.obtenerHistorialConexiones(idUsuario, limite);

// Validaciones (útiles para frontend)
moduloUser.validarUsuario(usuario);
moduloUser.validarCorreo(correo);
moduloUser.validarContrasena(contrasena);
```

## 📝 Códigos de Error

| Código | Descripción |
|--------|-------------|
| `USUARIO_INVALIDO` | Usuario no cumple requisitos |
| `CORREO_INVALIDO` | Formato de correo inválido |
| `CONTRASENA_INVALIDA` | Contraseña no cumple requisitos |
| `USUARIO_EXISTE` | Usuario o correo ya registrados |
| `CREDENCIALES_INVALIDAS` | Usuario o contraseña incorrectos |
| `CUENTA_INACTIVA` | Cuenta desactivada por administrador |
| `CAMPOS_FALTANTES` | Faltan parámetros requeridos |
| `ERROR_REGISTRO` | Error genérico en registro |
| `ERROR_AUTENTICACION` | Error genérico en autenticación |
| `ERROR_SERVIDOR` | Error interno del servidor |

## 🧪 Ejemplo de Uso Completo

### Desde la API Pública (server.js)

```javascript
// Ya está configurado, los endpoints usan authLimiter (5 intentos/15min)

POST /api/registro
{
  "usuario": "nuevo_user",
  "correo": "user@example.com",
  "contrasena": "SecurePass123"
}

POST /api/login
{
  "usuario": "nuevo_user",
  "contrasena": "SecurePass123"
}
```

### Desde JavaScript del cliente

```javascript
// Registro
const respRegistro = await fetch('/api/registro', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    usuario: 'juan_perez',
    correo: 'juan@example.com',
    contrasena: 'MiPassword123'
  })
});

const dataReg = await respRegistro.json();
console.log(dataReg.exitoso ? '✅ Registrado' : '❌ Error');

// Login
const respLogin = await fetch('/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    usuario: 'juan_perez',
    contrasena: 'MiPassword123'
  })
});

const dataLogin = await respLogin.json();
if (dataLogin.exitoso) {
  // Guardar idConexion para logout posterior
  sessionStorage.setItem('idConexion', dataLogin.idConexion);
  sessionStorage.setItem('idUsuario', dataLogin.idUsuario);
  window.location.href = '/dashboard';
}
```

## ⚙️ Configuración

### Requisitos
- Node.js v14+
- `express` (ya instalado)
- `better-sqlite3` (ya instalado)
- `bcrypt` (ya instalado)

### Instalación de dependencias (si falta)
```bash
npm install bcrypt better-sqlite3
```

### Variables de entorno (opcionales)
```
PRIVATE_API_URL=http://localhost:6969
PRIVATE_API_TOKEN=tu_token_opcional
```

## 📊 Monitoreo y Logs

El módulo genera logs detallados:

```
✅ ℹ️ Usuario registrado exitosamente: juan_perez
✅ ✅ Usuario autenticado exitosamente: juan_perez
⚠️ ⚠️ Intento de login fallido: contraseña incorrecta: juan_perez
❌ ❌ Error en registrarUsuario: Duplicate entry
```

## 🔍 Auditoría

Puedes revisar intentos de acceso:

```javascript
// Obtener historial de un usuario
GET /auth/historial/f47ac10b-58cc-4372-a567-0e02b2c3d479?limite=50
```

Esto te mostrará todos los intentos (exitosos y fallidos) con IP y timestamp.

## 🛡️ Mejores Prácticas Implementadas

✅ Prepared Statements (todos los SQL)
✅ Bcrypt con 12 rondas de salt
✅ Validaciones en frontend y backend
✅ Mensajes de error genéricos
✅ Logging de auditoría
✅ Historial de conexiones
✅ Rate limiting (en API pública)
✅ Comprobación de cuenta activa
✅ Índices en BD para performance

## 📚 Archivos Modificados

- ✅ `Backend/moduloUser.js` - **NUEVO** - Módulo completo de usuario
- ✅ `Backend/ApiPrivada.js` - **MODIFICADO** - Se agregaron 5 rutas de auth
- ✅ `Backend/data/db.js` - **SIN CAMBIOS** - Compatible tal como está

## 🎯 Próximos Pasos (Opcionales)

1. **Recuperación de contraseña**: Agregar ruta de reset
2. **Verificación de email**: Enviar confirmación por correo
3. **2FA**: Autenticación de dos factores
4. **Tokens JWT**: Para stateless authentication
5. **Roles y permisos**: Sistema de autorización
