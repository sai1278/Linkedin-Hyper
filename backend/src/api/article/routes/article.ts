/**
 * Article router with tenant-scoped policies
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/articles',
            handler: 'article.find',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'GET',
            path: '/articles/:id',
            handler: 'article.findOne',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'POST',
            path: '/articles',
            handler: 'article.create',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'PUT',
            path: '/articles/:id',
            handler: 'article.update',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'DELETE',
            path: '/articles/:id',
            handler: 'article.delete',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
    ],
};
