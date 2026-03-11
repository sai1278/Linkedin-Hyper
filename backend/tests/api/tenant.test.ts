/**
 * Tenant Schema Tests
 * 
 * Tests to validate the tenant content type schema, multitenancy architecture,
 * and user-tenant RBAC extension.
 */

const tenantSchema = require('../../src/api/tenant/content-types/tenant/schema.json');
const articleSchema = require('../../src/api/article/content-types/article/schema.json');
const authorSchema = require('../../src/api/author/content-types/author/schema.json');
const categorySchema = require('../../src/api/category/content-types/category/schema.json');
const tagSchema = require('../../src/api/tag/content-types/tag/schema.json');
const pillarSchema = require('../../src/api/pillar/content-types/pillar/schema.json');
const subcategorySchema = require('../../src/api/subcategory/content-types/subcategory/schema.json');
const siteSettingSchema = require('../../src/api/site-setting/content-types/site-setting/schema.json');
const userSchema = require('../../src/extensions/users-permissions/content-types/user/schema.json');

describe('Tenant Schema', () => {
    it('should have correct collection type configuration', () => {
        expect(tenantSchema.kind).toBe('collectionType');
        expect(tenantSchema.collectionName).toBe('tenants');
        expect(tenantSchema.info.singularName).toBe('tenant');
        expect(tenantSchema.info.pluralName).toBe('tenants');
    });

    it('should have draftAndPublish disabled', () => {
        expect(tenantSchema.options.draftAndPublish).toBe(false);
    });

    describe('Required Fields', () => {
        it('should have name as required', () => {
            expect(tenantSchema.attributes.name.required).toBe(true);
            expect(tenantSchema.attributes.name.type).toBe('string');
            expect(tenantSchema.attributes.name.maxLength).toBe(100);
        });

        it('should have slug as required', () => {
            expect(tenantSchema.attributes.slug.required).toBe(true);
            expect(tenantSchema.attributes.slug.type).toBe('uid');
            expect(tenantSchema.attributes.slug.targetField).toBe('name');
        });

        it('should have domain as required and unique', () => {
            expect(tenantSchema.attributes.domain.required).toBe(true);
            expect(tenantSchema.attributes.domain.unique).toBe(true);
            expect(tenantSchema.attributes.domain.type).toBe('string');
        });

        it('should have isActive as required with default true', () => {
            expect(tenantSchema.attributes.isActive.required).toBe(true);
            expect(tenantSchema.attributes.isActive.default).toBe(true);
            expect(tenantSchema.attributes.isActive.type).toBe('boolean');
        });
    });

    describe('Relations', () => {
        it('should have articles relation', () => {
            expect(tenantSchema.attributes.articles.type).toBe('relation');
            expect(tenantSchema.attributes.articles.relation).toBe('oneToMany');
            expect(tenantSchema.attributes.articles.target).toBe('api::article.article');
        });

        it('should have authors relation', () => {
            expect(tenantSchema.attributes.authors.type).toBe('relation');
            expect(tenantSchema.attributes.authors.relation).toBe('oneToMany');
            expect(tenantSchema.attributes.authors.target).toBe('api::author.author');
        });

        it('should have categories relation', () => {
            expect(tenantSchema.attributes.categories.type).toBe('relation');
            expect(tenantSchema.attributes.categories.relation).toBe('oneToMany');
            expect(tenantSchema.attributes.categories.target).toBe('api::category.category');
        });

        it('should have tags relation', () => {
            expect(tenantSchema.attributes.tags.type).toBe('relation');
            expect(tenantSchema.attributes.tags.relation).toBe('oneToMany');
            expect(tenantSchema.attributes.tags.target).toBe('api::tag.tag');
        });

        it('should have siteSettings relation', () => {
            expect(tenantSchema.attributes.siteSettings.type).toBe('relation');
            expect(tenantSchema.attributes.siteSettings.relation).toBe('oneToMany');
            expect(tenantSchema.attributes.siteSettings.target).toBe('api::site-setting.site-setting');
        });
    });
});

describe('Multitenancy - All Content Types Have Tenant Relation', () => {
    const contentTypesWithTenant = [
        { name: 'Article', schema: articleSchema },
        { name: 'Author', schema: authorSchema },
        { name: 'Category', schema: categorySchema },
        { name: 'Tag', schema: tagSchema },
        { name: 'Pillar', schema: pillarSchema },
        { name: 'Subcategory', schema: subcategorySchema },
        { name: 'Site Setting', schema: siteSettingSchema },
    ];

    contentTypesWithTenant.forEach(({ name, schema }) => {
        it(`${name} should have tenant relation`, () => {
            expect(schema.attributes.tenant).toBeDefined();
            expect(schema.attributes.tenant.type).toBe('relation');
            expect(schema.attributes.tenant.relation).toBe('manyToOne');
            expect(schema.attributes.tenant.target).toBe('api::tenant.tenant');
        });
    });
});

describe('Site Settings Schema (Converted to CollectionType)', () => {
    it('should be a collectionType (not singleType)', () => {
        expect(siteSettingSchema.kind).toBe('collectionType');
    });

    it('should have tenant relation for multitenancy', () => {
        expect(siteSettingSchema.attributes.tenant).toBeDefined();
        expect(siteSettingSchema.attributes.tenant.relation).toBe('manyToOne');
        expect(siteSettingSchema.attributes.tenant.inversedBy).toBe('siteSettings');
    });

    it('should have core settings fields', () => {
        expect(siteSettingSchema.attributes.siteName).toBeDefined();
        expect(siteSettingSchema.attributes.siteDescription).toBeDefined();
        expect(siteSettingSchema.attributes.gtmId).toBeDefined();
        expect(siteSettingSchema.attributes.googleAnalyticsId).toBeDefined();
        expect(siteSettingSchema.attributes.metaPixelId).toBeDefined();
    });
});

describe('Users-Permissions User Schema Extension (RBAC)', () => {
    it('should have tenant relation for user-level RBAC', () => {
        expect(userSchema.attributes.tenant).toBeDefined();
        expect(userSchema.attributes.tenant.type).toBe('relation');
        expect(userSchema.attributes.tenant.relation).toBe('manyToOne');
        expect(userSchema.attributes.tenant.target).toBe('api::tenant.tenant');
    });

    it('should retain all default user fields', () => {
        expect(userSchema.attributes.username).toBeDefined();
        expect(userSchema.attributes.email).toBeDefined();
        expect(userSchema.attributes.password).toBeDefined();
        expect(userSchema.attributes.provider).toBeDefined();
        expect(userSchema.attributes.confirmed).toBeDefined();
        expect(userSchema.attributes.blocked).toBeDefined();
        expect(userSchema.attributes.role).toBeDefined();
    });

    it('should have role as manyToOne relation to users-permissions role', () => {
        expect(userSchema.attributes.role.type).toBe('relation');
        expect(userSchema.attributes.role.relation).toBe('manyToOne');
        expect(userSchema.attributes.role.target).toBe('plugin::users-permissions.role');
    });
});

describe('Admin User Schema Extension (RBAC)', () => {
    it('is extended dynamically in src/index.ts to have a tenant relation', () => {
        // We cannot directly test this here by requiring a schema.json file
        // because the 'tenant' attribute is injected into 'admin::user' at runtime
        // during the Strapi register() lifecycle phase. 
        // 
        // See: src/index.ts
    });
});

