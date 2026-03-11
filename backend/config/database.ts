export default ({ env }) => {
    const databaseUrl = env('DATABASE_URL');

    // If DATABASE_URL is set, use PostgreSQL (production)
    if (databaseUrl) {
        return {
            connection: {
                client: 'postgres',
                connection: databaseUrl,
                pool: {
                    min: 2,
                    max: 10,
                },
                acquireConnectionTimeout: 60000,
            },
            settings: {
                forceMigration: true,
            },
        };
    }

    // Fallback to SQLite for local development
    return {
        connection: {
            client: 'sqlite',
            connection: {
                filename: '.tmp/data.db',
            },
            useNullAsDefault: true,
        },
    };
};
