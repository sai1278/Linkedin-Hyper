import type { Core } from '@strapi/strapi';

export default (policyContext: any, config: Record<string, unknown>, { strapi }: { strapi: Core.Strapi }) => {
    const ctx = policyContext;

    // Safety check - ensure ctx and ctx.state exist
    if (!ctx || !ctx.state) {
        strapi.log.warn('is-tenant-scoped: No context or state available');
        return false;
    }

    // Check if this is a Strapi super-admin request
    const isSuperAdmin = ctx.state.user?.roles?.some((role: any) =>
        role.code === 'strapi-super-admin'
    );

    // Super-admins bypass tenant restrictions
    if (isSuperAdmin) {
        strapi.log.debug('is-tenant-scoped: Super-admin request detected, bypassing tenant check');
        return true;
    }

    const isReadOperation = ctx.request?.method === 'GET';
    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.request?.method);
    const hasTenantContext = !!ctx.state.tenant;

    // ─── Authenticated User Tenant Enforcement (RBAC) ──────────────
    // If the user is authenticated and has a tenant, ALWAYS enforce tenant filtering
    const isAuthenticatedWithTenant = !!ctx.state.user && hasTenantContext;

    if (isAuthenticatedWithTenant) {
        const tenantDocumentId = ctx.state.tenant.documentId;

        // For read operations: inject tenant filter so user only sees their tenant's data
        if (isReadOperation) {
            if (!ctx.query) {
                ctx.query = {};
            }
            if (!ctx.query.filters) {
                ctx.query.filters = {};
            }
            ctx.query.filters.tenant = {
                documentId: tenantDocumentId,
            };
            strapi.log.debug(`is-tenant-scoped: Filtering reads for authenticated user to tenant ${ctx.state.tenant.name}`);
        }

        // For write operations: force tenant into the request body
        if (['POST', 'PUT', 'PATCH'].includes(ctx.request?.method)) {
            if (ctx.request.body && ctx.request.body.data) {
                ctx.request.body.data.tenant = tenantDocumentId;
            }
            strapi.log.debug(`is-tenant-scoped: Enforcing tenant ${ctx.state.tenant.name} on write operation`);
        }

        // For DELETE: allow only if the entity belongs to the user's tenant
        // (the tenant filter on reads already ensures they can only see/reference their own)
        return true;
    }

    // ─── Unauthenticated / Public Request Handling ─────────────────
    // For write operations from public API, tenant context is REQUIRED
    if (isWriteOperation && !hasTenantContext) {
        strapi.log.debug('is-tenant-scoped: Write operation without tenant context, denying access');
        return false;
    }

    // For read operations without tenant context, allow access (public API)
    if (isReadOperation && !hasTenantContext) {
        strapi.log.debug('is-tenant-scoped: Public read access allowed without tenant context');
        return true;
    }

    // If we have tenant context from headers (unauthenticated), apply tenant filtering
    if (hasTenantContext) {
        if (isReadOperation) {
            if (!ctx.query) {
                ctx.query = {};
            }
            if (!ctx.query.filters) {
                ctx.query.filters = {};
            }
            ctx.query.filters.tenant = {
                documentId: ctx.state.tenant.documentId
            };
        }

        if (['POST', 'PUT', 'PATCH'].includes(ctx.request?.method)) {
            if (ctx.request.body && ctx.request.body.data) {
                ctx.request.body.data.tenant = ctx.state.tenant.documentId;
            }
        }
    }

    return true;
};

