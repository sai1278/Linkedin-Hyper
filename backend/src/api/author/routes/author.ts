/**
 * Author router with tenant-scoped policies
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/authors',
            handler: 'author.find',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'GET',
            path: '/authors/:id',
            handler: 'author.findOne',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'POST',
            path: '/authors',
            handler: 'author.create',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'PUT',
            path: '/authors/:id',
            handler: 'author.update',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'DELETE',
            path: '/authors/:id',
            handler: 'author.delete',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
    ],
};
