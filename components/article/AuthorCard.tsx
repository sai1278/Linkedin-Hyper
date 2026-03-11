import Image from 'next/image';
import Link from 'next/link';
import { BlogAuthor as BlogPostAuthor } from '@/types/blog-post';

interface AuthorCardProps {
    author: BlogPostAuthor;
    strapiBaseUrl: string;
}

export default function AuthorCard({ author, strapiBaseUrl }: AuthorCardProps) {
    const avatarUrl = author.avatar?.data?.attributes?.url
        ? (author.avatar.data.attributes.url.startsWith('http')
            ? author.avatar.data.attributes.url
            : strapiBaseUrl + author.avatar.data.attributes.url)
        : null;

    return (
        <div className="flex items-start space-x-6">
            {avatarUrl ? (
                <Image
                    src={avatarUrl}
                    alt={author.name}
                    width={80}
                    height={80}
                    className="rounded-full object-cover w-20 h-20 flex-shrink-0"
                />
            ) : (
                <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-3xl flex-shrink-0">
                    {author.name.charAt(0)}
                </div>
            )}
            <div className="flex-grow">
                <p className="text-sm font-semibold tracking-wide uppercase text-[#49648C] mb-2">
                    About the Author
                </p>
                <h3 className="text-2xl font-medium text-[#0B1F3B] mb-2">{author.name}</h3>
                <p className="text-sm text-gray-600 mb-4">{author.role}</p>

                {author.description && (
                    <p className="text-sm text-gray-700 leading-relaxed mt-1 mb-3">{author.description}</p>
                )}

                {author.bio && (
                    <p className="text-base text-gray-700 leading-relaxed mt-2 mb-4">{author.bio}</p>
                )}

                {(author.linkedin || author.twitter) && (
                    <div className="flex items-center gap-4 mt-2">
                        {author.linkedin && (
                            <a
                                href={author.linkedin}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="LinkedIn profile"
                                className="text-sm font-medium text-[#49648C] hover:text-[#0B1F3B] transition-colors"
                            >
                                LinkedIn
                            </a>
                        )}
                        {author.linkedin && author.twitter && (
                            <span className="text-gray-300">|</span>
                        )}
                        {author.twitter && (
                            <a
                                href={author.twitter}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Twitter / X profile"
                                className="text-sm font-medium text-[#49648C] hover:text-[#0B1F3B] transition-colors"
                            >
                                Twitter / X
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
