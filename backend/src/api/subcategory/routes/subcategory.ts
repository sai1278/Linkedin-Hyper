/**
 * Subcategory router with tenant-scoped policies
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/subcategories',
            handler: 'subcategory.find',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'GET',
            path: '/subcategories/:id',
            handler: 'subcategory.findOne',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'POST',
            path: '/subcategories',
            handler: 'subcategory.create',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'PUT',
            path: '/subcategories/:id',
            handler: 'subcategory.update',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'DELETE',
            path: '/subcategories/:id',
            handler: 'subcategory.delete',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
    ],
};
