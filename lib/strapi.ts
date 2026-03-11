/**
 * Strapi API Client
 * Handles all communication with the Strapi CMS backend
 */

// Runtime config cache
let runtimeConfig: { strapiUrl: string } | null = null;

// Get runtime config from API (works both client and server side)
async function getRuntimeConfig(): Promise<{ strapiUrl: string }> {
    // Return cached config if available
    if (runtimeConfig) {
        return runtimeConfig;
    }

    // Check if we're on the server side - use env vars directly
    if (typeof window === 'undefined') {
        runtimeConfig = {
            strapiUrl: process.env.NEXT_PUBLIC_STRAPI_URL || 'http://localhost:5603',
        };
        return runtimeConfig;
    }

    // Client-side: try to fetch from API endpoint
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            runtimeConfig = await response.json();
            return runtimeConfig!;
        }
    } catch (error) {
        console.error('Failed to fetch runtime config:', error);
    }

    // Fallback to build-time values (may be empty if not set during build)
    runtimeConfig = {
        strapiUrl: process.env.NEXT_PUBLIC_STRAPI_URL || 'http://localhost:5603',
    };
    return runtimeConfig;
}

// Types for Strapi responses
export interface StrapiMeta {
    pagination?: {
        page: number;
        pageSize: number;
        pageCount: number;
        total: number;
    };
}

export interface StrapiResponse<T> {
    data: T;
    meta: StrapiMeta;
}

export interface StrapiData<T> {
    id: number;
    attributes: T;
}

export interface StrapiMedia {
    id: number;
    attributes: {
        url: string;
        alternativeText: string;
        width: number;
        height: number;
        formats: {
            thumbnail?: { url: string };
            small?: { url: string };
            medium?: { url: string };
            large?: { url: string };
        };
    };
}

// Strapi content types attributes
import type { Author, Article, Tag, Pillar, PillarName, ArticleStatus } from '@/types';

export interface StrapiAuthorAttributes {
    name: string;
    slug: string;
    title: string;
    bio: string;
    photo?: { data: StrapiData<StrapiMedia['attributes']> | null };
    linkedin?: string;
    twitter?: string;
    email?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
}

export interface StrapiTagAttributes {
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
}

export interface StrapiPillarAttributes {
    name: string;
    slug: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
}

export interface StrapiArticleAttributes {
    title: string;
    subtitle?: string;
    slug: string;
    content: unknown; // Blocks content
    excerpt: string;
    pillar?: { data: StrapiData<StrapiPillarAttributes> | null };
    category?: { data: StrapiData<StrapiPillarAttributes> | null }; // Added category support
    tags?: { data: StrapiData<StrapiTagAttributes>[] };
    author?: { data: StrapiData<StrapiAuthorAttributes> | null };
    featuredImage?: { data: StrapiData<StrapiMedia['attributes']> | null };
    publishDate: string;
    readTime: number;
    isFeatured: boolean;
    articleStatus?: ArticleStatus;
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
}

// Fetch helper
async function fetchStrapi<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const config = await getRuntimeConfig();

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (typeof window === 'undefined' && process.env.STRAPI_API_TOKEN) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${process.env.STRAPI_API_TOKEN}`;
    }

    const response = await fetch(`${config.strapiUrl}/api${endpoint}`, {
        ...options,
        headers,
        // Disable caching to always get fresh data from Strapi
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error(`Strapi API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

// Helper to get full image URL (uses cached config URL)
// The runtimeConfig is populated by the first fetchStrapi call
export function getStrapiMediaUrl(url: string | undefined): string {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    // Use cached config if available, otherwise fall back to env var
    const baseUrl = runtimeConfig?.strapiUrl || process.env.NEXT_PUBLIC_STRAPI_URL || 'http://localhost:5603';
    return `${baseUrl}${url}`;
}

// API Functions
export async function getArticles(params?: {
    limit?: number;
    sort?: string;
    filters?: Record<string, unknown>;
    populate?: string | string[];
}): Promise<StrapiResponse<StrapiData<StrapiArticleAttributes>[]>> {
    const searchParams = new URLSearchParams();

    if (params?.limit) {
        searchParams.set('pagination[pageSize]', params.limit.toString());
    }

    if (params?.sort) {
        searchParams.set('sort', params.sort);
    }

    if (params?.populate) {
        if (Array.isArray(params.populate)) {
            params.populate.forEach((p, i) => {
                searchParams.set(`populate[${i}]`, p);
            });
        } else {
            searchParams.set('populate', params.populate);
        }
    } else {
        // Default populate all relations
        searchParams.set('populate', '*');
    }

    if (params?.filters) {
        Object.entries(params.filters).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                Object.entries(value as Record<string, unknown>).forEach(([op, val]) => {
                    searchParams.set(`filters[${key}][${op}]`, String(val));
                });
            } else {
                searchParams.set(`filters[${key}]`, String(value));
            }
        });
    }

    const query = searchParams.toString();
    return fetchStrapi(`/articles${query ? `?${query}` : ''}`);
}

export async function getArticleBySlug(
    slug: string
): Promise<StrapiResponse<StrapiData<StrapiArticleAttributes>[]>> {
    const searchParams = new URLSearchParams();
    searchParams.set('filters[slug][$eq]', slug);
    searchParams.set('populate', '*');

    return fetchStrapi(`/articles?${searchParams.toString()}`);
}

export async function getFeaturedArticle(): Promise<StrapiData<StrapiArticleAttributes> | null> {
    const response = await getArticles({
        filters: { isFeatured: { $eq: true } },
        limit: 1,
    });

    return response.data[0] || null;
}

export async function getRecentArticles(
    limit: number = 9
): Promise<StrapiData<StrapiArticleAttributes>[]> {
    const response = await getArticles({
        sort: 'publishDate:desc',
        limit,
    });

    return response.data;
}

export async function getArticlesByPillar(
    pillarSlug: string
): Promise<StrapiData<StrapiArticleAttributes>[]> {
    const response = await getArticles({
        filters: { category: { slug: { $eq: pillarSlug } } },
        sort: 'publishDate:desc',
    });

    return response.data;
}

export async function getAuthors(): Promise<StrapiResponse<StrapiData<StrapiAuthorAttributes>[]>> {
    return fetchStrapi('/authors?populate=*');
}

export async function getTags(): Promise<StrapiResponse<StrapiData<StrapiTagAttributes>[]>> {
    return fetchStrapi('/tags');
}

export async function getPillars(): Promise<StrapiResponse<StrapiData<StrapiPillarAttributes>[]>> {
    return fetchStrapi('/pillars');
}

// Site Settings type for GTM and analytics
export interface SiteSettingsAttributes {
    siteName: string;
    siteDescription?: string;
    gtmId?: string;
    gtmEnabled: boolean;
    googleAnalyticsId?: string;
    gaEnabled: boolean;
    metaPixelId?: string;
    metaPixelEnabled: boolean;
    customHeadScripts?: string;
    customBodyScripts?: string;
    // SEO fields
    metaTitle?: string;
    metaDescription?: string;
    keywords?: string;
    ogImage?: { data: StrapiData<StrapiMedia['attributes']> | null };
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
}

export async function getSiteSettings(): Promise<SiteSettingsAttributes | null> {
    try {
        const response = await fetchStrapi<StrapiResponse<StrapiData<SiteSettingsAttributes>>>('/site-setting?populate=ogImage');
        if (response.data) {
            return response.data.attributes;
        }
        return null;
    } catch (error) {
        console.error('Failed to fetch site settings:', error);
        return null;
    }
}

// Transform Strapi data to match existing frontend types

export function transformAuthor(strapiAuthor: StrapiData<StrapiAuthorAttributes>): Author {
    const attrs = strapiAuthor.attributes;
    return {
        id: strapiAuthor.id.toString(),
        name: attrs.name,
        slug: attrs.slug,
        title: attrs.title,
        bio: attrs.bio,
        photo: attrs.photo?.data
            ? getStrapiMediaUrl(attrs.photo.data.attributes.url)
            : 'https://placehold.co/400x400/49648C/FFFFFF?text=Author',
        linkedin: attrs.linkedin,
        twitter: attrs.twitter,
        email: attrs.email,
        isActive: attrs.isActive,
    };
}

export function transformTag(strapiTag: StrapiData<StrapiTagAttributes>): Tag {
    const attrs = strapiTag.attributes;
    return {
        id: strapiTag.id.toString(),
        name: attrs.name,
        slug: attrs.slug,
    };
}

export function transformPillar(strapiPillar: StrapiData<StrapiPillarAttributes>): Pillar {
    return strapiPillar.attributes.name as Pillar;
}

export function transformArticle(strapiArticle: StrapiData<StrapiArticleAttributes>): Article {
    const attrs = strapiArticle.attributes;

    const author: Author = attrs.author?.data
        ? transformAuthor(attrs.author.data)
        : {
            id: '0',
            name: 'Unknown Author',
            title: '',
            bio: '',
            photo: 'https://placehold.co/400x400/49648C/FFFFFF?text=Author',
        };

    const tags: Tag[] = attrs.tags?.data
        ? attrs.tags.data.map(transformTag)
        : [];

    let pillar: Pillar = 'Industry Insights';

    if (attrs.pillar?.data) {
        pillar = attrs.pillar.data.attributes.name as PillarName;
    } else if (attrs.category?.data) {
        pillar = attrs.category.data.attributes.name as Pillar;
    }

    return {
        id: strapiArticle.id.toString(),
        title: attrs.title,
        subtitle: attrs.subtitle,
        slug: attrs.slug,
        content: typeof attrs.content === 'string' ? attrs.content : JSON.stringify(attrs.content),
        excerpt: attrs.excerpt,
        pillar,
        tags,
        author,
        featuredImage: attrs.featuredImage?.data
            ? getStrapiMediaUrl(attrs.featuredImage.data.attributes.url)
            : 'https://placehold.co/1200x600/0B1F3B/FFFFFF?text=Article',
        publishDate: attrs.publishDate,
        readTime: attrs.readTime,
        isFeatured: attrs.isFeatured,
        articleStatus: (attrs.articleStatus as ArticleStatus) || 'Published',
    };
}
