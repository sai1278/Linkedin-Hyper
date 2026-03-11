/**
 * Site Settings router with tenant-scoped policies
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/site-settings',
            handler: 'site-setting.find',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'GET',
            path: '/site-settings/:id',
            handler: 'site-setting.findOne',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'POST',
            path: '/site-settings',
            handler: 'site-setting.create',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'PUT',
            path: '/site-settings/:id',
            handler: 'site-setting.update',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
        {
            method: 'DELETE',
            path: '/site-settings/:id',
            handler: 'site-setting.delete',
            config: {
                policies: ['global::is-tenant-scoped'],
            },
        },
    ],
};
