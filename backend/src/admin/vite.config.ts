import { mergeConfig, type UserConfig } from 'vite';

export default (config: UserConfig) => {
    // Important: always return the modified config
    return mergeConfig(config, {
        resolve: {
            alias: {
                '@': '/src',
            },
        },
        server: {
            allowedHosts: [
                'acumen-strapi-beta.onrender.com',
                '.onrender.com', // Allow all onrender.com subdomains
            ],
        },
    });
};
