/**
 * Blog Post TypeScript Definitions
 * 
 * This file contains comprehensive type definitions for the Glynac Blog Post system.
 * It includes interfaces for API responses, internal data structures, and utility functions.
 */

// ==========================================
// Base Strapi Types
// ==========================================

export interface StrapiPagination {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
}

export interface StrapiMeta {
    pagination?: StrapiPagination;
    [key: string]: any;
}

export interface StrapiResponse<T> {
    data: T;
    meta: StrapiMeta;
}

export interface StrapiData<T> {
    id: number;
    attributes: T;
}

// ==========================================
// Media Types
// ==========================================

export interface StrapiMediaFormat {
    name: string;
    hash: string;
    ext: string;
    mime: string;
    path: string | null;
    width: number;
    height: number;
    size: number;
    url: string;
}

export interface StrapiMediaAttributes {
    name: string;
    alternativeText: string | null;
    caption: string | null;
    width: number;
    height: number;
    formats: {
        thumbnail?: StrapiMediaFormat;
        small?: StrapiMediaFormat;
        medium?: StrapiMediaFormat;
        large?: StrapiMediaFormat;
    } | null;
    hash: string;
    ext: string;
    mime: string;
    size: number;
    url: string;
    previewUrl: string | null;
    provider: string;
    provider_metadata: any | null;
    createdAt: string;
    updatedAt: string;
}

export interface StrapiMedia {
    data: StrapiData<StrapiMediaAttributes> | null;
}

export interface StrapiMediaArray {
    data: StrapiData<StrapiMediaAttributes>[] | null;
}

// ==========================================
// Component: Blog Author
// ==========================================

export interface BlogAuthor {
    id: number;
    name: string;
    role: string;
    description?: string;
    bio?: string;
    avatar?: {
        data?: {
            attributes?: {
                url: string;
                alternativeText?: string | null;
            };
        };
    };
    linkedin?: string;
    twitter?: string;
}

// ==========================================
// Collection: Tenant (Minimal Relation)
// ==========================================

export interface TenantRelationAttributes {
    name: string;
    slug: string;
}

export interface TenantRelation {
    data: StrapiData<TenantRelationAttributes> | null;
}

// ==========================================
// Component: Shared SEO
// ==========================================

export interface BlogPostSeo {
    id?: number;
    metaTitle?: string | null;
    metaDescription?: string | null;
    keywords?: string | null;
    ogImage?: StrapiMedia;
    canonicalURL?: string | null;
    noIndex?: boolean;
}

// ==========================================
// Collection: Blog Post
// ==========================================

export interface BlogPostAttributes {
    title: string;
    slug: string;
    excerpt: string;
    content: string; // Markdown content
    coverImage: StrapiMedia;
    category: string;
    tags: string[] | null; // JSON array of strings
    readTime: string;
    author: BlogAuthor;
    tenant?: TenantRelation;
    seo?: BlogPostSeo | null;
    createdAt: string;
    updatedAt: string;
    publishedAt: string | null;
    locale?: string;
    localizations?: {
        data: any[];
    };
}

export interface BlogPost extends StrapiData<BlogPostAttributes> { }

// ==========================================
// API Response Interfaces
// ==========================================

export interface BlogPostResponse extends StrapiResponse<BlogPost> { }

export interface BlogPostsResponse extends StrapiResponse<BlogPost[]> { }

// ==========================================
// Filter and Input Interfaces
// ==========================================

export interface BlogPostFilters {
    category?: string;
    tag?: string;
    authorName?: string;
    searchTerm?: string;
    tenantSlug?: string;
}

export interface BlogPostQueryParams {
    page?: number;
    pageSize?: number;
    sort?: string[];
    filters?: any;
    populate?: any;
    publicationState?: 'live' | 'preview';
    locale?: string;
}

export interface BlogPostInput {
    data: {
        title: string;
        slug: string;
        excerpt: string;
        content: string;
        coverImage: number; // ID of the uploaded image
        category: string;
        tags?: string[];
        readTime: string;
        author: {
            name: string;
            role: string;
        };
        tenant?: number; // Optional: ID of the tenant (set server-side)
        publishedAt?: string | null;
    };
}

// ==========================================
// Frontend Interfaces (Processed)
// ==========================================

export interface BlogPostPreview {
    id: number;
    title: string;
    slug: string;
    excerpt: string;
    coverImageUrl: string;
    category: string;
    readTime: string;
    authorName: string;
    authorRole: string;
    publishedDate: string;
    tags: string[];
}

// ==========================================
// Utility Functions
// ==========================================

/**
 * Transforms a raw API response into a simplified preview object for frontend cards.
 * @param post The raw BlogPost object from the API
 * @returns A simplified BlogPostPreview object
 */
export function toBlogPostPreview(post: BlogPost): BlogPostPreview {
    const attrs = post.attributes;
    const author = attrs.author;
    const coverImage = attrs.coverImage.data?.attributes;

    return {
        id: post.id,
        title: attrs.title,
        slug: attrs.slug,
        excerpt: attrs.excerpt,
        coverImageUrl: coverImage?.url || '',
        category: attrs.category,
        readTime: attrs.readTime,
        authorName: author?.name || 'Unknown Author',
        authorRole: author?.role || '',
        publishedDate: attrs.publishedAt || attrs.createdAt,
        tags: Array.isArray(attrs.tags) ? attrs.tags : [],
    };
}

/**
 * Calculates estimated read time from content string.
 * Assumes average reading speed of 200 words per minute.
 * @param content The markdown content string
 * @returns Formatted string (e.g., "5 min read")
 */
export function calculateReadTime(content: string): string {
    const wordsPerMinute = 200;
    const cleanContent = content.replace(/(<([^>]+)>)/gi, ''); // Remove HTML tags if any
    const numberOfWords = getWordCount(cleanContent);
    const minutes = Math.ceil(numberOfWords / wordsPerMinute);
    return `${minutes} min read`;
}

/**
 * Counts words in a string.
 * @param text The text to count words for
 * @returns Number of words
 */
export function getWordCount(text: string): number {
    return text.trim().split(/\s+/).length;
}

/**
 * Formats a date string into a user-friendly format.
 * @param dateString ISO date string
 * @param locale Locale code (default: 'en-US')
 * @returns Formatted date string (e.g., "October 5, 2023")
 */
export function formatPublishDate(dateString: string | null, locale: string = 'en-US'): string {
    if (!dateString) return 'Draft';

    const date = new Date(dateString);
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    }).format(date);
}

/**
 * Helper to safely get the image URL from a media object.
 * Returns a placeholder or empty string if no image exists.
 * @param media The StrapiMedia object
 * @param size Optional size preference ('thumbnail', 'small', 'medium', 'large')
 * @returns Full URL string
 */
export function getImageUrl(media: StrapiMedia, size?: 'thumbnail' | 'small' | 'medium' | 'large'): string {
    if (!media.data) return '';

    const formats = media.data.attributes.formats;

    if (size && formats && formats[size]) {
        return formats[size]?.url || media.data.attributes.url;
    }

    return media.data.attributes.url;
}

/**
 * Filters a list of posts to return only those that are published.
 * Validates 'publishedAt' is not null.
 * @param posts Array of BlogPost objects
 * @returns Filtered array of BlogPost objects
 */
export function filterPublishedPosts(posts: BlogPost[]): BlogPost[] {
    return posts.filter(post => post.attributes.publishedAt !== null);
}

/**
 * Sorts posts by date (newest first).
 * @param posts Array of BlogPost objects
 * @returns Sorted array
 */
export function sortPostsByDate(posts: BlogPost[]): BlogPost[] {
    return [...posts].sort((a, b) => {
        const dateA = new Date(a.attributes.publishedAt || a.attributes.createdAt).getTime();
        const dateB = new Date(b.attributes.publishedAt || b.attributes.createdAt).getTime();
        return dateB - dateA;
    });
}

/**
 * Groups posts by their category.
 * @param posts Array of BlogPost objects
 * @returns Record object with category keys and arrays of posts
 */
export function groupPostsByCategory(posts: BlogPost[]): Record<string, BlogPost[]> {
    return posts.reduce((acc, post) => {
        const category = post.attributes.category;
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(post);
        return acc;
    }, {} as Record<string, BlogPost[]>);
}

/**
 * Searches posts by title or excerpt.
 * @param posts Array of BlogPost objects
 * @param term Search term
 * @returns Filtered array of BlogPost objects
 */
export function searchPosts(posts: BlogPost[], term: string): BlogPost[] {
    if (!term) return posts;

    const lowerTerm = term.toLowerCase();

    return posts.filter(post => {
        const title = post.attributes.title.toLowerCase();
        const excerpt = post.attributes.excerpt.toLowerCase();
        const content = post.attributes.content.toLowerCase();

        return title.includes(lowerTerm) || excerpt.includes(lowerTerm) || content.includes(lowerTerm);
    });
}

// ------------------------------------------------------------------
// Additional Type Guards and Helpers
// ------------------------------------------------------------------

/**
 * Type guard to check if a response is a single item response
 */
export function isSingleResponse(res: any): res is BlogPostResponse {
    return res && res.data && !Array.isArray(res.data) && res.meta;
}

/**
 * Type guard to check if a response is a collection response
 */
export function isCollectionResponse(res: any): res is BlogPostsResponse {
    return res && res.data && Array.isArray(res.data) && res.meta;
}

// End of type definitions
