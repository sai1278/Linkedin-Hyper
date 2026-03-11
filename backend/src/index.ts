import type { Core } from '@strapi/strapi';

// Seed data for default tenant
const defaultTenantData = {
  name: 'RegulateThis',
  slug: 'regulatethis',
  domain: 'regulatethis.com',
  isActive: true,
  primaryColor: '#49648C',
  secondaryColor: '#1a1a2e',
  description: 'The original RegulateThis blog platform'
};

// Seed data for Sylvian tenant
const sylvianTenantData = {
  name: 'Sylvan',
  slug: 'sylvian',
  domain: 'sylvannotes.com',
  isActive: true,
  primaryColor: '#000000', // Placeholder, can be updated
  secondaryColor: '#ffffff', // Placeholder, can be updated
  description: 'Standardized structured real estate income platform providing repeatable structure, workflow, and audit-ready documentation for institutional-grade real estate income investing.'
};

// Seed data for Glynac AI tenant
const glynacTenantData = {
  name: 'Glynac AI',
  slug: 'glynac-ai',
  domain: 'glynac.ai',
  isActive: true,
  primaryColor: '#6366f1',
  secondaryColor: '#1e1b4b',
  description: 'Glynac AI platform for intelligent automation and insights'
};

// Seed data for Pillars
const pillarsData = [
  {
    name: 'Practice Management',
    slug: 'practice-management',
    subtitle: 'Building Firms That Work',
    description: 'Growth creates problems. Good problems, but problems nonetheless. Our practice management coverage digs into compensation structures, talent acquisition, client segmentation, and the operational decisions that separate thriving firms from struggling ones.',
    color: '#49648C',
    order: 1,
    details: [
      { detail: 'Succession & Transition — Planning exits, buying books, and everything in between' },
      { detail: 'Scaling Operations — What breaks first when your AUM doubles' },
      { detail: 'Client Experience — Retention starts long before the annual review' },
    ],
  },
  {
    name: 'Wealth Management Tech',
    slug: 'wealth-management-tech',
    subtitle: 'Cutting Through the Noise',
    description: 'Every new app claims to be the solution. We test those claims against reality — focusing on what actually improves client outcomes and firm efficiency, and calling it out when something falls short of the hype.',
    color: '#49648C',
    order: 2,
    details: [
      { detail: 'Portfolio management platforms compared head-to-head' },
      { detail: 'CRM solutions that advisors actually use' },
      { detail: 'Reporting tools clients appreciate' },
      { detail: 'Integration challenges and how firms solve them' },
      { detail: 'Security considerations that matter now' },
    ],
  },
  {
    name: 'Compliance & Regulation',
    slug: 'compliance-regulation',
    subtitle: 'Keeping You Ahead of the Curve',
    description: 'Regulatory shifts rarely arrive with clear instructions. We track SEC guidance, state-level changes, and industry standards — then translate what it means for your policies, disclosures, and daily operations.',
    color: '#49648C',
    order: 3,
    details: [
      { detail: 'Marketing Rule Developments — Advertising, testimonials, and social media guidance' },
      { detail: 'Examination Priorities — Where regulators are focusing their attention' },
      { detail: 'Cybersecurity Standards — Requirements keep evolving. So should your approach' },
    ],
  },
];

// Tenant user account definitions
const tenantUsers = [
  {
    username: 'regulatethis-user',
    email: 'regulatethis-user@regulatethis.com',
    password: 'RegulateThis123!',
    tenantSlug: 'regulatethis',
    roleName: 'RegulateThis User',
    roleDescription: 'User role scoped to RegulateThis tenant content only',
  },
  {
    username: 'sylvan-user',
    email: 'sylvan-user@sylvannotes.com',
    password: 'Sylvan123!',
    tenantSlug: 'sylvian',
    roleName: 'Sylvan User',
    roleDescription: 'User role scoped to Sylvan tenant content only',
  },
  {
    username: 'glynac-user',
    email: 'glynac-user@glynac.ai',
    password: 'GlynacAI123!',
    tenantSlug: 'glynac-ai',
    roleName: 'Glynac AI User',
    roleDescription: 'User role scoped to Glynac AI tenant content only',
  },
];

// Content-type API UIDs that tenant users should have access to
const tenantScopedContentTypes = [
  'api::article.article',
  'api::author.author',
  'api::category.category',
  'api::tag.tag',
  'api::pillar.pillar',
  'api::subcategory.subcategory',
  'api::site-setting.site-setting',
  'api::tenant.tenant',
  'api::blog-post.blog-post',
  'api::regulatethis-subscriber.regulatethis-subscriber',
  'api::sylvan-request-access.sylvan-request-access',
];

// Tenant admin accounts (Strapi Admin Panel)
const tenantAdmins = [
  {
    firstname: 'RegulateThis',
    lastname: 'Admin',
    email: 'admin@regulatethis.com',
    password: 'RegulateThisAdmin123',
    username: 'regulatethisAdmin',
    tenantSlug: 'regulatethis',
    isActive: true,
  },
  {
    firstname: 'Sylvan',
    lastname: 'Admin',
    email: 'admin@sylvannotes.com',
    password: 'SylvanAdmin123',
    username: 'sylvanAdmin',
    tenantSlug: 'sylvian',
    isActive: true,
  },
  {
    firstname: 'Glynac',
    lastname: 'Admin',
    email: 'GlynacAdmin@glynac.ai',
    password: 'GlynacAdmin123',
    username: 'glynacAdmin',
    tenantSlug: 'glynac-ai',
    isActive: true,
  },
];

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Note: The admin::user tenant relation is now defined via schema extension:
    // src/extensions/admin/content-types/user/schema.json
    // This is preferred over dynamic injection as it creates a proper DB column.
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // ─── 1. Seed Tenants ───────────────────────────────────────────────
    // FIX A: seedTenant always returns an object with integer `id` AND `documentId`.
    // strapi.documents() (Document Service) omits the integer `id` column.
    // Without integer id: admin user's tenant FK is written as `undefined` → stays NULL in DB.
    // repairOrphans also receives targetTenant.id=undefined → silently skips all repairs.
    const seedTenant = async (tenantData: typeof defaultTenantData) => {
      // strapi.db.query guarantees integer id in result
      let tenant = await strapi.db.query('api::tenant.tenant').findOne({
        where: {
          $or: [
            { slug: tenantData.slug },
            { domain: tenantData.domain },
          ],
        },
      });

      if (!tenant) {
        console.log(`⚙️ Seeding tenant: ${tenantData.name}...`);
        // Use Document Service for create (handles status:'published' correctly)
        await strapi.documents('api::tenant.tenant').create({
          data: tenantData,
          status: 'published',
        });
        // Re-fetch via db.query to get the integer id
        tenant = await strapi.db.query('api::tenant.tenant').findOne({
          where: { slug: tenantData.slug },
        });
        console.log(`✅ Tenant ${tenantData.name} created! (db id=${tenant?.id})`);
      } else {
        console.log(`📋 Tenant ${tenantData.name} already exists (db id=${tenant.id}), skipping seed.`);
      }
      return tenant;
    };

    const defaultTenant = await seedTenant(defaultTenantData);
    const sylvianTenant = await seedTenant(sylvianTenantData);
    const glynacTenant = await seedTenant(glynacTenantData);

    // Build a slug-to-tenant map for user creation
    const tenantMap: Record<string, any> = {};
    if (defaultTenant) tenantMap[defaultTenantData.slug] = defaultTenant;
    if (sylvianTenant) tenantMap[sylvianTenantData.slug] = sylvianTenant;
    if (glynacTenant) tenantMap[glynacTenantData.slug] = glynacTenant;

    // ─── 2. Seed Pillars (for RegulateThis tenant) ────────────────────
    if (defaultTenant) {
      for (const pillar of pillarsData) {
        const existingPillar = await strapi.documents('api::pillar.pillar').findFirst({
          filters: {
            slug: pillar.slug,
          },
        });

        if (!existingPillar) {
          console.log(`⚙️ Seeding pillar: ${pillar.name}...`);
          const { color, ...pillarData } = pillar as any;
          await strapi.documents('api::pillar.pillar').create({
            data: {
              ...pillarData,
              tenant: defaultTenant.documentId,
            },
            status: 'published',
          });
          console.log(`✅ Pillar ${pillar.name} created!`);
        } else {
          console.log(`📋 Pillar ${pillar.name} already exists, skipping seed.`);
        }
      }
    }

    // ─── 3. Seed Site Settings ─────────────────────────────────────────
    const seedSiteSettings = async (
      tenant: any,
      siteName: string,
      siteDescription: string
    ) => {
      if (!tenant) return;
      const existing = await strapi.documents('api::site-setting.site-setting').findMany({
        filters: { tenant: { documentId: tenant.documentId } }
      });

      if (existing.length === 0) {
        console.log(`⚙️ Seeding ${siteName} site settings...`);
        await strapi.documents('api::site-setting.site-setting').create({
          data: {
            siteName,
            siteDescription,
            gtmEnabled: false,
            gaEnabled: false,
            metaPixelEnabled: false,
            tenant: tenant.documentId,
          },
          status: 'published',
        });
        console.log(`✅ ${siteName} site settings created!`);
      } else {
        console.log(`📋 ${siteName} site settings already exist, skipping seed.`);
      }
    };

    await seedSiteSettings(
      defaultTenant,
      'RegulateThis',
      'Expert insights on wealth management, compliance, and practice management for financial advisors.'
    );
    await seedSiteSettings(
      sylvianTenant,
      'Sylvan',
      'Structure. Yield. Growth.'
    );
    await seedSiteSettings(
      glynacTenant,
      'Glynac AI',
      'Intelligent automation and insights powered by Glynac AI.'
    );


    // ─── 4. Seed Tenant-Scoped Roles & User Accounts ──────────────────
    for (const userDef of tenantUsers) {
      const tenant = tenantMap[userDef.tenantSlug];
      if (!tenant) {
        console.log(`⚠️ Tenant ${userDef.tenantSlug} not found, skipping user ${userDef.username}`);
        continue;
      }

      // Create or find the custom role
      let role = await strapi.db.query('plugin::users-permissions.role').findOne({
        where: { name: userDef.roleName },
      });

      if (!role) {
        console.log(`⚙️ Creating role: ${userDef.roleName}...`);
        role = await strapi.db.query('plugin::users-permissions.role').create({
          data: {
            name: userDef.roleName,
            description: userDef.roleDescription,
            type: userDef.roleName.toLowerCase().replace(/\s+/g, '-'),
          },
        });

        // Assign permissions to the role for tenant-scoped content types
        for (const contentTypeUID of tenantScopedContentTypes) {
          const apiName = contentTypeUID.split('.')[0].replace('api::', '');
          const actions = ['find', 'findOne'];

          for (const action of actions) {
            await strapi.db.query('plugin::users-permissions.permission').create({
              data: {
                action: `${contentTypeUID}.${action}`,
                role: role.id,
              },
            });
          }
        }
        console.log(`✅ Role ${userDef.roleName} created with read permissions!`);
      } else {
        console.log(`📋 Role ${userDef.roleName} already exists, skipping.`);
      }

      // Create or find the user
      const existingUser = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: userDef.email },
      });

      if (!existingUser) {
        console.log(`⚙️ Creating user: ${userDef.username}...`);
        await strapi.plugins['users-permissions'].services.user.add({
          username: userDef.username,
          email: userDef.email,
          password: userDef.password,
          confirmed: true,
          blocked: false,
          role: role.id,
          tenant: tenant.id,
          provider: 'local',
        });
        console.log(`✅ User ${userDef.username} created and linked to tenant ${tenant.name}!`);
      } else {
        console.log(`📋 User ${userDef.username} already exists, skipping.`);
      }
    }

    // ─── 5. Seed Public Role Permissions for blog-post ─────────────────
    // This ensures find & findOne are enabled for the Public role on every
    // fresh deployment — no manual Admin UI step required. Fixes issue #6 / #12.
    const publicPermissionsToSeed = [
      'api::blog-post.blog-post.find',
      'api::blog-post.blog-post.findOne',
    ];

    const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'public' },
    });

    if (publicRole) {
      for (const action of publicPermissionsToSeed) {
        const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
          where: { action, role: publicRole.id },
        });

        if (!existing) {
          await strapi.db.query('plugin::users-permissions.permission').create({
            data: { action, role: publicRole.id, enabled: true },
          });
          console.log(`✅ Public permission granted: ${action}`);
        } else if (!existing.enabled) {
          await strapi.db.query('plugin::users-permissions.permission').update({
            where: { id: existing.id },
            data: { enabled: true },
          });
          console.log(`✅ Public permission enabled: ${action}`);
        } else {
          console.log(`📋 Public permission already set: ${action}`);
        }
      }
    } else {
      console.warn('⚠️ Could not find Public role — permissions not seeded.');
    }

    const editorRole = await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-editor' }
    });
    const authorRole = await strapi.db.query('admin::role').findOne({
      where: { code: 'strapi-author' }
    });

    if (!editorRole) {
      console.warn('⚠️ strapi-editor role not found — tenant admins cannot be seeded.');
    }

    // ─── Tenant-Specific Admin Roles ───────────────────────────────────────
    const tenantAdminRoleDefs = [
      {
        name: 'Glynac Admin',
        code: 'glynac-admin',
        description: 'Admin role scoped exclusively to Glynac AI tenant content',
        tenantSlug: 'glynac-ai',
      },
      {
        name: 'Sylvan Admin',
        code: 'sylvan-admin',
        description: 'Admin role scoped exclusively to Sylvan tenant content',
        tenantSlug: 'sylvian',
      },
      {
        name: 'RegulateThis Admin',
        code: 'regulatethis-admin',
        description: 'Admin role scoped exclusively to RegulateThis tenant content',
        tenantSlug: 'regulatethis',
      },
    ];

    const tenantAdminRoleMap: Record<string, any> = {}; // slug → role object

    for (const roleDef of tenantAdminRoleDefs) {
      let role = await strapi.db.query('admin::role').findOne({
        where: { code: roleDef.code },
      });

      if (!role) {
        console.log(`⚙️ Creating admin role: ${roleDef.name}...`);
        role = await strapi.db.query('admin::role').create({
          data: {
            name: roleDef.name,
            code: roleDef.code,
            description: roleDef.description,
          },
        });
        console.log(`✅ Admin role ${roleDef.name} created (code: ${roleDef.code})`);
      } else {
        console.log(`📋 Admin role ${roleDef.name} already exists, skipping creation.`);
      }

      tenantAdminRoleMap[roleDef.tenantSlug] = role;
    }

    // ─── Permission Matrix for Tenant Admin Roles ──────────────────────────
    //
    // Base shared content types for all tenants.
    // Per-tenant exclusions prevent stale permissions that cause 404 schema fetches:
    // e.g. glynac-ai gets article excluded because they use blog-post instead.
    // Without this, Strapi tries to load the article schema for glynac-admin → 404.
    const baseSharedContentTypes = [
      'api::article.article',
      'api::author.author',
      'api::category.category',
      'api::tag.tag',
      'api::pillar.pillar',
      'api::subcategory.subcategory',
      'api::site-setting.site-setting',
    ];

    const TENANT_EXCLUDED_SHARED: Record<string, string[]> = {
      'glynac-ai': ['api::article.article'],
    };

    const getSharedContentTypes = (slug: string): string[] => {
      const excluded = TENANT_EXCLUDED_SHARED[slug] || [];
      return baseSharedContentTypes.filter(uid => !excluded.includes(uid));
    };

    const exclusiveContentTypes: Record<string, string[]> = {
      'glynac-ai': ['api::blog-post.blog-post'],
      'sylvian': ['api::sylvan-request-access.sylvan-request-access'],
      'regulatethis': ['api::regulatethis-subscriber.regulatethis-subscriber'],
    };

    const fullCrudActions = [
      'plugin::content-manager.explorer.create',
      'plugin::content-manager.explorer.read',
      'plugin::content-manager.explorer.update',
      'plugin::content-manager.explorer.delete',
      'plugin::content-manager.explorer.publish',
    ];

    const readUpdateOnly = [
      'plugin::content-manager.explorer.read',
      'plugin::content-manager.explorer.update',
    ];

    const upsertAdminPermission = async (
      roleId: number,
      action: string,
      subject: string,
      allFields: string[] | null
    ) => {
      const existing = await strapi.db.query('admin::permission').findOne({
        where: { action, subject, role: roleId },
      });
      const properties = { fields: allFields, locales: null };
      if (!existing) {
        await strapi.db.query('admin::permission').create({
          data: { action, subject, properties, conditions: [], role: roleId },
        });
      } else {
        await strapi.db.query('admin::permission').update({
          where: { id: existing.id },
          data: { properties },
        });
      }
    };

    // FIX C: Delete stale permission rows from the live DB before re-seeding.
    // upsertAdminPermission only INSERTs or UPDATEs — it never deletes.
    // If a type was seeded for a role in a previous deploy (e.g. article for glynac-admin)
    // and is now excluded, the DB row persists. Strapi reads it on /users/me →
    // tries to load the article schema → 404 → useRBAC warning → Publish may be blocked.
    const STALE_PERMISSIONS: Record<string, string[]> = {
      'glynac-admin': ['api::article.article'],
    };
    for (const [roleCode, staleUids] of Object.entries(STALE_PERMISSIONS)) {
      const staleRole = await strapi.db.query('admin::role').findOne({ where: { code: roleCode } });
      if (!staleRole) continue;
      for (const staleUid of staleUids) {
        const deleted = await strapi.db.query('admin::permission').deleteMany({
          where: { subject: staleUid, role: staleRole.id },
        });
        const count = Array.isArray(deleted) ? deleted.length : (deleted as any)?.count ?? 0;
        if (count > 0) {
          console.log(`🧹 Deleted ${count} stale permission row(s) for '${staleUid}' from role '${roleCode}'`);
        }
      }
    }

    for (const [tenantSlug, role] of Object.entries(tenantAdminRoleMap)) {
      if (!role) continue;

      console.log(`⚙️ Setting permissions for role: ${role.name}...`);

      // Shared types — full CRUD (per-tenant list excludes irrelevant types)
      const sharedContentTypes = getSharedContentTypes(tenantSlug);
      for (const uid of sharedContentTypes) {
        const cType = strapi.contentType(uid as any);
        const fields = cType
          ? Object.keys(cType.attributes).filter(
            (attr) => !['createdBy', 'updatedBy'].includes(attr)
          )
          : null;

        for (const action of fullCrudActions) {
          await upsertAdminPermission(role.id, action, uid, fields);
        }
      }

      // Tenant model — read + update only
      const tenantCType = strapi.contentType('api::tenant.tenant' as any);
      const tenantFields = tenantCType
        ? Object.keys(tenantCType.attributes).filter(
          (attr) => !['createdBy', 'updatedBy'].includes(attr)
        )
        : null;
      for (const action of readUpdateOnly) {
        await upsertAdminPermission(role.id, action, 'api::tenant.tenant', tenantFields);
      }

      // Exclusive types — full CRUD for this tenant only
      const exclusiveTypes = exclusiveContentTypes[tenantSlug] || [];
      for (const uid of exclusiveTypes) {
        const cType = strapi.contentType(uid as any);
        const fields = cType
          ? Object.keys(cType.attributes).filter(
            (attr) => !['createdBy', 'updatedBy'].includes(attr)
          )
          : null;
        for (const action of fullCrudActions) {
          await upsertAdminPermission(role.id, action, uid, fields);
        }
      }

      console.log(`✅ Permissions set for role: ${role.name}`);
    }

    // ─── 6. Seed Tenant-Scoped Strapi Admins ──────────────────────────────────
    // Uses bcryptjs directly — strapi.admin.services.auth.hashPassword does not
    // exist in Strapi v5 and throws a TypeError if called.
    const bcrypt = require('bcryptjs');
    const knex = strapi.db.connection;

    // Detect the junction table name once — Strapi v5 uses _lnk, Strapi v4 uses _links
    let rolesJunctionTable: string | null = null;
    for (const candidate of ['admin_users_roles_lnk', 'admin_users_roles_links']) {
      const exists = await knex.schema.hasTable(candidate);
      console.log(`[RBAC] Junction table '${candidate}' exists: ${exists}`);
      if (exists) { rolesJunctionTable = candidate; break; }
    }

    if (!rolesJunctionTable) {
      // Last-resort scan: look for any table with both 'admin' and 'roles' in its name
      try {
        const isSQLite = ['sqlite', 'sqlite3'].includes(knex.client?.config?.client ?? '');
        const raw = await knex.raw(
          isSQLite
            ? "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%roles%' AND name LIKE '%admin%'"
            : "SELECT table_name AS name FROM information_schema.tables WHERE table_name LIKE '%roles%' AND table_name LIKE '%admin%' AND table_schema = current_schema()"
        );
        const rows: any[] = raw.rows ?? raw[0] ?? [];
        const found = rows.map((r: any) => r.name ?? r.table_name).find((n: string) => n);
        if (found) { rolesJunctionTable = found; }
      } catch (scanErr) {
        console.error('[RBAC] Junction table scan failed:', scanErr);
      }
    }

    if (!rolesJunctionTable) {
      console.error('[RBAC] CRITICAL: Cannot find admin roles junction table. Tenant admin roles will NOT be assigned. Check your DB schema.');
    } else {
      console.log(`[RBAC] Using junction table: '${rolesJunctionTable}'`);
    }

    for (const adminDef of tenantAdmins) {
      console.log(`[RBAC] Processing admin: ${adminDef.email}`);

      const tenant = tenantMap[adminDef.tenantSlug];
      if (!tenant) {
        console.warn(`[RBAC] Tenant '${adminDef.tenantSlug}' not found — skipping ${adminDef.email}`);
        continue;
      }

      const tenantSpecificRole = tenantAdminRoleMap[adminDef.tenantSlug];
      if (!tenantSpecificRole) {
        console.warn(`[RBAC] Role for slug '${adminDef.tenantSlug}' not found — skipping ${adminDef.email}`);
        continue;
      }

      console.log(`[RBAC] Target → tenant: ${tenant.name} (id=${tenant.id}) | role: ${tenantSpecificRole.name} (id=${tenantSpecificRole.id})`);

      const targetEmail = adminDef.email.toLowerCase().trim();

      // Find or create the admin user safely, dodging $ilike ORM crashes
      const candidateAdmins = await strapi.db.query('admin::user').findMany({
        where: { email: { $containsi: targetEmail } },
        populate: ['tenant', 'roles'],
      });

      // Strict case-insensitive evaluation in memory
      const existingAdmin = candidateAdmins.find(
        (admin: any) => admin.email && admin.email.toLowerCase().trim() === targetEmail
      );

      let adminUserId: number | null = null;

      if (!existingAdmin) {
        strapi.log.info(`[RBAC] Creating admin user: ${targetEmail}`);
        try {
          const hashedPassword = await bcrypt.hash(adminDef.password, 10);
          const created = await strapi.db.query('admin::user').create({
            data: {
              email: targetEmail,
              firstname: adminDef.firstname,
              lastname: adminDef.lastname,
              username: adminDef.username,
              password: hashedPassword,
              isActive: adminDef.isActive,
              registrationToken: null,
              resetPasswordToken: null,
              tenant: tenant.id,
            },
          });
          adminUserId = created.id;
          strapi.log.info(`[RBAC] ✅ Created ${targetEmail} (id=${adminUserId})`);
        } catch (createErr) {
          strapi.log.error(`[RBAC] ❌ Failed to create ${targetEmail}:`, createErr);
          continue;
        }
      } else {
        adminUserId = existingAdmin.id;
        // Ensure tenant link is correct even for existing users
        await strapi.db.query('admin::user').update({
          where: { id: adminUserId },
          data: { tenant: tenant.id },
        });
        strapi.log.info(`[RBAC] ✅ Existing user ${existingAdmin.email} (id=${adminUserId}) — tenant link updated`);
      }

      if (adminUserId === null) {
        console.error(`[RBAC] adminUserId is null for ${adminDef.email} — skipping role assignment`);
        continue;
      }

      // Assign role via junction table — the only reliable method in Strapi v5.
      // strapi.admin.services.user.updateById does NOT reliably update the junction table.
      if (!rolesJunctionTable) {
        console.error(`[RBAC] ❌ No junction table — cannot assign role for ${adminDef.email}`);
        continue;
      }

      try {
        const deleted = await knex(rolesJunctionTable).where({ user_id: adminUserId }).delete();
        console.log(`[RBAC] Removed ${deleted} existing role link(s) for user_id=${adminUserId}`);

        // role_order is a DECIMAL NOT NULL column in Strapi v5's junction table.
        // Omitting it causes a NOT NULL constraint violation on PostgreSQL,
        // silently dropping the role assignment and leaving the user with no role
        // (which Strapi's RBAC then rejects with 403 on every content-manager action).
        await knex(rolesJunctionTable).insert({
          user_id: adminUserId,
          role_id: tenantSpecificRole.id,
          role_order: 1,
        });
        console.log(`[RBAC] ✅ Role assigned: ${adminDef.email} → ${tenantSpecificRole.name} via '${rolesJunctionTable}'`);

        // Verify the insert actually worked by reading it back
        const verify = await knex(rolesJunctionTable)
          .where({ user_id: adminUserId, role_id: tenantSpecificRole.id })
          .first();
        if (verify) {
          console.log(`[RBAC] ✅ VERIFIED role row exists for user_id=${adminUserId} role_id=${tenantSpecificRole.id}`);
        } else {
          console.error(`[RBAC] ❌ VERIFY FAILED: role row NOT found after insert for ${adminDef.email}`);
        }
      } catch (knexErr) {
        console.error(`[RBAC] ❌ knex role assignment failed for ${adminDef.email}:`, knexErr);
        // Service-layer fallback — use the Strapi v5 service path
        // NOTE: strapi.admin.services.user does NOT exist in Strapi v5.
        //       The correct accessor is strapi.service('admin::user').
        try {
          const userService = strapi.service('admin::user' as any) as any;
          await userService.updateById(adminUserId, {
            roles: [tenantSpecificRole.id],
          });
          console.log(`[RBAC] ✅ Role assigned via strapi.service('admin::user') fallback for ${adminDef.email}`);
        } catch (svcErr) {
          console.error(`[RBAC] ❌ Service fallback also failed for ${adminDef.email}:`, svcErr);
        }
      }
    }

    // ─── 7. Data Repair: Assign Orphan Records to Tenants ──────────────
    console.log('🛠 Running Data Repair: Assigning orphan records to tenants...');

    // FIX B: repairOrphans uses strapi.db.query() for both find AND update.
    //
    // WHY the previous version silently failed:
    // 1. targetTenant.id was `undefined` (from Bug A — seedTenant used strapi.documents()).
    //    No guard existed so the function ran anyway and used targetTenant.documentId
    //    for the update. But:
    // 2. strapi.documents().update({ data: { tenant: rawUuidString } }) for a manyToOne
    //    relation field is SILENTLY DISCARDED by Strapi v5 Document Service. The update
    //    returns success but writes nothing to the DB column. The correct DS format would
    //    be { tenant: { connect: [{documentId: X}] } } — but even that is unreliable in
    //    bootstrap context before lifecycle hooks are fully initialised.
    // 3. strapi.db.query().update({ data: { tenant: integerFK } }) writes directly to
    //    the DB column with no ORM lifecycle overhead — guaranteed to work in bootstrap.
    // 4. Strapi v5 stores draft + published as SEPARATE DB rows with the same document_id.
    //    strapi.db.query().findMany() (no status filter) returns ALL rows in one call —
    //    both draft and published rows get repaired correctly.
    const repairOrphans = async (uid: string, targetTenant: any) => {
      if (!targetTenant) return;
      if (!targetTenant.id) {
        console.warn(`⚠️ repairOrphans: targetTenant.id is undefined for ${uid} — skipping. Check seedTenant fix.`);
        return;
      }

      try {
        // findMany with no status filter returns ALL rows (draft + published)
        const orphanRows = await strapi.db.query(uid).findMany({
          where: { tenant: null },
        });

        if (orphanRows.length === 0) {
          console.log(`✅ No orphan rows for ${uid}`);
          return;
        }

        console.log(`🔧 Repairing ${orphanRows.length} orphan row(s) for ${uid} → tenant id=${targetTenant.id} (${targetTenant.name})`);

        for (const row of orphanRows) {
          try {
            // Direct integer FK write — the only reliable method during bootstrap
            await strapi.db.query(uid).update({
              where: { id: row.id },
              data: { tenant: targetTenant.id },
            });
          } catch (rowErr) {
            console.error(`🔥 Failed to repair row id=${row.id} for ${uid}:`, rowErr);
          }
        }

        const remaining = await strapi.db.query(uid).count({ where: { tenant: null } });
        console.log(`✅ Repair complete for ${uid}: ${remaining} orphan rows remaining after fix`);
      } catch (repairErr) {
        console.error(`🔥 repairOrphans failed entirely for ${uid}:`, repairErr);
      }
    };

    // Articles & Subscribers -> RegulateThis
    await repairOrphans('api::article.article', defaultTenant);
    await repairOrphans('api::regulatethis-subscriber.regulatethis-subscriber', defaultTenant);

    // Blog Posts -> Glynac AI
    await repairOrphans('api::blog-post.blog-post', glynacTenant);

    // Request Access -> Sylvan
    await repairOrphans('api::sylvan-request-access.sylvan-request-access', sylvianTenant);

    console.log('✅ Data Repair complete.');
  },
};
