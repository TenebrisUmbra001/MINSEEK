// Backend/data/db.js
const Database = require('better-sqlite3');
const path = require('path');

// Conectar a la base de datos EXISTENTE
const db = new Database(path.join(__dirname, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;