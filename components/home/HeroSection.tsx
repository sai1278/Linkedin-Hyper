'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Container } from '@/components/ui/Container';
import { getAllArticles } from '@/lib/data-service';
import { Pillar, Article } from '@/types';

export const HeroSection: React.FC = () => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isAutoPlaying, setIsAutoPlaying] = useState(true);
    const [articles, setArticles] = useState<Article[]>([]);

    const pillars: Pillar[] = [
        'Compliance & Regulation',
        'Technology & Operations',
        'Practice Management',
        'Client Strategy',
        'Industry Insights',
    ];

    useEffect(() => {
        getAllArticles().then(data => setArticles(data)).catch(() => { });
    }, []);

    const featuredArticles = pillars
        .map(pillar => articles.find(article => article.pillar === pillar))
        .filter(article => article !== undefined) as Article[];

    useEffect(() => {
        if (!isAutoPlaying) return;

        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % featuredArticles.length);
        }, 6000);

        return () => clearInterval(interval);
    }, [isAutoPlaying, featuredArticles.length]);

    const goToSlide = (index: number) => {
        setCurrentIndex(index);
        setIsAutoPlaying(false);
    };

    const goToPrevious = () => {
        setCurrentIndex((prev) => (prev - 1 + featuredArticles.length) % featuredArticles.length);
        setIsAutoPlaying(false);
    };

    const goToNext = () => {
        setCurrentIndex((prev) => (prev + 1) % featuredArticles.length);
        setIsAutoPlaying(false);
    };

    if (featuredArticles.length === 0) {
        return null;
    }

    const currentArticle = featuredArticles[currentIndex];

    return (
        <section className="relative bg-[#0B1F3B] text-white overflow-hidden h-[calc(100vh-4rem)]">
            {/* Subtle grid pattern overlay */}
            <div className="absolute inset-0 opacity-5">
                <div className="absolute inset-0" style={{
                    backgroundImage: `linear-gradient(#49648C 1px, transparent 1px), linear-gradient(90deg, #49648C 1px, transparent 1px)`,
                    backgroundSize: '50px 50px'
                }}></div>
            </div>


            <Container>
                <div className="relative py-8 md:py-12 flex flex-col justify-center h-full">
                    {/* Content Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">

                        {/* Left Content - 7 columns */}
                        <div className="lg:col-span-7 space-y-6">
                            {/* Category Label */}
                            <div className="flex items-center space-x-3">
                                <div className="h-px w-12 bg-[#49648C]"></div>
                                <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[#49648C]">
                                    {currentArticle.pillar}
                                </span>
                            </div>

                            {/* Headline */}
                            <Link href={`/blog/${currentArticle.slug}`} className="block group">
                                <h1 className="text-4xl md:text-5xl lg:text-6xl font-light leading-[1.1] tracking-tight mb-4 group-hover:text-[#49648C] transition-colors duration-300">
                                    {currentArticle.title}
                                </h1>
                            </Link>

                            {/* Subtitle */}
                            {currentArticle.subtitle && (
                                <p className="text-lg md:text-xl font-light text-gray-300 leading-relaxed">
                                    {currentArticle.subtitle}
                                </p>
                            )}

                            {/* Meta Info */}
                            <div className="flex items-center space-x-6 pt-2">
                                <div className="flex items-center space-x-3">
                                    <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-[#49648C]">
                                        <Image
                                            src={currentArticle.author.photo}
                                            alt={currentArticle.author.name}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">{currentArticle.author.name}</p>
                                        <p className="text-xs text-gray-400">{currentArticle.author.title}</p>
                                    </div>
                                </div>
                                <div className="h-8 w-px bg-gray-700"></div>
                                <span className="text-sm text-gray-400">{currentArticle.readTime} min read</span>
                            </div>

                            {/* CTA */}
                            <Link
                                href={`/blog/${currentArticle.slug}`}
                                className="inline-flex items-center space-x-2 text-sm font-medium tracking-wide uppercase group mt-4"
                            >
                                <span className="group-hover:text-[#49648C] transition-colors">Read Full Article</span>
                                <svg className="w-5 h-5 group-hover:translate-x-1 group-hover:text-[#49648C] transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                                </svg>
                            </Link>
                        </div>

                        {/* Right Image - 5 columns */}
                        <div className="lg:col-span-5">
                            <Link href={`/blog/${currentArticle.slug}`} className="block group">
                                <div className="relative aspect-[4/5] rounded-sm overflow-hidden shadow-2xl max-h-[70vh]">
                                    <Image
                                        src={currentArticle.featuredImage}
                                        alt={currentArticle.title}
                                        fill
                                        className="object-cover group-hover:scale-105 transition-transform duration-700"
                                        priority
                                    />
                                    {/* Gradient overlay for sophistication */}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-60"></div>
                                </div>
                            </Link>
                        </div>
                    </div>

                    {/* Navigation Controls - Minimal & Elegant */}
                    <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-800">
                        {/* Left: Topic Pills */}
                        <div className="flex items-center space-x-2 flex-wrap">
                            {featuredArticles.map((article, index) => (
                                <button
                                    key={article.id}
                                    onClick={() => goToSlide(index)}
                                    className={`px-3 py-1 text-xs font-medium tracking-wide uppercase transition-all duration-300 ${index === currentIndex
                                        ? 'bg-[#49648C] text-white'
                                        : 'bg-transparent text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500'
                                        }`}
                                    style={{ borderRadius: '2px' }}
                                >
                                    {article.pillar.split(' ')[0]}
                                </button>
                            ))}
                        </div>

                        {/* Right: Arrow Navigation */}
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={goToPrevious}
                                className="w-10 h-10 flex items-center justify-center border border-gray-700 hover:border-[#49648C] hover:text-[#49648C] transition-colors"
                                style={{ borderRadius: '2px' }}
                                aria-label="Previous"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>

                            <span className="text-sm font-light text-gray-500">
                                {String(currentIndex + 1).padStart(2, '0')} / {String(featuredArticles.length).padStart(2, '0')}
                            </span>

                            <button
                                onClick={goToNext}
                                className="w-10 h-10 flex items-center justify-center border border-gray-700 hover:border-[#49648C] hover:text-[#49648C] transition-colors"
                                style={{ borderRadius: '2px' }}
                                aria-label="Next"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </Container>
        </section>
    );
};