/**
 * Category router with tenant-scoped policies
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/categories',
            handler: 'category.find',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'GET',
            path: '/categories/:id',
            handler: 'category.findOne',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'POST',
            path: '/categories',
            handler: 'category.create',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'PUT',
            path: '/categories/:id',
            handler: 'category.update',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'DELETE',
            path: '/categories/:id',
            handler: 'category.delete',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
    ],
};
