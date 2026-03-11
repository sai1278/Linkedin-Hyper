'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';

export const Header: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const mainNavLinks = [
        { href: '/', label: 'Home' },
        { href: '/blog', label: 'Blog' },
        { href: '/authors', label: 'Authors' },
        { href: '/about', label: 'About' },
    ];

    const pillarLinks = [
        { href: '/blog?pillar=compliance-regulation', label: 'Compliance & Regulation' },
        { href: '/blog?pillar=technology-operations', label: 'Technology & Operations' },
        { href: '/blog?pillar=practice-management', label: 'Practice Management' },
        { href: '/blog?pillar=client-strategy', label: 'Client Strategy' },
        { href: '/blog?pillar=industry-insights', label: 'Industry Insights' },
    ];

    return (
        <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
            <Container>
                <div className="flex items-center justify-between h-16">
                    {/* Logo with Icon */}
                    <Link href="/" className="flex items-center gap-2">
                        {/* Logo Icon - Shield/Badge shape */}
                        <div className="relative w-8 h-8 flex items-center justify-center">
                            <svg viewBox="0 0 32 36" fill="none" className="w-full h-full">
                                {/* Outer shield */}
                                <path
                                    d="M16 2L4 8v8c0 7.5 5 14 12 18 7-4 12-10.5 12-18V8L16 2z"
                                    fill="#49648C"
                                />
                                {/* Inner accent */}
                                <path
                                    d="M16 6L8 10v6c0 5 3.5 9.5 8 12 4.5-2.5 8-7 8-12v-6l-8-4z"
                                    fill="#0B1F3B"
                                />
                                {/* Check mark or 'R' initial */}
                                <text
                                    x="16"
                                    y="21"
                                    textAnchor="middle"
                                    fill="white"
                                    fontSize="14"
                                    fontWeight="bold"
                                    fontFamily="serif"
                                >
                                    R
                                </text>
                            </svg>
                        </div>

                        <span className="text-xl md:text-2xl font-bold text-[#0B1F3B]">
                            RegulateThis
                        </span>
                    </Link>

                    {/* Desktop Navigation - Topics First */}
                    <nav className="hidden lg:flex items-center space-x-6">
                        <Link
                            href="/"
                            className="text-sm font-medium text-[#0B1F3B] hover:text-[#49648C] transition-colors"
                        >
                            Home
                        </Link>

                        {/* Topics Dropdown - Now Second */}
                        <div className="relative group">
                            <button className="text-sm font-medium text-[#0B1F3B] hover:text-[#49648C] transition-colors flex items-center gap-1">
                                Topics
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {/* Dropdown Menu */}
                            <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                <div className="py-2">
                                    {pillarLinks.map((link) => (
                                        <Link
                                            key={link.href}
                                            href={link.href}
                                            className="block px-4 py-2 text-sm text-[#0B1F3B] hover:bg-[#F5F2EA] hover:text-[#49648C] transition-colors"
                                        >
                                            {link.label}
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <Link
                            href="/blog"
                            className="text-sm font-medium text-[#0B1F3B] hover:text-[#49648C] transition-colors"
                        >
                            Blog
                        </Link>

                        <Link
                            href="/authors"
                            className="text-sm font-medium text-[#0B1F3B] hover:text-[#49648C] transition-colors"
                        >
                            Authors
                        </Link>

                        <Link
                            href="/about"
                            className="text-sm font-medium text-[#0B1F3B] hover:text-[#49648C] transition-colors"
                        >
                            About
                        </Link>
                    </nav>

                    {/* Right Side: Search + Mobile Menu */}
                    <div className="flex items-center space-x-4">
                        {/* Search Icon */}
                        <button
                            className="p-2 text-[#0B1F3B] hover:text-[#49648C] hover:bg-[#F5F2EA] rounded-full transition-colors"
                            aria-label="Search"
                        >
                            <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                />
                            </svg>
                        </button>

                        {/* Mobile Menu Button */}
                        <button
                            className="lg:hidden p-2 text-[#0B1F3B]"
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            aria-label="Toggle menu"
                        >
                            {isMobileMenuOpen ? (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            ) : (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                            )}
                        </button>
                    </div>
                </div>

                {/* Mobile Menu */}
                {isMobileMenuOpen && (
                    <div className="lg:hidden py-4 border-t border-gray-200">
                        <nav className="flex flex-col space-y-1">
                            <Link
                                href="/"
                                className="px-4 py-2 text-sm font-medium text-[#0B1F3B] hover:bg-[#EEE9DF] rounded transition-colors"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                Home
                            </Link>

                            {/* Topics Section in Mobile */}
                            <div className="pt-2 pb-1 px-4">
                                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Topics</span>
                            </div>
                            {pillarLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className="px-4 py-2 pl-8 text-sm text-[#0B1F3B] hover:bg-[#EEE9DF] rounded transition-colors"
                                    onClick={() => setIsMobileMenuOpen(false)}
                                >
                                    {link.label}
                                </Link>
                            ))}

                            <Link
                                href="/blog"
                                className="px-4 py-2 text-sm font-medium text-[#0B1F3B] hover:bg-[#EEE9DF] rounded transition-colors"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                Blog
                            </Link>

                            <Link
                                href="/authors"
                                className="px-4 py-2 text-sm font-medium text-[#0B1F3B] hover:bg-[#EEE9DF] rounded transition-colors"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                Authors
                            </Link>

                            <Link
                                href="/about"
                                className="px-4 py-2 text-sm font-medium text-[#0B1F3B] hover:bg-[#EEE9DF] rounded transition-colors"
                                onClick={() => setIsMobileMenuOpen(false)}
                            >
                                About
                            </Link>
                        </nav>
                    </div>
                )}
            </Container>
        </header>
    );
};