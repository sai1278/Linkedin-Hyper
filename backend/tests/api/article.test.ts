/**
 * Article API Tests
 * 
 * These tests validate the article schema and API behavior
 */

// Use require for JSON file compatibility with Jest
const articleSchema = require('../../src/api/article/content-types/article/schema.json');

describe('Article Schema', () => {
    it('should have correct collection type configuration', () => {
        expect(articleSchema.kind).toBe('collectionType');
        expect(articleSchema.collectionName).toBe('articles');
        expect(articleSchema.info.singularName).toBe('article');
        expect(articleSchema.info.pluralName).toBe('articles');
    });

    it('should have draftAndPublish enabled', () => {
        expect(articleSchema.options.draftAndPublish).toBe(true);
    });

    describe('Required Fields', () => {
        it('should have title as required', () => {
            expect(articleSchema.attributes.title.required).toBe(true);
            expect(articleSchema.attributes.title.type).toBe('string');
            expect(articleSchema.attributes.title.maxLength).toBe(200);
        });

        it('should have slug as required', () => {
            expect(articleSchema.attributes.slug.required).toBe(true);
            expect(articleSchema.attributes.slug.type).toBe('uid');
            expect(articleSchema.attributes.slug.targetField).toBe('title');
        });

        it('should have content as required', () => {
            expect(articleSchema.attributes.content.required).toBe(true);
            expect(articleSchema.attributes.content.type).toBe('richtext');
        });

        it('should have excerpt as required', () => {
            expect(articleSchema.attributes.excerpt.required).toBe(true);
            expect(articleSchema.attributes.excerpt.maxLength).toBe(500);
        });

        it('should have publishDate as required', () => {
            expect(articleSchema.attributes.publishDate.required).toBe(true);
            expect(articleSchema.attributes.publishDate.type).toBe('datetime');
        });

        it('should have readTime as required with constraints', () => {
            expect(articleSchema.attributes.readTime.required).toBe(true);
            expect(articleSchema.attributes.readTime.default).toBe(5);
            expect(articleSchema.attributes.readTime.min).toBe(1);
            expect(articleSchema.attributes.readTime.max).toBe(60);
        });

        it('should have isFeatured as required with default false', () => {
            expect(articleSchema.attributes.isFeatured.required).toBe(true);
            expect(articleSchema.attributes.isFeatured.default).toBe(false);
        });

        it('should have articleStatus as required with default Draft', () => {
            expect(articleSchema.attributes.articleStatus.required).toBe(true);
            expect(articleSchema.attributes.articleStatus.default).toBe('Draft');
            expect(articleSchema.attributes.articleStatus.enum).toContain('Draft');
            expect(articleSchema.attributes.articleStatus.enum).toContain('Published');
            expect(articleSchema.attributes.articleStatus.enum).toContain('Scheduled');
            expect(articleSchema.attributes.articleStatus.enum).toContain('Archived');
        });

        it('should have featuredImage as required media', () => {
            expect(articleSchema.attributes.featuredImage.required).toBe(true);
            expect(articleSchema.attributes.featuredImage.type).toBe('media');
            expect(articleSchema.attributes.featuredImage.allowedTypes).toContain('images');
        });
    });

    describe('Optional Fields', () => {
        it('should have subtitle as optional', () => {
            expect(articleSchema.attributes.subtitle.required).toBeUndefined();
            expect(articleSchema.attributes.subtitle.maxLength).toBe(250);
        });
    });

    describe('Relations', () => {
        it('should have author relation', () => {
            expect(articleSchema.attributes.author.type).toBe('relation');
            expect(articleSchema.attributes.author.relation).toBe('manyToOne');
            expect(articleSchema.attributes.author.target).toBe('api::author.author');
        });

        it('should have category relation', () => {
            expect(articleSchema.attributes.category.type).toBe('relation');
            expect(articleSchema.attributes.category.relation).toBe('manyToOne');
            expect(articleSchema.attributes.category.target).toBe('api::category.category');
        });

        it('should have subcategories relation', () => {
            expect(articleSchema.attributes.subcategories.type).toBe('relation');
            expect(articleSchema.attributes.subcategories.relation).toBe('manyToMany');
            expect(articleSchema.attributes.subcategories.target).toBe('api::subcategory.subcategory');
        });

        it('should have tags relation', () => {
            expect(articleSchema.attributes.tags.type).toBe('relation');
            expect(articleSchema.attributes.tags.relation).toBe('manyToMany');
            expect(articleSchema.attributes.tags.target).toBe('api::tag.tag');
        });
    });

    describe('Components', () => {
        it('should have seo component', () => {
            expect(articleSchema.attributes.seo.type).toBe('component');
            expect(articleSchema.attributes.seo.component).toBe('shared.seo');
            expect(articleSchema.attributes.seo.repeatable).toBe(false);
        });
    });
});

/**
 * Mock Article Data Helper
 * Provides valid article data for testing
 */
export const createMockArticle = (overrides = {}) => ({
    title: 'Test Article Title',
    slug: 'test-article-title',
    content: '<p>This is the article content</p>',
    subtitle: 'A test subtitle',
    excerpt: 'This is a test excerpt for the article',
    publishDate: new Date().toISOString(),
    readTime: 5,
    isFeatured: false,
    articleStatus: 'Draft',
    ...overrides,
});

/**
 * Validate article data against schema requirements
 */
export const validateArticleData = (data: Record<string, unknown>) => {
    const errors: string[] = [];

    // Check required fields
    if (!data.title || typeof data.title !== 'string') {
        errors.push('Title is required and must be a string');
    } else if ((data.title as string).length > 200) {
        errors.push('Title must be 200 characters or less');
    }

    if (!data.slug || typeof data.slug !== 'string') {
        errors.push('Slug is required and must be a string');
    }

    if (!data.content || typeof data.content !== 'string') {
        errors.push('Content is required and must be a string');
    }

    if (!data.excerpt || typeof data.excerpt !== 'string') {
        errors.push('Excerpt is required and must be a string');
    } else if ((data.excerpt as string).length > 500) {
        errors.push('Excerpt must be 500 characters or less');
    }

    if (!data.publishDate) {
        errors.push('PublishDate is required');
    }

    // Check optional field constraints
    if (data.subtitle && (data.subtitle as string).length > 250) {
        errors.push('Subtitle must be 250 characters or less');
    }

    if (data.readTime !== undefined) {
        const readTime = data.readTime as number;
        if (readTime < 1 || readTime > 60) {
            errors.push('Read time must be between 1 and 60 minutes');
        }
    }

    if (data.articleStatus !== undefined) {
        const validStatuses = ['Draft', 'Published', 'Scheduled', 'Archived'];
        if (!validStatuses.includes(data.articleStatus as string)) {
            errors.push('Article status must be one of: Draft, Published, Scheduled, Archived');
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
};

describe('Article Data Validation', () => {
    it('should validate correct article data', () => {
        const validArticle = createMockArticle();
        const result = validateArticleData(validArticle);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for missing title', () => {
        const invalidArticle = createMockArticle({ title: undefined });
        const result = validateArticleData(invalidArticle);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Title is required and must be a string');
    });

    it('should fail validation for title exceeding max length', () => {
        const invalidArticle = createMockArticle({ title: 'a'.repeat(201) });
        const result = validateArticleData(invalidArticle);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Title must be 200 characters or less');
    });

    it('should fail validation for missing slug', () => {
        const invalidArticle = createMockArticle({ slug: undefined });
        const result = validateArticleData(invalidArticle);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Slug is required and must be a string');
    });

    it('should fail validation for missing content', () => {
        const invalidArticle = createMockArticle({ content: undefined });
        const result = validateArticleData(invalidArticle);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Content is required and must be a string');
    });

    it('should fail validation for missing excerpt', () => {
        const invalidArticle = createMockArticle({ excerpt: undefined });
        const result = validateArticleData(invalidArticle);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Excerpt is required and must be a string');
    });

    it('should fail validation for missing publishDate', () => {
        const invalidArticle = createMockArticle({ publishDate: undefined });
        const result = validateArticleData(invalidArticle);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('PublishDate is required');
    });

    it('should fail validation for invalid read time', () => {
        const invalidArticle = createMockArticle({ readTime: 100 });
        const result = validateArticleData(invalidArticle);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Read time must be between 1 and 60 minutes');
    });

    it('should fail validation for invalid article status', () => {
        const invalidArticle = createMockArticle({ articleStatus: 'InvalidStatus' });
        const result = validateArticleData(invalidArticle);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContain('Article status must be one of: Draft, Published, Scheduled, Archived');
    });

    it('should pass validation with all required fields', () => {
        const minimalArticle = {
            title: 'Minimal Article',
            slug: 'minimal-article',
            content: '<p>Content</p>',
            excerpt: 'Test excerpt for the article',
            publishDate: new Date().toISOString(),
        };
        const result = validateArticleData(minimalArticle);
        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });
});
