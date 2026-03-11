/**
 * Tag router with tenant-scoped policies
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/tags',
            handler: 'tag.find',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'GET',
            path: '/tags/:id',
            handler: 'tag.findOne',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'POST',
            path: '/tags',
            handler: 'tag.create',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'PUT',
            path: '/tags/:id',
            handler: 'tag.update',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'DELETE',
            path: '/tags/:id',
            handler: 'tag.delete',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
    ],
};
