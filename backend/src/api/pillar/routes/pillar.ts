/**
 * Pillar router with tenant-scoped policies
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/pillars',
            handler: 'pillar.find',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'GET',
            path: '/pillars/:id',
            handler: 'pillar.findOne',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'POST',
            path: '/pillars',
            handler: 'pillar.create',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'PUT',
            path: '/pillars/:id',
            handler: 'pillar.update',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'DELETE',
            path: '/pillars/:id',
            handler: 'pillar.delete',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
    ],
};
