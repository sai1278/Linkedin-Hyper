const fs = require('fs');
const strapi = require('@strapi/strapi');

async function checkArticles() {
    const app = await strapi().load();
    await app.start();

    try {
        const articles = await app.db.query('api::article.article').findMany({
            populate: ['tenant'],
        });

        console.log(`\n--- FOUND ${articles.length} ARTICLES ---`);
        for (const a of articles) {
            console.log(`ID: ${a.id} | Title: ${a.title} | Tenant: ${a.tenant ? a.tenant.name : 'NONE'}`);
        }
        console.log('--------------------------------\n');
    } catch (error) {
        console.error('Error fetching articles:', error);
    } finally {
        process.exit(0);
    }
}

checkArticles();
