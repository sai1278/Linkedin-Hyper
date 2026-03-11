/**
 * blog-post router
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::blog-post.blog-post' as any, {
    config: {
        find: {
            middlewares: ['global::tenant-context'],
            auth: false,
            policies: [],
        },
        findOne: {
            middlewares: ['global::tenant-context'],
            auth: false,
            policies: [],
        },
        create: {
            middlewares: ['global::tenant-context'],
            policies: ['admin::isAuthenticatedAdmin'],
        },
        update: {
            middlewares: ['global::tenant-context'],
            policies: ['admin::isAuthenticatedAdmin'],
        },
        delete: {
            middlewares: ['global::tenant-context'],
            policies: ['admin::isAuthenticatedAdmin'],
        },
    },
});
