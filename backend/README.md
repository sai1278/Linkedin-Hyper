# Strapi CMS Backend

This directory contains the headless Strapi CMS template used for the blog platform.

## Content Types and Tenants

Strapi is configured to serve multiple tenants:
- **Articles & Pillars:** Geared towards the `RegulateThis` tenant. The `Article` type includes complex relationships (Pillars, Tags, Authors).
- **Blog Posts:** Geared towards the `Glynac` tenant. The `Blog Post` type is a simpler structure with an inline author component.

### Shared Content
- **Authors:** Content creators (with bios, photos, social links). Both standalone records and embedded components are used.
- **Tags & Tenants:** Core configuration entities.

## Customization Guide

### Seed Data
Edit `src/index.ts` to customize pre-populated data (like default Pillars and Tags).

### Content Schemas
Content types are defined in `src/api/[content-type]/content-types/[content-type]/schema.json`. Modifying these JSON schemas changes the fields available in the admin UI.

### Component Schemas
Reusable components are located in `src/components/`. For example:
- `src/components/shared/seo.json`
- `src/components/blog/author.json`

## API Endpoints

The frontend fetches data via these primary public endpoints:
- `GET /api/articles`
- `GET /api/blog-posts`
- `GET /api/pillars`
- `GET /api/tags`
(Ensure `find` and `findOne` permissions are enabled for the Public role in the Strapi Admin).
