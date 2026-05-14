const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Asegúrate de que la carpeta 'data' exista
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

const dbPath = path.join(dataDir, 'app.db');
const sqlPath = path.join(__dirname, 'setup.sql');

console.log(`Connecting to database at: ${dbPath}`);
const db = new Database(dbPath);

try {
    console.log('Reading SQL setup file...');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Executing SQL script...');
    db.exec(sql);
    
    console.log('✅ Database setup completed successfully!');
    
    // Verificación rápida
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables created:', tables.map(t => t.name).join(', '));

} catch (error) {
    console.error('❌ Error setting up the database:', error.message);
    process.exit(1);
} finally {
    // Cerrar la conexión
    db.close();
}