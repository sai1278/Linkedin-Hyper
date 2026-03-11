const Database = require('better-sqlite3');
const db = new Database('.tmp/data.db');

try {
    console.log('--- All Tables ---');
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    console.table(tables.map(t => t.name));
} catch (err) {
    console.error(err);
}
