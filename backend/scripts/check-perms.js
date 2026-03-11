const knex = require('knex')({
    client: 'pg',
    connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
});

async function run() {
    const admin = await knex('admin_users').whereRaw("email = 'GlynacAdmin@glynac.ai'").first();
    console.log('Admin:', admin);

    const links = await knex('admin_users_roles_lnk').where({ user_id: admin.id });
    console.log('Role Links:', links);

    for (const link of links) {
        const role = await knex('admin_roles').where({ id: link.role_id }).first();
        console.log('Role:', role);

        const perms = await knex('admin_permissions').where({ role_id: role.id, subject: 'api::blog-post.blog-post' });
        console.log(`Perms for ${role.code} on blog-post:`, perms);
    }

    process.exit(0);
}
run();
