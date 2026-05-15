# 🤖 MINSEEK - Asistente IA Conversacional

**MINSEEK** es un sistema de chat inteligente impulsado por modelos IA locales (Ollama). Proporciona una plataforma segura, escalable y de múltiples capas con autenticación, gestión de recursos y soporte para múltiples categorías de tareas.

## ✨ Características Principales

### 🔐 Autenticación Segura
- Registro con validación de email Zimbra ()
- Contraseñas encriptadas con **bcrypt** (10 rounds)
- Login con historial de sesiones
- Auditoría completa de requests

### 💬 Chat Inteligente
- 8 categorías de modelos IA especializados
- Sistema de colas con límites de concurrencia por modelo
- Fallback automático si el modelo preferido está lleno
- Streaming de respuestas en tiempo real (SSE)

### 🛡️ Protecciones y Límites
- **Rate limiting**: 5 intentos de auth/15min, 20 mensajes de chat/min
- Sanitización de prompts (máx 20KB)
- Timeout automático (90s para chat, 30s para auth)
- Retry exponencial con backoff

### 🗄️ Base de Datos Robusta
- SQLite con WAL mode (lectura concurrente)
- Índices estratégicos para performance
- Triggers automáticos para sesiones
- Tablas de auditoría y logs

### 🏗️ Arquitectura de 3 Capas
```
Cliente (Frontend)
    ↓ HTTP
API Pública (Gateway + Rate Limiting)
    ↓ HTTP local
API Privada (Lógica + BD + Ollama)
```

---

## 🚀 Requisitos Previos

### Sistema
- **Node.js** ≥ 16.x
- **npm** ≥ 8.x
- **Ollama** corriendo en `http://localhost:11434`

### Verificar instalación
```bash
node --version    # v16+ requerido
npm --version     # 8+ requerido
ollama serve      # En otra terminal (Puerto 11434)
```

### Modelos Ollama Recomendados
```bash
ollama pull qwen2.5:1.5b         # Router rápido
ollama pull phi3:mini             # Consultas rápidas
ollama pull deepseek-r1:1.5b      # Razonamiento lite
ollama pull llama3.1:8b           # Redacción
ollama pull deepseek-r1:14b       # Análisis profundo
ollama pull codeqwen:7b           # Código
```

---

## 📦 Instalación

### 1. Clonar o descargar el repositorio
```bash
cd c:\Users\Tenebris\Desktop\work\MINSEEK
```

### 2. Instalar dependencias
```bash
npm install
```

Esto instalará:
- `express` - Framework web
- `better-sqlite3` - Base de datos SQLite
- `bcrypt` - Encriptación de contraseñas
- `express-rate-limit` - Límites de velocidad

### 3. Inicializar la base de datos
```bash
node Backend/init-db.js
```

Output esperado:
```
✅ Database setup completed successfully!
Tables created: Usuario, UltimasConversaciones, AuditoriaRequest, HistorialConexion, IntentoLogin
```

---

## ⚙️ Configuración

### Variables de Entorno (Opcional)

Crear archivo `.env` en la raíz del proyecto:

```env
# API Pública
PORT=2054
PRIVATE_API_URL=http://localhost:6969
PRIVATE_API_TOKEN=tu-token-secreto-aqui

# API Privada
PORT=6969
OLLAMA_BASE=http://localhost:11434

# Base de Datos
DATABASE_PATH=Backend/data/app.db
```

**Nota:** Si no existe `.env`, se usan los valores por defecto.

---

## 🎯 Cómo Ejecutar

### 1. Iniciar Ollama (en una terminal separada)
```bash
ollama serve
```

Esperar a que muestre:
```
Listening on [::1]:11434 (and 127.0.0.1:11434)
```

### 2. Iniciar API Privada (Terminal 1)
```bash
node Backend/ApiPrivada.js
```

Output esperado:
```
🔒 API Privada corriendo en http://localhost:6969
ℹ️ Conexión a Ollama: http://localhost:11434
```

### 3. Iniciar API Pública (Terminal 2)
```bash
node server.js
```

Output esperado:
```
✅ API Pública corriendo en http://localhost:2054
🔗 Conectando con API Privada en http://localhost:6969
```

### 4. Acceder en el navegador

| Página | URL |
|--------|-----|
| **Chat** | http://localhost:2054/ |
| **Login** | http://localhost:2054/InicioSesion/ |
| **Registro** | http://localhost:2054/Registro/ |

---

## 📁 Estructura del Proyecto

```
MINSEEK/
├── Backend/
│   ├── ApiPrivada.js              # 🔒 API privada (lógica + BD + Ollama)
│   ├── init-db.js                 # 🚀 Script de inicialización de BD
│   ├── setup.sql                  # 📋 Schema y triggers de BD
│   └── data/
│       └── app.db                 # 💾 Base de datos SQLite
│
├── public/                        # 🌐 Frontend estático
│   ├── Assets/                    # 🎨 Logos e imágenes
│   ├── InicioSesion/             # 🔐 Página de login
│   │   ├── index.html
│   │   ├── index.css
│   │   └── index.js
│   ├── Registro/                 # 📝 Página de registro
│   │   ├── Registrarse.html
│   │   ├── Registrarse.css
│   │   └── index.js
│   └── Chatbot/                  # 💬 Interfaz de chat
│       ├── ChatMinSeek.html
│       ├── ChatMinSeek.css
│       └── index.js
│
├── server.js                      # 🌍 API pública (gateway + rate limiting)
├── package.json                   # 📦 Dependencias
├── package-lock.json              # 📦 Lock de versiones
├── README.md                      # 📖 Este archivo
└── BDscript.txt                   # 📄 Documentación de BD
```

---

## 🔌 Endpoints de API

### API Pública (`http://localhost:2054`)

#### Registro de Usuario
```http
POST /api/registro
Content-Type: application/json

{
  "usuario": "juan.perez",
  "correo": "juan.perez@mail.das.pdr",
  "contrasena": "MiContrasena123"
}
```

**Respuesta éxito (201):**
```json
{
  "success": true,
  "message": "Cuenta registrada exitosamente",
  "userId": "uuid-aqui"
}
```

**Respuesta error (400):**
```json
{
  "success": false,
  "error": "El correo debe terminar en @mail.das.pdr"
}
```

---

#### Login de Usuario
```http
POST /api/login
Content-Type: application/json

{
  "usuario": "juan.perez",
  "contrasena": "MiContrasena123"
}
```

**Respuesta éxito (200):**
```json
{
  "success": true,
  "message": "Login exitoso",
  "userId": "uuid-aqui",
  "usuario": "juan.perez"
}
```

---

#### Chat (Público - Sin autenticación)
```http
POST /public/execute
Content-Type: application/json

{
  "prompt": "¿Cuál es la capital de Francia?",
  "categoria": "consulta_rapida"
}
```

**Categorías disponibles:**
- `consulta_rapida` - Preguntas rápidas (phi3, deepseek-r1:1.5b)
- `resumen` - Resumir textos (qwen2.5:3b)
- `redaccion` - Escritura creativa (llama3.1:8b)
- `razonamiento` - Lógica y análisis (deepseek-r1:7b)
- `analisis_profundo` - Análisis detallado (deepseek-r1:14b)
- `codigo` - Programación (codeqwen:7b)
- `multimodal` - Con imágenes (llava:7b)

**Respuesta (SSE streaming):**
```
data: {"content": "La capital de Francia es París."}

data: [DONE]
```

---

### API Privada (`http://localhost:6969`) - Solo Local

#### Registro
```http
POST /auth/register
```

#### Login
```http
POST /auth/login
```

#### Chat con IA
```http
POST /api/private/execute
```

---

## 🔐 Validaciones

### Email Zimbra
- ✅ Debe terminar en `@mail.das.pdr`
- ✅ Caracteres válidos: a-zA-Z0-9._-@
- ✅ Formato: `nombre@mail.das.pdr`

### Contraseña
- ✅ Mínimo 6 caracteres
- ✅ Se encripta con bcrypt (10 rounds)
- ✅ No se guarda en plain text

### Usuario
- ✅ Mínimo 3 caracteres
- ✅ Máximo 50 caracteres
- ✅ Debe ser único en la BD

---

## 📊 Base de Datos

### Tabla: Usuario
```sql
id                   TEXT PRIMARY KEY (UUID)
NombreUsuario        TEXT NOT NULL UNIQUE
Password             TEXT NOT NULL (bcrypt)
Correo               TEXT NOT NULL UNIQUE
FechaCreacionCuenta  TEXT (datetime)
FechaUltimaConexion  TEXT (datetime)
```

### Tabla: UltimasConversaciones
```sql
id                   TEXT PRIMARY KEY
idUsuario            TEXT NOT NULL (FK)
TituloConversacion   TEXT NOT NULL
FechaCreada          TEXT (datetime)
```

### Tabla: AuditoriaRequest
```sql
id                   INTEGER PRIMARY KEY
idUsuario            TEXT
IpOrigen             TEXT NOT NULL
UserAgent            TEXT
MetodoHttp           TEXT NOT NULL
RutaAccedida         TEXT NOT NULL
CodigoRespuesta      INTEGER NOT NULL
FechaRequest         TEXT (datetime)
```

### Tabla: IntentoLogin
```sql
id                   INTEGER PRIMARY KEY
Identificador        TEXT NOT NULL
IpOrigen             TEXT NOT NULL
EsExitoso            INTEGER (0/1)
FechaIntento         TEXT (datetime)
```

---

## 🐛 Troubleshooting

### Error: "Error al conectar con Ollama"
**Solución:**
```bash
# Verificar que Ollama está corriendo
curl http://localhost:11434/api/tags

# Si no devuelve JSON, iniciar Ollama:
ollama serve
```

### Error: "SQLITE_CANTOPEN"
**Solución:**
```bash
# Recrear la base de datos
rm Backend/data/app.db
node Backend/init-db.js
```

### Error: "EADDRINUSE :::2054"
**Solución:**
```bash
# El puerto 2054 ya está en uso
# Cambiar en server.js o matar el proceso anterior
npx kill-port 2054
```

### Error: "Rate limit exceeded"
**Esperado después de:**
- 5 intentos de registro/login en 15 minutos
- 20 mensajes de chat en 1 minuto

**Solución:** Esperar a que se reinicie el contador o cambiar IP

### Error: "El correo debe terminar en @mail"
**Solución:**
```
✅ Correo válido: usuario@mail
❌ Correo inválido: usuario@lima
```

---

## 📈 Monitoreo y Logs

### Ver logs en tiempo real
```bash
# API Pública con debug
DEBUG=express:* node server.js

# API Privada con verbose
NODE_DEBUG=http node Backend/ApiPrivada.js
```

### Logs disponibles en consola
- `ℹ️ Info` - Eventos normales
- `⚠️ Warn` - Advertencias
- `❌ Error` - Errores críticos

### Auditoría en BD
```bash
sqlite3 Backend/data/app.db "SELECT * FROM AuditoriaRequest LIMIT 10;"
```

---

## 🔒 Seguridad

### Implementado
- ✅ Contraseñas con bcrypt
- ✅ Rate limiting
- ✅ Sanitización de prompts
- ✅ Validación en 3 capas
- ✅ CORS (opcional)
- ✅ Auditoría de logs

### Recomendaciones para Producción
- 🔐 Agregar HTTPS/TLS
- 🔐 Usar JWT tokens
- 🔐 Implementar 2FA
- 🔐 Variables de entorno con secretos
- 🔐 Límites de CORS específicos
- 🔐 Backups automáticos de BD

---

## ⚡ Performance

### Optimizaciones Implementadas
- SQLite con WAL mode (escritura + lectura concurrente)
- Índices estratégicos en columnas frecuentes
- Sistema de colas para modelos IA
- Límites de concurrencia por modelo
- Timeout automático para requests largas
- Retry con backoff exponencial

### Benchmarks (Aproximados)
| Operación | Tiempo |
|-----------|--------|
| Registro usuario | 200-500ms |
| Login | 100-300ms |
| Chat (consulta rápida) | 1-3s |
| Chat (análisis profundo) | 5-20s |

---

## 🛠️ Desarrollo

### Agregar modelo IA nuevo
En `Backend/ApiPrivada.js`, sección `modelos`:
```javascript
const modelos = {
  mi_categoria: ["modelo:version"],
  // ...
};
```

### Crear tabla nueva
Editar `Backend/setup.sql` y ejecutar:
```bash
node Backend/init-db.js
```

### Cambiar puerto
En variables de entorno o archivos:
```bash
# server.js
const PORT = process.env.PORT || 2054;

# ApiPrivada.js
const PORT = process.env.PORT ? Number(process.env.PORT) : 6969;
```

---

## 📝 Ejemplos de Uso

### JavaScript (Fetch API)
```javascript
// Registro
const response = await fetch('/api/registro', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    usuario: 'juan.perez',
    correo: 'juan.perez@mail',
    contrasena: 'MiPassword123'
  })
});

const data = await response.json();
console.log(data.message); // "Cuenta registrada exitosamente"
```

### cURL
```bash
# Registro
curl -X POST http://localhost:2054/api/registro \
  -H "Content-Type: application/json" \
  -d '{
    "usuario": "juan.perez",
    "correo": "juan.perez@mail",
    "contrasena": "MiPassword123"
  }'

# Chat
curl -X POST http://localhost:2054/public/execute \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "¿Cuál es 2+2?",
    "categoria": "consulta_rapida"
  }'
```

---

## 🤝 Contribuciones

Las contribuciones son bienvenidas. Para cambios importantes:

1. Fork del repositorio
2. Crear rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit de cambios (`git commit -m 'Add AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

---

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver archivo `LICENSE` para más detalles.

---

## 📞 Soporte

- **Problemas**: Abrir issue en GitHub
- **Documentación**: Ver `Backend/setup.sql` para schema de BD
- **Ejemplo de BD**: Ver `BDscript.txt`

---

## 🚀 Roadmap

- [ ] Autenticación con Google/GitHub
- [ ] Histórico de conversaciones persistente
- [ ] Exportar chats a PDF
- [ ] Integración con otros modelos (OpenAI, Anthropic)
- [ ] Dashboard de administración
- [ ] API de estadísticas y analytics
- [ ] Soporte para múltiples idiomas

---

**Última actualización:** Mayo 2026
**Versión:** Beta 0.1
**Autor:** CCR Dev Team
