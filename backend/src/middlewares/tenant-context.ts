/**
 * Tenant Context Middleware
 *
 * Identifies the tenant from incoming requests and injects tenant context
 * into ctx.state for use by policies and controllers.
 *
 * Tenant identification strategies (priority order):
 *   1. Authenticated user's tenant relation (highest priority for RBAC)
 *   2. X-Tenant-Domain header
 *   3. X-Tenant-Slug header
 *   4. Origin header (for browser requests)
 *   5. Referer header fallback
 *
 * FIX: All tenant lookups now use strapi.db.query() instead of strapi.documents().
 * strapi.documents() (Document Service) returns records WITHOUT the integer `id`
 * column — only the documentId UUID. This caused ctx.state.tenant.id = undefined,
 * breaking any downstream code that needs the integer FK (e.g. is-tenant-scoped
 * policy, document-level checks). strapi.db.query() always returns the full DB row
 * including both `id` (integer) and `documentId` (UUID).
 */

import type { Core } from '@strapi/strapi';

interface TenantContext {
    id: number;
    documentId: string;
    name: string;
    slug: string;
    domain: string;
    isActive: boolean;
}

declare module 'koa' {
    interface DefaultState {
        tenant?: TenantContext;
    }
}

const extractDomain = (url: string | undefined): string | null => {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return parsed.hostname;
    } catch {
        return null;
    }
};

export default (config: Record<string, unknown>, { strapi }: { strapi: Core.Strapi }) => {
    return async (ctx: any, next: () => Promise<void>) => {

        // Skip tenant resolution for admin and health routes
        if (ctx.url.startsWith('/admin') || ctx.url.startsWith('/_health')) {
            return next();
        }

        // ─── Strategy 1: Resolve tenant from authenticated user ────────────
        if (ctx.state?.user?.id) {
            try {
                // strapi.db.query ensures we get the integer id alongside documentId
                const userWithTenant = await strapi.db.query('plugin::users-permissions.user').findOne({
                    where: { id: ctx.state.user.id },
                    populate: ['tenant'],
                });

                if (userWithTenant?.tenant) {
                    const t = userWithTenant.tenant;
                    ctx.state.tenant = {
                        id: t.id,
                        documentId: t.documentId,
                        name: t.name,
                        slug: t.slug,
                        domain: t.domain,
                        isActive: t.isActive,
                    } as TenantContext;
                    return next();
                }
            } catch (error) {
                strapi.log.error('[Tenant Context] Error resolving tenant from user:', error);
            }
        }

        // ─── Strategy 2-5: Header-based tenant resolution ──────────────────
        const tenantIdentifier =
            ctx.request.headers['x-tenant-domain'] ||
            ctx.request.headers['x-tenant-slug'] ||
            extractDomain(ctx.request.headers['origin']) ||
            extractDomain(ctx.request.headers['referer']);

        if (!tenantIdentifier) {
            return next();
        }

        try {
            // Use strapi.db.query() to guarantee both integer id and documentId
            // are present on the result. strapi.documents().findMany() omits the
            // integer id, which breaks is-tenant-scoped policy FK checks.
            const tenant = await strapi.db.query('api::tenant.tenant').findOne({
                where: {
                    $or: [
                        { domain: tenantIdentifier },
                        { slug: tenantIdentifier },
                    ],
                    isActive: true,
                },
            });

            if (tenant) {
                ctx.state.tenant = {
                    id: tenant.id,
                    documentId: tenant.documentId,
                    name: tenant.name,
                    slug: tenant.slug,
                    domain: tenant.domain,
                    isActive: tenant.isActive,
                } as TenantContext;
            }
        } catch (error) {
            strapi.log.error('[Tenant Context] Error resolving tenant from header:', error);
        }

        return next();
    };
};
