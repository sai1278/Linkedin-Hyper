/**
 * Admin Tenant Filter Middleware — Strapi 5.35.0
 *
 * Enforces RBAC for the Strapi Admin Panel:
 *   1. Filters GET /content-manager/content-types  → hides forbidden types (sidebar)
 *   2. Filters GET /content-manager/init           → hides forbidden types (frontend state)
 *   3. Filters GET /admin/permissions and /users/me → hides forbidden permissions
 *   4. Hard-blocks HTTP requests to forbidden content type endpoints (403)
 *   5. Injects tenant filter on all list/bulk GET queries (data isolation)
 *   6. Enforces tenant on all write operations (data isolation)
 *
 * Superadmins (role code: strapi-super-admin) bypass ALL restrictions.
 *
 * ─── FIXES IN THIS VERSION ───────────────────────────────────────────────────
 *
 * FIX 1 — CRITICAL: Tenant injection silently skipped due to missing integer id
 *   The fallback tenant resolution used strapi.documents().findFirst() which
 *   returns the Document Service result. Document Service records contain only
 *   the `documentId` UUID field — they do NOT include the integer `id` column.
 *   As a result, tenantRec.id was `undefined`, the guard `if (!tenantId)` fired,
 *   and the middleware returned next() without injecting anything.
 *   Every new document was saved with tenant = NULL.
 *   NULL tenant → document-level ownership check (WHERE tenant = tenantId)
 *   finds nothing → 403 on every subsequent GET/PUT/PATCH → user cannot save
 *   or publish the document.
 *   Fix: Changed to strapi.db.query().findOne() which always returns the DB row
 *   including the integer `id` and `documentId` columns.
 *
 * FIX 2 — CRITICAL: Wrong relation format for content-manager admin API
 *   The Strapi v5 content-manager admin panel processes relation fields using
 *   the internal integer DB id, not the documentId UUID. The format must be:
 *     { connect: [{ id: <integer> }] }
 *   Using documentId UUID in connect[] is silently discarded by the admin API,
 *   leaving tenant = NULL. This was already correct in the previous version but
 *   is documented here for clarity.
 *
 * FIX 3 — api::article.article 404 for Glynac Admin
 *   Glynac AI uses blog-post, not article. Article is added to TENANT_HIDDEN_TYPES
 *   for glynac-ai, removing it from sidebar/init/permissions and hard-blocking
 *   any direct request with 403 instead of a confusing 404.
 *
 * FIX 4 — countDraftRelations → 403
 *   Type-level sub-actions (/actions/countDraftRelations etc.) short-circuit to
 *   next() immediately after the hard-block check.
 *
 * FIX 5 — Preview URL 404 console spam
 *   Intercepts /content-manager/preview/url/* early and returns clean JSON 404.
 *
 * FIX 6 — useRBAC "first argument should be an array" warning
 *   Detects the exact response path (root / data / data.permissions) and writes
 *   the filtered array back to that exact path, preserving the body shape.
 *
 * FIX 7 — TENANT_HIDDEN_TYPES applied at every interception point
 *   Hidden types are stripped from sidebar, init, permissions, and blocked on
 *   direct request consistently.
 */

import type { Core } from '@strapi/strapi';

// ─── Tenant RBAC configuration ────────────────────────────────────────────────

const TENANT_EXCLUSIVE_TYPES: Record<string, string[]> = {
    'glynac-ai': ['api::blog-post.blog-post'],
    'regulatethis': ['api::regulatethis-subscriber.regulatethis-subscriber'],
    'sylvian': ['api::sylvan-request-access.sylvan-request-access'],
};

const ALL_EXCLUSIVE_TYPES: string[] = Object.values(TENANT_EXCLUSIVE_TYPES).flat();

/**
 * Shared content types hidden for specific tenants.
 * FIX 3: glynac-ai uses blog-post for content — article is hidden and hard-blocked.
 */
const TENANT_HIDDEN_TYPES: Record<string, string[]> = {
    'glynac-ai': ['api::article.article'],
};

/** Returns true if uid is visible and accessible for tenantSlug. */
function isContentTypeAllowed(uid: string, tenantSlug: string): boolean {
    if (ALL_EXCLUSIVE_TYPES.includes(uid)) {
        return (TENANT_EXCLUSIVE_TYPES[tenantSlug] || []).includes(uid);
    }
    const hidden = TENANT_HIDDEN_TYPES[tenantSlug] || [];
    return !hidden.includes(uid);
}

/** Resolves the full admin::user record including tenant + roles populated. */
async function resolveAdminUser(ctx: any, strapi: Core.Strapi): Promise<any | null> {
    const userId = ctx.state?.user?.id;
    if (!userId) return null;
    try {
        return await strapi.db.query('admin::user').findOne({
            where: { id: userId },
            populate: ['tenant', 'roles'],
        });
    } catch {
        return null;
    }
}

/**
 * Email → tenant slug fallback map (keys lowercased).
 * Used when the tenant DB relation is not populated on the admin::user record.
 */
const EMAIL_TENANT_FALLBACK: Record<string, string> = {
    'glynacadmin@glynac.ai': 'glynac-ai',
    'admin@sylvannotes.com': 'sylvian',
    'admin@regulatethis.com': 'regulatethis',
};

export default (config: Record<string, unknown>, { strapi }: { strapi: Core.Strapi }) => {
    return async (ctx: any, next: () => Promise<void>) => {

        const url: string = ctx.url || '';
        const method: string = ctx.request?.method || 'GET';

        // ── Route classification ────────────────────────────────────────────
        const isContentManagerContentTypes = /\/content-manager\/content-types(\?|$)/.test(url);
        const isContentManagerInit = /\/content-manager\/init(\?|$)/.test(url);
        const isPermissionsEndpoint =
            url.includes('/admin/permissions') ||
            url.includes('/users/me');

        const isContentManager = url.startsWith('/content-manager/');
        const isAdminRoute = url.startsWith('/admin/');

        if (!isContentManager && !isAdminRoute) {
            return next();
        }

        // ── FIX 5: Clean 404 for preview URL requests ───────────────────────
        if (/\/content-manager\/preview\/url\//.test(url)) {
            ctx.status = 404;
            ctx.body = {
                error: {
                    status: 404,
                    name: 'NotFoundError',
                    message: 'Preview URL is not configured for this content type.',
                },
            };
            return;
        }

        // ════════════════════════════════════════════════════════════════════
        // UPWARD CYCLE — run next() first, then intercept the RESPONSE
        // ════════════════════════════════════════════════════════════════════
        if (isContentManagerContentTypes || isContentManagerInit || isPermissionsEndpoint) {
            await next();

            if (ctx.response.status !== 200 || !ctx.body) return;

            const adminUser = await resolveAdminUser(ctx, strapi);
            if (!adminUser) return;

            const isSuperAdmin = adminUser.roles?.some((r: any) => r.code === 'strapi-super-admin');
            if (isSuperAdmin) return;

            // Resolve tenant slug — DB relation first, email fallback second
            let tenantSlug: string = adminUser.tenant?.slug || '';
            if (!tenantSlug && adminUser.email) {
                tenantSlug = EMAIL_TENANT_FALLBACK[adminUser.email.toLowerCase()] || '';
                if (tenantSlug) {
                    strapi.log.warn(
                        `[Admin RBAC] UPWARD fallback: tenantSlug='${tenantSlug}' for ${adminUser.email}`
                    );
                }
            }

            strapi.log.info(
                `[Admin RBAC] UPWARD ${method} ${url.substring(0, 80)} | ` +
                `user=${adminUser.email} | tenant='${tenantSlug}'`
            );

            // ── Filter /content-manager/content-types (SIDEBAR) ───────────────
            if (isContentManagerContentTypes) {
                try {
                    const responseData = ctx.body?.data ?? ctx.body;
                    if (Array.isArray(responseData)) {
                        const before = responseData.length;
                        const filtered = responseData.filter((ct: any) => {
                            const uid: string = ct.uid || '';
                            if (uid === 'api::tenant.tenant') return false;
                            return isContentTypeAllowed(uid, tenantSlug);
                        });
                        if (ctx.body?.data !== undefined) {
                            ctx.body.data = filtered;
                        } else {
                            ctx.body = filtered;
                        }
                        ctx.response.set('X-RBAC-CT-Before', before.toString());
                        ctx.response.set('X-RBAC-CT-After', filtered.length.toString());
                        strapi.log.info(`[Admin RBAC] Sidebar: ${before} → ${filtered.length} for '${tenantSlug}'`);
                    }
                } catch (e) {
                    strapi.log.error('[Admin RBAC] Content-types filter error:', e);
                }
                return;
            }

            // ── Filter /content-manager/init (FRONTEND STATE) ─────────────────
            if (isContentManagerInit) {
                try {
                    const initData = ctx.body?.data ?? ctx.body;
                    if (initData && typeof initData === 'object') {
                        let ctArray: any[] | null = null;
                        let ctPath: 'root' | 'data' = 'root';

                        if (Array.isArray(initData.contentTypes)) {
                            ctArray = initData.contentTypes;
                            ctPath = 'root';
                        } else if (Array.isArray(initData.data?.contentTypes)) {
                            ctArray = initData.data.contentTypes;
                            ctPath = 'data';
                        }

                        if (ctArray) {
                            const before = ctArray.length;
                            const filtered = ctArray.filter((ct: any) => {
                                const uid: string = ct.uid || '';
                                if (uid === 'api::tenant.tenant') return false;
                                return isContentTypeAllowed(uid, tenantSlug);
                            });
                            if (ctPath === 'root') {
                                initData.contentTypes = filtered;
                            } else {
                                initData.data.contentTypes = filtered;
                            }
                            strapi.log.info(`[Admin RBAC] Init: ${before} → ${filtered.length} for '${tenantSlug}'`);
                        }
                    }
                } catch (e) {
                    strapi.log.error('[Admin RBAC] Init filter error:', e);
                }
                return;
            }

            // ── Filter /admin/permissions and /admin/users/me ─────────────────
            // FIX 6: Detect path then write filtered array back to exact same path.
            if (isPermissionsEndpoint) {
                try {
                    let permissionsArray: any[] = [];
                    let permissionsPath: 'root' | 'data' | 'data.permissions' = 'root';

                    if (Array.isArray(ctx.body)) {
                        permissionsArray = ctx.body;
                        permissionsPath = 'root';
                    } else if (Array.isArray(ctx.body?.data)) {
                        permissionsArray = ctx.body.data;
                        permissionsPath = 'data';
                    } else if (Array.isArray(ctx.body?.data?.permissions)) {
                        // /users/me shape: { data: { permissions: [...], ...user } }
                        permissionsArray = ctx.body.data.permissions;
                        permissionsPath = 'data.permissions';
                    }

                    if (permissionsArray.length === 0) {
                        strapi.log.debug(`[Admin RBAC] No permissions array for ${url}`);
                        return;
                    }

                    const before = permissionsArray.length;

                    // FIX 7: Filter both exclusive AND hidden types
                    const filtered = permissionsArray.filter((p: any) => {
                        const uid: string = p.subject || '';
                        if (uid === 'api::tenant.tenant') {
                            return (
                                p.action === 'plugin::content-manager.explorer.read' ||
                                p.action === 'plugin::content-manager.explorer.update'
                            );
                        }
                        return isContentTypeAllowed(uid, tenantSlug);
                    });

                    strapi.log.info(`[Admin RBAC] Permissions: ${before} → ${filtered.length} for '${tenantSlug}'`);

                    // FIX 6: Restore to exact path — never write bare array to ctx.body
                    // when the original shape was { data: { permissions: [...] } }
                    if (permissionsPath === 'root') {
                        ctx.body = filtered;
                    } else if (permissionsPath === 'data') {
                        ctx.body.data = filtered;
                    } else {
                        ctx.body.data.permissions = filtered;
                    }

                    ctx.response.set('X-RBAC-Perms-Before', before.toString());
                    ctx.response.set('X-RBAC-Perms-After', filtered.length.toString());
                } catch (e) {
                    strapi.log.error('[Admin RBAC] Permissions filter error:', e);
                }
                return;
            }

            return;
        }

        // ════════════════════════════════════════════════════════════════════
        // DOWNWARD CYCLE — intercept the REQUEST before Strapi processes it
        // ════════════════════════════════════════════════════════════════════

        // Relation picker data — Strapi's own RBAC handles it.
        // Injecting tenant filters here causes "An error occurred while fetching
        // draft relations on this document." in the UI.
        if (url.startsWith('/content-manager/relations/')) {
            return next();
        }

        if (!ctx.state?.user?.id) {
            return next();
        }

        try {
            const adminUser = await resolveAdminUser(ctx, strapi);
            if (!adminUser) return next();

            const isSuperAdmin = adminUser.roles?.some((r: any) => r.code === 'strapi-super-admin');
            if (isSuperAdmin) return next();

            // Resolve tenant — DB relation first, email fallback second.
            let tenantId: number | null = adminUser.tenant?.id || null;
            let tenantSlug: string = adminUser.tenant?.slug || '';

            // FIX 1: Use strapi.db.query() — NOT strapi.documents() — for fallback.
            // strapi.documents().findFirst() returns Document Service records that omit
            // the integer `id` column. tenantRec.id would be `undefined`, causing
            // `if (!tenantId)` to fire and skip all injection silently.
            // strapi.db.query().findOne() returns the raw DB row including integer `id`.
            if ((!tenantSlug || !tenantId) && adminUser.email) {
                const normalizedEmail = adminUser.email.toLowerCase().trim();
                const fbSlug = EMAIL_TENANT_FALLBACK[normalizedEmail];
                if (fbSlug) {
                    const tenantRec = await strapi.db.query('api::tenant.tenant').findOne({
                        where: { slug: fbSlug },
                    });
                    if (tenantRec) {
                        tenantId = tenantRec.id as number;
                        tenantSlug = tenantRec.slug;
                        strapi.log.warn(
                            `[Admin RBAC] DOWNWARD fallback: tenant='${tenantSlug}' (id=${tenantId}) for ${normalizedEmail}`
                        );
                    }
                }
            }

            if (!tenantId) return next();

            // ── Parse URL ──────────────────────────────────────────────────────
            const cleanUrl = url.split('?')[0];
            const urlParts = cleanUrl.split('/').filter(Boolean);

            let targetModelUid = '';
            let documentId = '';
            let isSubAction = false;

            const collIdx = urlParts.indexOf('collection-types');
            const singleIdx = urlParts.indexOf('single-types');
            const relIdx = urlParts.indexOf('relations');

            if (collIdx !== -1 && urlParts.length > collIdx + 1) {
                targetModelUid = urlParts[collIdx + 1];
                const candidateSegment = urlParts.length > collIdx + 2 ? urlParts[collIdx + 2] : '';

                if (candidateSegment === 'actions') {
                    // Shape A: /collection-types/{uid}/actions/{action}  (type-level, no docId)
                    isSubAction = true;
                } else if (candidateSegment) {
                    documentId = candidateSegment;
                    // Shape B: /collection-types/{uid}/{docId}/actions/{action}
                    const segmentsAfterDocId = urlParts.slice(collIdx + 3);
                    if (segmentsAfterDocId[0] === 'actions' || segmentsAfterDocId[0] === 'relations') {
                        isSubAction = true;
                    }
                }
            } else if (singleIdx !== -1 && urlParts.length > singleIdx + 1) {
                targetModelUid = urlParts[singleIdx + 1];
            } else if (relIdx !== -1 && urlParts.length > relIdx + 1) {
                targetModelUid = urlParts[relIdx + 1];
            }

            if (!targetModelUid || !strapi.contentTypes[targetModelUid]) {
                return next();
            }

            // ── Hard block forbidden / hidden types ───────────────────────────
            // FIX 3 + FIX 4: Always check isBlocked first, then short-circuit sub-actions.
            const isBlocked = !isContentTypeAllowed(targetModelUid, tenantSlug);

            if (isBlocked) {
                strapi.log.info(`[Admin RBAC] HARD BLOCK: ${method} ${targetModelUid} for '${tenantSlug}'`);
                ctx.status = 403;
                ctx.body = {
                    error: {
                        status: 403,
                        name: 'ForbiddenError',
                        message: 'Access denied: This content type is not available for your tenant.',
                    },
                };
                return;
            }

            // FIX 4: Allowed sub-actions pass through immediately after block check.
            // These have no documentId ownership context and require no body injection.
            if (isSubAction) {
                return next();
            }

            const model = strapi.contentTypes[targetModelUid] as any;
            const isTenantScopedModel = !!(model.attributes && model.attributes.tenant);
            const isTenantModel = targetModelUid === 'api::tenant.tenant';

            // ── Inject tenant filter on list GET requests ──────────────────────
            if (method === 'GET' && !documentId) {
                if (!ctx.query) ctx.query = {};
                if (!ctx.query.filters) ctx.query.filters = {};

                if (isTenantScopedModel) {
                    ctx.query.filters.tenant = { id: { $eq: tenantId } };
                } else if (isTenantModel) {
                    ctx.query.filters.id = { $eq: tenantId };
                }
            }

            // ── Document-level access protection ──────────────────────────────
            if (documentId && (isTenantScopedModel || isTenantModel)) {
                let entity: any = null;

                if (isTenantScopedModel) {
                    entity = await strapi.db.query(targetModelUid).findOne({
                        where: { document_id: documentId, tenant: tenantId },
                    });
                    if (!entity) {
                        entity = await strapi.db.query(targetModelUid).findOne({
                            where: { documentId, tenant: tenantId },
                        });
                    }
                } else if (isTenantModel) {
                    entity = await strapi.db.query(targetModelUid).findOne({
                        where: { id: tenantId },
                    });
                }

                if (!entity) {
                    const normalizedEmail = adminUser.email ? adminUser.email.toLowerCase().trim() : 'UNKNOWN';
                    strapi.log.error(
                        `[Admin RBAC] PUBLISH DENIED / TENANT MISMATCH: User ${adminUser.id} (${normalizedEmail}) has session tenant_id=${tenantId}. Blocked ${method} ${targetModelUid}:${documentId}.`
                    );
                    ctx.status = 403;
                    ctx.body = {
                        error: {
                            status: 403,
                            name: 'ForbiddenError',
                            message: 'Access denied: This content does not belong to your tenant.',
                        },
                    };
                    return;
                }
            }

            // ── FIX 2: Force tenant on write operations ────────────────────────
            // MUST use integer id in connect[]. The Strapi v5 content-manager admin
            // API processes relation payloads with integer DB ids. Using documentId
            // UUID in connect[] is silently discarded, leaving tenant = NULL.
            if (['POST', 'PUT', 'PATCH'].includes(method) && isTenantScopedModel) {
                if (!ctx.request.body) ctx.request.body = {};
                ctx.request.body.tenant = {
                    connect: [{ id: tenantId }],
                };
                strapi.log.info(
                    `[Admin RBAC] Injected tenant for ${method} ${targetModelUid} (tenantId=${tenantId})`
                );
            }

        } catch (error) {
            strapi.log.error('[Admin RBAC] Middleware error:', error);
        }

        return next();
    };
};