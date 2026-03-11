/**
 * blog-post controller
 *
 * Scopes all reads to the resolved tenant (injected by the tenant-context middleware).
 * Each tenant (Glynac AI, RegulateThis, Sylvan, …) only sees its own blog posts.
 *
 * Tenant resolution order (handled by tenant-context middleware):
 *   1. Authenticated user's tenant relation
 *   2. X-Tenant-Domain header
 *   3. X-Tenant-Slug header
 *   4. Origin header
 *   5. Referer header
 */

import { factories } from '@strapi/strapi';

// @ts-ignore
export default factories.createCoreController('api::blog-post.blog-post', () => ({
    /**
     * List blog posts — filtered to the resolved tenant when present.
     */
    async find(ctx) {
        const existingFilters = (ctx.query.filters || {}) as Record<string, unknown>;

        // Scope by tenant if resolved by middleware
        if (ctx.state.tenant) {
            ctx.query.filters = {
                ...existingFilters,
                tenant: {
                    documentId: ctx.state.tenant.documentId,
                },
            };
        }

        // Always populate author (component) and coverImage (media)
        // author is an embedded component — no data wrapper in response
        ctx.query.populate = {
            author: true,
            coverImage: {
                fields: ['url', 'alternativeText', 'width', 'height', 'formats'],
            },
            tenant: {
                fields: ['name', 'slug'],
            },
        };

        return await super.find(ctx);
    },

    /**
     * Get single blog post by ID — filtered to the resolved tenant when present.
     */
    async findOne(ctx) {
        const existingFilters = (ctx.query.filters || {}) as Record<string, unknown>;

        // Scope by tenant if resolved by middleware
        if (ctx.state.tenant) {
            ctx.query.filters = {
                ...existingFilters,
                tenant: {
                    documentId: ctx.state.tenant.documentId,
                },
            };
        }

        // Always populate author (component) and coverImage (media)
        ctx.query.populate = {
            author: true,
            coverImage: {
                fields: ['url', 'alternativeText', 'width', 'height', 'formats'],
            },
            tenant: {
                fields: ['name', 'slug'],
            },
        };

        return await super.findOne(ctx);
    },
}));
