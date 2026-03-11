// Quick DB introspection — run with: node scripts/list-tables.js
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const client = process.env.DATABASE_CLIENT || 'sqlite';
let knexCfg;
if (['sqlite', 'sqlite3'].includes(client)) {
    knexCfg = { client: 'better-sqlite3', connection: { filename: process.env.DATABASE_FILENAME || path.join(__dirname, '..', '.tmp', 'data.db') }, useNullAsDefault: true };
} else {
    knexCfg = { client, connection: { host: process.env.DATABASE_HOST, port: +process.env.DATABASE_PORT, database: process.env.DATABASE_NAME, user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false } };
}
const knex = require('knex')(knexCfg);

async function main() {
    // All tables
    let tables;
    if (['sqlite', 'sqlite3', 'better-sqlite3'].includes(knexCfg.client)) {
        tables = await knex.raw("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        tables = tables.map(r => r.name);
    } else {
        const r = await knex.raw("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name");
        tables = (r.rows || r[0]).map(r => r.table_name);
    }
    console.log('\n=== ALL TABLES ===');
    tables.forEach(t => console.log(' ', t));

    // admin_users columns
    console.log('\n=== admin_users columns ===');
    const cols = await knex('admin_users').columnInfo();
    Object.keys(cols).forEach(c => console.log(' ', c));

    // admin_users rows (limited)
    console.log('\n=== admin_users rows ===');
    const users = await knex('admin_users').select('id', 'email', 'is_active', 'tenant_id').orderBy('id');
    users.forEach(u => console.log(`  id=${u.id} tenant_id=${u.tenant_id} email=${u.email}`));

    // junction table search
    for (const t of ['admin_users_roles_lnk', 'admin_users_roles_links']) {
        if (tables.includes(t)) {
            console.log(`\n=== ${t} rows ===`);
            const rows = await knex(t).select('*');
            rows.forEach(r => console.log(' ', JSON.stringify(r)));
        }
    }

    await knex.destroy();
}
main().catch(e => { console.error(e); process.exit(1); });
