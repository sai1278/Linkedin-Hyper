import React from 'react';
import AuthorCard from '@/components/article/AuthorCard';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { PillarBadge } from '@/components/article/PillarBadge';
import { SocialShareButtons } from '@/components/article/SocialShareButtons';
import { getArticleBySlug, getAllArticles } from '@/lib/data-service';
import { getBlogPostBySlug } from '@/lib/blog-post-api';
import { notFound } from 'next/navigation';
import { BlocksRenderer } from '@strapi/blocks-react-renderer';

interface BlogPageProps {
    params: Promise<{
        slug: string;
    }>;
}

// Generate static params for all articles
export async function generateStaticParams() {
    const articles = await getAllArticles();
    return articles.map((article) => ({
        slug: article.slug,
    }));
}

// Per-post SEO metadata — uses the shared.seo component fields if filled,
// falling back to the article's own title / excerpt / coverImage.
export async function generateMetadata({ params }: BlogPageProps): Promise<Metadata> {
    const { slug } = await params;

    // Try to get SEO component data from the blog-post entry
    let seoTitle: string | undefined;
    let seoDescription: string | undefined;
    let seoImageUrl: string | undefined;
    let seoKeywords: string | undefined;
    let seoCanonical: string | undefined;
    let noIndex = false;

    try {
        const blogPost = await getBlogPostBySlug(slug);
        if (blogPost?.attributes?.seo) {
            const seo = blogPost.attributes.seo;
            seoTitle = seo.metaTitle || undefined;
            seoDescription = seo.metaDescription || undefined;
            seoKeywords = seo.keywords || undefined;
            seoCanonical = seo.canonicalURL || undefined;
            noIndex = seo.noIndex ?? false;
            // ogImage from the SEO component
            const ogImgData = seo.ogImage?.data;
            if (ogImgData?.attributes?.url) {
                const base = process.env.NEXT_PUBLIC_STRAPI_URL || 'http://localhost:5603';
                const url = ogImgData.attributes.url;
                seoImageUrl = url.startsWith('http') ? url : `${base}${url}`;
            }
        }
    } catch {
        // SEO component unavailable — fall through to article defaults
    }

    // Fall back to article data
    const article = await getArticleBySlug(slug);
    const title = seoTitle || article?.title;
    const description = seoDescription || article?.excerpt;
    const imageUrl = seoImageUrl || article?.featuredImage;

    return {
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        ...(seoKeywords ? { keywords: seoKeywords } : {}),
        ...(noIndex ? { robots: { index: false, follow: false } } : {}),
        openGraph: {
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
            ...(imageUrl ? { images: [{ url: imageUrl }] } : {}),
        },
        twitter: {
            card: 'summary_large_image',
            ...(title ? { title } : {}),
            ...(description ? { description } : {}),
            ...(imageUrl ? { images: [imageUrl] } : {}),
        },
        ...(seoCanonical ? { alternates: { canonical: seoCanonical } } : {}),
    };
}

export default async function BlogArticlePage({ params }: BlogPageProps) {
    // Await params in Next.js 15
    const { slug } = await params;
    const strapiBaseUrl = process.env.NEXT_PUBLIC_STRAPI_URL || '';

    // Find the article by slug
    const article = await getArticleBySlug(slug);

    if (!article) {
        notFound();
    }

    return (
        <>
            {/* Article Header */}
            <section className="bg-white border-b border-gray-100">
                <Container maxWidth="lg">
                    <div className="py-12 md:py-16">
                        {/* Breadcrumb */}
                        <div className="flex items-center space-x-2 text-sm text-gray-500 mb-8">
                            <Link href="/" className="hover:text-[#49648C] transition-colors">
                                Home
                            </Link>
                            <span>/</span>
                            <Link href="/blog" className="hover:text-[#49648C] transition-colors">
                                Blog
                            </Link>
                            <span>/</span>
                            <span className="text-[#0B1F3B]">{article.pillar}</span>
                        </div>

                        {/* Pillar Badge */}
                        <PillarBadge pillar={article.pillar} className="mb-6" />

                        {/* Title */}
                        <h1 className="text-4xl md:text-5xl lg:text-6xl font-light text-[#0B1F3B] leading-tight mb-6">
                            {article.title}
                        </h1>

                        {/* Subtitle */}
                        {article.subtitle && (
                            <p className="text-xl md:text-2xl text-gray-600 font-light mb-8">
                                {article.subtitle}
                            </p>
                        )}

                        {/* Meta Info */}
                        <div className="flex items-center justify-between border-t border-b border-gray-200 py-6">
                            <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-lg">
                                    {article.author.name.charAt(0)}
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-[#0B1F3B]">{article.author.name}</p>
                                    <p className="text-xs text-gray-500">{article.author.role}</p>
                                </div>
                            </div>

                            <div className="flex items-center space-x-6 text-sm text-gray-500">
                                <span>{new Date(article.publishDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                                <span>•</span>
                                <span>{article.readTime} min read</span>
                            </div>
                        </div>
                    </div>
                </Container>
            </section>

            {/* Featured Image */}
            <section className="bg-white">
                <Container maxWidth="lg">
                    <div className="relative w-full aspect-[21/9] bg-gray-100">
                        <Image
                            src={article.featuredImage}
                            alt={article.title}
                            fill
                            className="object-cover"
                            priority
                        />
                    </div>
                </Container>
            </section>

            {/* Article Content */}
            <section className="bg-white">
                <Container maxWidth="md">
                    <article className="py-16 md:py-20">
                        {/* Article Body */}
                        <div className="prose prose-lg max-w-none">
                            {/* Render Strapi Blocks content */}
                            {article.content ? (
                                <BlocksRenderer content={JSON.parse(article.content as string)} />
                            ) : (
                                <p className="text-gray-500 italic">No content available.</p>
                            )}
                        </div>

                        {/* Tags */}
                        <div className="mt-12 pt-8 border-t border-gray-200">
                            <p className="text-sm font-medium text-gray-500 mb-3">Topics:</p>
                            <div className="flex flex-wrap gap-2">
                                {(article.tags ?? []).map((tag) => (
                                    <Link
                                        key={tag.id}
                                        href={`/blog?tag=${tag.slug}`}
                                        className="px-3 py-1 text-xs font-medium text-[#0B1F3B] border border-gray-200 hover:border-[#49648C] hover:text-[#49648C] transition-colors"
                                        style={{ borderRadius: '2px' }}
                                    >
                                        {tag.name}
                                    </Link>
                                ))}
                            </div>
                        </div>

                        {/* Share */}
                        <div className="mt-8 pt-8 border-t border-gray-200">
                            <p className="text-sm font-medium text-gray-500 mb-4">Share this article:</p>
                            <SocialShareButtons
                                title={article.title}
                                url={`https://regulatethis.com/blog/${article.slug}`}
                            />
                        </div>
                    </article>
                </Container>
            </section>

            {/* Author Bio - Simplified */}
            <section className="bg-[#F5F2EA]">
                <Container maxWidth="md">
                    <div className="py-12 md:py-16">
                        <AuthorCard author={article.author} strapiBaseUrl={strapiBaseUrl} />
                    </div>
                </Container>
            </section>
        </>
    );
}