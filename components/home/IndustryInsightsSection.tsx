'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Container } from '@/components/ui/Container';
import { getIndustryInsightsArticles } from '@/lib/data-service';
import { Article } from '@/types';

export const IndustryInsightsSection: React.FC = () => {
    const [articles, setArticles] = useState<Article[]>([]);

    useEffect(() => {
        getIndustryInsightsArticles(7).then(data => setArticles(data)).catch(() => { });
    }, []);

    // Split articles: 1 featured + 6 regular
    const featuredArticle = articles[0];
    const regularArticles = articles.slice(1);

    if (!featuredArticle) {
        return null; // Don't render until data is loaded
    }

    return (
        <section className="relative bg-white overflow-hidden">
            <Container>
                <div className="py-20 md:py-28">
                    {/* Section Header */}
                    <div className="mb-12">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="flex items-center space-x-3 mb-4">
                                    <div className="h-px w-12 bg-[#49648C]"></div>
                                    <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[#49648C]">
                                        Research & Analysis
                                    </span>
                                </div>
                                <h2 className="text-4xl md:text-5xl font-light text-[#0B1F3B]">
                                    Industry Insights
                                </h2>
                            </div>

                            <Link
                                href="/blog?pillar=industry-insights"
                                className="hidden md:inline-flex items-center space-x-2 text-sm font-medium text-[#0B1F3B] hover:text-[#49648C] transition-colors"
                            >
                                <span>View All</span>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </Link>
                        </div>
                    </div>

                    {/* Magazine Grid Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

                        {/* Featured Article - Large (spans 7 columns) */}
                        <div className="lg:col-span-7">
                            <Link href={`/blog/${featuredArticle.slug}`} className="group block">
                                <article className="h-full">
                                    <div className="relative w-full aspect-[4/3] bg-gray-100 overflow-hidden mb-6">
                                        <Image
                                            src={featuredArticle.featuredImage}
                                            alt={featuredArticle.title}
                                            fill
                                            className="object-cover group-hover:scale-105 transition-transform duration-700"
                                        />
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex items-center space-x-4 text-xs text-gray-500">
                                            <span className="font-medium text-[#49648C]">{featuredArticle.pillar}</span>
                                            <span>•</span>
                                            <span>{featuredArticle.author.name}</span>
                                            <span>•</span>
                                            <span>{featuredArticle.readTime} min read</span>
                                        </div>

                                        <h3 className="text-3xl md:text-4xl font-light text-[#0B1F3B] leading-tight group-hover:text-[#49648C] transition-colors">
                                            {featuredArticle.title}
                                        </h3>

                                        {featuredArticle.subtitle && (
                                            <p className="text-lg text-gray-600 font-light">
                                                {featuredArticle.subtitle}
                                            </p>
                                        )}

                                        <p className="text-base text-gray-600 leading-relaxed">
                                            {featuredArticle.excerpt}
                                        </p>
                                    </div>
                                </article>
                            </Link>
                        </div>

                        {/* Regular Articles Grid - 3x2 (spans 5 columns) */}
                        <div className="lg:col-span-5 space-y-8">
                            {regularArticles.map((article) => (
                                <Link
                                    key={article.id}
                                    href={`/blog/${article.slug}`}
                                    className="group block"
                                >
                                    <article className="flex gap-4">
                                        {/* Small Image */}
                                        <div className="relative w-24 h-24 flex-shrink-0 bg-gray-100 overflow-hidden">
                                            <Image
                                                src={article.featuredImage}
                                                alt={article.title}
                                                fill
                                                className="object-cover group-hover:scale-110 transition-transform duration-500"
                                            />
                                        </div>

                                        {/* Content */}
                                        <div className="flex-grow space-y-2">
                                            <div className="text-xs text-gray-500">
                                                <span>{article.author.name}</span>
                                                <span className="mx-2">•</span>
                                                <span>{article.readTime} min</span>
                                            </div>

                                            <h4 className="text-base font-medium text-[#0B1F3B] leading-tight group-hover:text-[#49648C] transition-colors line-clamp-2">
                                                {article.title}
                                            </h4>
                                        </div>
                                    </article>
                                </Link>
                            ))}
                        </div>
                    </div>

                    {/* Mobile View All Link */}
                    <div className="md:hidden mt-8 text-center">
                        <Link
                            href="/blog?pillar=industry-insights"
                            className="inline-flex items-center space-x-2 text-sm font-medium text-[#0B1F3B] hover:text-[#49648C] transition-colors"
                        >
                            <span>View All Insights</span>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </Link>
                    </div>
                </div>
            </Container>
        </section>
    );
};