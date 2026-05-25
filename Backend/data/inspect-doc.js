// Backend/inspect-doc.js
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname,  'app.db'); // ajustado a Backend/data/app.db
console.log('Usando DB en:', dbPath);

const db = new Database(dbPath, { readonly: true });

const rows = db.prepare("SELECT id, nombre, length(contenido) AS len, substr(contenido,1,500) AS preview, created_at FROM documentos ORDER BY created_at DESC LIMIT 10").all();
console.log('Encontrados:', rows.length);
rows.forEach((r, i) => {
  console.log('---', i+1, '---');
  console.log('id:', r.id);
  console.log('nombre:', r.nombre);
  console.log('len:', r.len);
  console.log('created_at:', r.created_at);
  console.log('preview:', (r.preview || '').replace(/\n/g, ' ').substring(0, 300));
});
db.close();
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'app.db');
const db = new Database(dbPath);

// 1. Crear tabla temporal con la nueva estructura
db.exec(`
  CREATE TABLE Usuario_new (
    Correo TEXT PRIMARY KEY,
    NombreUsuario TEXT NOT NULL UNIQUE,
    Password TEXT NOT NULL,
    FechaCreacionCuenta TEXT NOT NULL DEFAULT (datetime('now')),
    FechaUltimaConexion TEXT,
    EstaConectado INTEGER NOT NULL DEFAULT 0,
    NombreVisible TEXT
  );
`);

// 2. Copiar datos de la tabla vieja a la nueva
const existing = db.prepare("SELECT * FROM Usuario").all();

const insert = db.prepare(`
  INSERT INTO Usuario_new (Correo, NombreUsuario, Password, FechaCreacionCuenta, FechaUltimaConexion, EstaConectado, NombreVisible)
  VALUES (@Correo, @NombreUsuario, @Password, @FechaCreacionCuenta, @FechaUltimaConexion, @EstaConectado, @NombreVisible)
`);

const migrate = db.transaction((rows) => {
  for (const row of rows) {
    insert.run({
      Correo: row.Correo,
      NombreUsuario: row.NombreUsuario,
      Password: row.Password,
      FechaCreacionCuenta: row.FechaCreacionCuenta,
      FechaUltimaConexion: row.FechaUltimaConexion,
      EstaConectado: row.EstaConectado,
      NombreVisible: row.NombreVisible || row.NombreUsuario  // fallback si estaba vacío
    });
  }
});

migrate(existing);
console.log('Migrados', existing.length, 'usuarios');

// 3. Reemplazar tabla vieja por la nueva
db.exec(`
  DROP TABLE Usuario;
  ALTER TABLE Usuario_new RENAME TO Usuario;
`);

console.log('Migración completada ✓');
db.close();