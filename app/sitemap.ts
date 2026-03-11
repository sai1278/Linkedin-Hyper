import type { MetadataRoute } from 'next';
import { getRecentArticles, getAuthors } from '@/lib/strapi';
import type { StrapiData, StrapiArticleAttributes, StrapiAuthorAttributes } from '@/lib/strapi';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://regulatethis.ai';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages — always included
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/blog`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/authors`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  // Dynamic article pages
  let articleRoutes: MetadataRoute.Sitemap = [];
  try {
    const articles = await getRecentArticles(200);
    articleRoutes = articles.map((article: StrapiData<StrapiArticleAttributes>) => ({
      url: `${BASE_URL}/article/${article.attributes.slug}`,
      lastModified: new Date(article.attributes?.updatedAt ?? article.attributes?.publishDate ?? new Date()),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
  } catch (err) {
    // CMS unreachable at build time — skip dynamic routes gracefully
    console.warn('[sitemap] Failed to fetch articles:', err);
  }

  // Dynamic author pages (if individual author pages exist)
  let authorRoutes: MetadataRoute.Sitemap = [];
  try {
    const authorsResponse = await getAuthors();
    const authors = authorsResponse.data ?? [];
    authorRoutes = authors.map((author: StrapiData<StrapiAuthorAttributes>) => ({
      url: `${BASE_URL}/authors/${author.attributes.slug}`,
      lastModified: new Date(author.attributes?.updatedAt ?? new Date()),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));
  } catch (err) {
    console.warn('[sitemap] Failed to fetch authors:', err);
  }

  return [...staticRoutes, ...articleRoutes, ...authorRoutes];
}
