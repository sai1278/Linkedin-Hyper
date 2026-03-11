'use client';

import React from 'react';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';

export const Footer: React.FC = () => {
    const currentYear = new Date().getFullYear();

    const footerLinks = {
        navigation: [
            { href: '/', label: 'Home' },
            { href: '/blog', label: 'Blog' },
            { href: '/authors', label: 'Authors' },
            { href: '/about', label: 'About' },
        ],
        pillars: [
            { href: '/blog?pillar=compliance-regulation', label: 'Compliance & Regulation' },
            { href: '/blog?pillar=technology-operations', label: 'Technology & Operations' },
            { href: '/blog?pillar=practice-management', label: 'Practice Management' },
            { href: '/blog?pillar=client-strategy', label: 'Client Strategy' },
            { href: '/blog?pillar=industry-insights', label: 'Industry Insights' },
        ],
        legal: [
            { href: '/privacy', label: 'Privacy Policy' },
            { href: '/terms', label: 'Terms of Use' },
        ],
    };

    return (
        <footer className="bg-[#0B1F3B] text-white">
            <Container>
                <div className="py-12 md:py-16">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12">
                        {/* About Section */}
                        <div className="lg:col-span-1">
                            <h3 className="text-xl font-bold mb-4">RegulateThis</h3>
                            <p className="text-sm text-gray-300 leading-relaxed">
                                Educational insights for wealth management professionals.
                                Helping RIAs navigate compliance, technology, and growth.
                            </p>
                            <div className="flex space-x-4 mt-6">
                                {/* LinkedIn */}
<a
                                href="https://linkedin.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-300 hover:text-white transition-colors"
                                aria-label="LinkedIn"
                >
                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                                </svg>
                            </a>
                            {/* Twitter */}
<a
                            href="https://twitter.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-300 hover:text-white transition-colors"
                            aria-label="Twitter"
                >
                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                            </svg>
                        </a>
                    </div>
                </div>

                {/* Navigation Links */}
                <div>
                    <h4 className="text-sm font-semibold mb-4 uppercase tracking-wider">
                        Navigation
                    </h4>
                    <ul className="space-y-2">
                        {footerLinks.navigation.map((link) => (
                            <li key={link.href}>
                                <Link
                                    href={link.href}
                                    className="text-sm text-gray-300 hover:text-white transition-colors"
                                >
                                    {link.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Content Pillars */}
                <div>
                    <h4 className="text-sm font-semibold mb-4 uppercase tracking-wider">
                        Topics
                    </h4>
                    <ul className="space-y-2">
                        {footerLinks.pillars.map((link) => (
                            <li key={link.href}>
                                <Link
                                    href={link.href}
                                    className="text-sm text-gray-300 hover:text-white transition-colors"
                                >
                                    {link.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Newsletter Signup */}
                <div>
                    <h4 className="text-sm font-semibold mb-4 uppercase tracking-wider">
                        Newsletter
                    </h4>
                    <p className="text-sm text-gray-300 mb-4">
                        Get weekly insights delivered to your inbox.
                    </p>
                    <form className="flex flex-col space-y-2">
                        <input
                            type="email"
                            placeholder="Your email"
                            className="px-4 py-2 rounded bg-[#0F2A4D] text-white placeholder-gray-400 border border-[#3A5070] focus:outline-none focus:ring-2 focus:ring-[#49648C]"
                        />
                        <button
                            type="submit"
                            className="px-4 py-2 bg-[#49648C] text-white rounded hover:bg-[#6B82A8] transition-colors"
                        >
                            Subscribe
                        </button>
                    </form>
                </div>
            </div>

            {/* Bottom Bar */}
            <div className="mt-12 pt-8 border-t border-[#0F2A4D]">
                <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
                    <p className="text-sm text-gray-400">
                        © {currentYear} RegulateThis. All rights reserved.
                    </p>
                    <div className="flex space-x-6">
                        {footerLinks.legal.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className="text-sm text-gray-400 hover:text-white transition-colors"
                            >
                                {link.label}
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      </Container >
    </footer >
  );
};