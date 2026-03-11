import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Article } from '@/types';
import { Card } from '@/components/ui/Card';
import { PillarBadge } from './PillarBadge';
import { formatDate } from '@/lib/utils';

interface ArticleCardProps {
    article: Article;
}

export const ArticleCard: React.FC<ArticleCardProps> = ({ article }) => {
    return (
        <Link href={`/blog/${article.slug}`}>
            <Card hover className="h-full flex flex-col">
                {/* Image */}
                <div className="relative w-full h-48 bg-gray-200">
                    <Image
                        src={article.featuredImage}
                        alt={article.title}
                        fill
                        className="object-cover"
                    />
                </div>

                {/* Content */}
                <div className="p-6 flex flex-col flex-grow">
                    {/* Pillar Badge */}
                    <PillarBadge pillar={article.pillar} className="mb-3" />

                    {/* Title */}
                    <h3 className="text-xl font-heading text-navy mb-2 line-clamp-2">
                        {article.title}
                    </h3>

                    {/* Excerpt */}
                    <p className="text-sm text-gray-600 mb-4 line-clamp-3 flex-grow">
                        {article.excerpt}
                    </p>

                    {/* Meta */}
                    <div className="flex items-center justify-between text-xs text-gray-500 pt-4 border-t border-gray-200">
                        <span>{article.author.name}</span>
                        <span>{article.readTime} min read</span>
                    </div>
                </div>
            </Card>
        </Link>
    );
};