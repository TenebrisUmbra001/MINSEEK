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
