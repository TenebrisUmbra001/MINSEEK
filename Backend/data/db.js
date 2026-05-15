const Database = require('better-sqlite3');
const path = require('path');

// Como db.js y app.db están en el mismo directorio, usamos __dirname directamente
const dbPath = path.join(__dirname, 'app.db');

// 1. Conexión a la base de datos
const db = new Database(dbPath);

// 2. Configuraciones de Producción (PRAGMAs)
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

console.log('✅ Conexión a la base de datos establecida y PRAGMAs configurados.');

// ============================================================================
// 3. MIGRACIONES: Asegurar que la columna y triggers existan
// ============================================================================

// Añadir columna 'EstaConectado' de forma segura (SQLite no tiene IF NOT EXISTS para ALTER TABLE)
try {
    db.exec(`ALTER TABLE Usuario ADD COLUMN EstaConectado INTEGER NOT NULL DEFAULT 0;`);
    console.log('✅ Columna "EstaConectado" añadida a la tabla Usuario.');
} catch (err) {
    // Si la columna ya existe, SQLite lanzará un error, lo ignoramos tranquilamente
    if (err.message.includes('duplicate column name')) {
        console.log('ℹ️ La columna "EstaConectado" ya existe en Usuario.');
    } else {
        console.error('❌ Error al añadir columna EstaConectado:', err.message);
    }
}

// 4. Crear/Actualizar los Triggers
// Usamos DROP IF EXISTS antes de crearlos para asegurarnos de tener la versión más reciente
db.exec(`
    -- Limpiar triggers previos por si los modificamos
    DROP TRIGGER IF EXISTS trg_cerrar_sesion_anterior;
    DROP TRIGGER IF EXISTS trg_actualizar_ultima_conexion;
    DROP TRIGGER IF EXISTS trg_marcar_conectado;
    DROP TRIGGER IF EXISTS trg_marcar_desconectado;

    -- Trigger original: Cerrar sesiones abiertas anteriores al iniciar una nueva
    CREATE TRIGGER trg_cerrar_sesion_anterior
    AFTER INSERT ON HistorialConexion
    FOR EACH ROW
    WHEN NEW.EsExitosa = 1
    BEGIN
        UPDATE HistorialConexion 
        SET FechaDesconexion = NEW.FechaConexion 
        WHERE idUsuario = NEW.idUsuario AND FechaDesconexion IS NULL;
    END;

    -- Trigger original: Actualizar la fecha de última conexión
    CREATE TRIGGER trg_actualizar_ultima_conexion
    AFTER INSERT ON HistorialConexion
    FOR EACH ROW
    WHEN NEW.EsExitosa = 1
    BEGIN
        UPDATE Usuario 
        SET FechaUltimaConexion = NEW.FechaConexion 
        WHERE id = NEW.idUsuario;
    END;

    -- NUEVO Trigger: Marcar como conectado en la tabla Usuario
    CREATE TRIGGER trg_marcar_conectado
    AFTER INSERT ON HistorialConexion
    FOR EACH ROW
    WHEN NEW.EsExitosa = 1
    BEGIN
        UPDATE Usuario 
        SET EstaConectado = 1 
        WHERE id = NEW.idUsuario;
    END;

    -- NUEVO Trigger: Marcar como desconectado (validando que no haya OTRA sesión activa)
    CREATE TRIGGER trg_marcar_desconectado
    AFTER UPDATE OF FechaDesconexion ON HistorialConexion
    FOR EACH ROW
    WHEN NEW.FechaDesconexion IS NOT NULL
    BEGIN
        UPDATE Usuario 
        SET EstaConectado = 0 
        WHERE id = NEW.idUsuario 
          AND NOT EXISTS (
              SELECT 1 FROM HistorialConexion 
              WHERE idUsuario = NEW.idUsuario 
                AND FechaDesconexion IS NULL 
                AND id != NEW.id
          );
    END;
`);

console.log('✅ Triggers de sesión y estado online configurados correctamente.');

// 5. Exportar la instancia de la base de datos para usarla en los controladores
module.exports = db;