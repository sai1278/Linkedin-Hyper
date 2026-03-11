export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 5603),
  url: env('PUBLIC_URL', 'https://acumen-strapi-beta.onrender.com'),
  app: {
    keys: env.array('APP_KEYS'),
  },
});
