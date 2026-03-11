/**
 * RBAC Repair & Diagnostic Script
 *
 * Usage (PostgreSQL / production):
 *   DATABASE_URL=postgres://user:pass@host:5432/db node scripts/diagnose-rbac.js
 *
 * Usage (SQLite / local):
 *   node scripts/diagnose-rbac.js
 *
 * What it does:
 *   1. Lists all junction table candidates
 *   2. Shows every tenant admin: whether they exist, have a tenant linked,
 *      and which role is assigned
 *   3. Lists all admin roles and all tenants
 *   4. Optionally repairs: pass --fix to force-assign correct roles
 *
 * --fix mode will:
 *   - Set tenant_id on the user row
 *   - Delete existing role links and insert the correct one
 */

'use strict';

const path = require('path');

// Load .env if present (local dev)
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch { }

const FIX_MODE = process.argv.includes('--fix');

// ── Knex config ───────────────────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL;
let knexCfg;

if (databaseUrl) {
    knexCfg = {
        client: 'pg',
        connection: { connectionString: databaseUrl, ssl: { rejectUnauthorized: false } },
    };
} else {
    const dbFile = process.env.DATABASE_FILENAME || path.join(__dirname, '..', '.tmp', 'data.db');
    knexCfg = { client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true };
}

const knex = require('knex')(knexCfg);

// ── Expected mappings ─────────────────────────────────────────────────────────
const TENANT_ADMIN_MAP = [
    { email: 'GlynacAdmin@glynac.ai', tenantSlug: 'glynac-ai', roleCode: 'glynac-admin' },
    { email: 'admin@sylvannotes.com', tenantSlug: 'sylvian', roleCode: 'sylvan-admin' },
    { email: 'admin@regulatethis.com', tenantSlug: 'regulatethis', roleCode: 'regulatethis-admin' },
];

async function run() {
    console.log('\n══════════════════════════════════════════════════════');
    console.log(` RBAC DIAGNOSTIC${FIX_MODE ? ' + REPAIR' : ''}`);
    console.log(`  Mode: ${databaseUrl ? 'PostgreSQL' : 'SQLite (local)'}`);
    if (FIX_MODE) console.log('  ⚠️  --fix flag active: will repair roles/tenants');
    console.log('══════════════════════════════════════════════════════\n');

    // ── 1. Detect junction table ────────────────────────────────────────────
    let junctionTable = null;
    for (const candidate of ['admin_users_roles_lnk', 'admin_users_roles_links']) {
        const exists = await knex.schema.hasTable(candidate);
        console.log(`Junction table '${candidate}': ${exists ? '✅ exists' : '❌ missing'}`);
        if (exists && !junctionTable) junctionTable = candidate;
    }
    console.log(junctionTable ? `\n✅ Using: ${junctionTable}\n` : '\n❌ No junction table found!\n');

    // ── 2. Load all admin roles ─────────────────────────────────────────────
    const allRoles = await knex('admin_roles').orderBy('id');
    console.log('──────────────────────────────────────────────────────');
    console.log(' ADMIN ROLES');
    allRoles.forEach(r => console.log(`  id=${r.id} | code=${r.code} | name=${r.name}`));

    // ── 3. Load all tenants ─────────────────────────────────────────────────
    const allTenants = await knex('tenants').orderBy('id');
    console.log('\n──────────────────────────────────────────────────────');
    console.log(' TENANTS');
    allTenants.forEach(t => console.log(`  id=${t.id} | slug=${t.slug} | name=${t.name}`));

    // ── 4. Check each tenant admin ──────────────────────────────────────────
    console.log('\n──────────────────────────────────────────────────────');
    console.log(' TENANT ADMIN USERS');
    console.log('──────────────────────────────────────────────────────');

    for (const def of TENANT_ADMIN_MAP) {
        console.log(`\n▸ ${def.email}`);

        // Find user (case-insensitive)
        const user = await knex('admin_users')
            .whereRaw('LOWER(email) = LOWER(?)', [def.email])
            .first();

        if (!user) {
            console.log('  ❌ User NOT FOUND in admin_users');
            continue;
        }
        console.log(`  id=${user.id} | is_active=${user.is_active} | tenant_id=${user.tenant_id ?? '⚠️  NULL'}`);

        // Expected tenant
        const expectedTenant = allTenants.find(t => t.slug === def.tenantSlug);
        if (!expectedTenant) {
            console.log(`  ⚠️  Tenant slug '${def.tenantSlug}' not found in DB`);
        } else {
            const tenantOk = user.tenant_id === expectedTenant.id;
            console.log(`  tenant: expected id=${expectedTenant.id} (${def.tenantSlug}) → ${tenantOk ? '✅ linked' : '❌ MISMATCH or NULL'}`);

            if (!tenantOk && FIX_MODE) {
                await knex('admin_users').where({ id: user.id }).update({ tenant_id: expectedTenant.id });
                console.log(`  ✅ FIXED tenant_id → ${expectedTenant.id}`);
            }
        }

        // Expected role
        if (!junctionTable) {
            console.log('  ⚠️  Cannot check roles — no junction table');
            continue;
        }

        const expectedRole = allRoles.find(r => r.code === def.roleCode);
        if (!expectedRole) {
            console.log(`  ⚠️  Role code '${def.roleCode}' not found in admin_roles`);
            continue;
        }

        const roleLinks = await knex(junctionTable).where({ user_id: user.id });
        if (roleLinks.length === 0) {
            console.log(`  roles: ❌ NONE in ${junctionTable}`);
        } else {
            for (const link of roleLinks) {
                const r = allRoles.find(r => r.id === link.role_id);
                const isCorrect = link.role_id === expectedRole.id;
                console.log(`  role: id=${link.role_id} ${r ? `(${r.code})` : '(unknown)'} → ${isCorrect ? '✅ CORRECT' : '❌ WRONG (expected ' + def.roleCode + ')'}`);
            }
        }

        const hasCorrectRole = roleLinks.some(l => l.role_id === expectedRole.id);
        if (!hasCorrectRole && FIX_MODE) {
            await knex(junctionTable).where({ user_id: user.id }).delete();
            await knex(junctionTable).insert({ user_id: user.id, role_id: expectedRole.id });
            console.log(`  ✅ FIXED role → ${def.roleCode} (id=${expectedRole.id})`);
        }
    }

    console.log('\n══════════════════════════════════════════════════════\n');
    await knex.destroy();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
