/**
 * blog-post service
 *
 * Provides tenant-scoped helpers on top of the default CRUD service.
 */

import { factories } from '@strapi/strapi';

interface FindPublishedParams {
    filters?: Record<string, any>;
    sort?: string | string[];
    pagination?: {
        page?: number;
        pageSize?: number;
        start?: number;
        limit?: number;
    };
}

// @ts-ignore
export default factories.createCoreService('api::blog-post.blog-post', ({ strapi }) => ({
    /**
     * Find published blog posts scoped to a specific tenant slug.
     * Used by server-side helpers that know the tenant at call time.
     */
    async findPublishedByTenant(tenantSlug: string, params: FindPublishedParams = {}) {
        const tenant = await strapi.db.query('api::tenant.tenant').findOne({
            where: { slug: tenantSlug },
        });

        if (!tenant) {
            return { data: [], meta: {} };
        }

        // @ts-ignore
        const entries = await strapi.entityService.findMany('api::blog-post.blog-post', {
            ...params,
            filters: {
                ...(params.filters || {}),
                tenant: { id: tenant.id },
                publishedAt: { $notNull: true },
            },
            populate: {
                author: true,
                coverImage: true,
                tenant: { fields: ['name', 'slug'] },
            },
        });

        return entries;
    },

    /**
     * Find a single published blog post by slug within a specific tenant.
     */
    async findOneBySlug(slug: string, tenantSlug: string) {
        const tenant = await strapi.db.query('api::tenant.tenant').findOne({
            where: { slug: tenantSlug },
        });

        if (!tenant) {
            return null;
        }

        const entry = await strapi.db.query('api::blog-post.blog-post').findOne({
            where: {
                slug,
                tenant: { id: tenant.id },
                publishedAt: { $notNull: true },
            },
            populate: {
                author: true,
                coverImage: true,
                tenant: { fields: ['name', 'slug'] },
            },
        });

        return entry;
    },
}));
