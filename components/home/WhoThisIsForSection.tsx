import React from 'react';
import { Container } from '@/components/ui/Container';

export const WhoThisIsForSection: React.FC = () => {
    const audiences = [
        {
            title: 'RIA Owners & Executives',
            description: 'Strategic insights for growth, operations, and competitive positioning',
        },
        {
            title: 'Compliance Teams & CCOs',
            description: 'Regulatory updates, audit preparation, and risk management strategies',
        },
        {
            title: 'Operations Leaders',
            description: 'Technology evaluation, workflow optimization, and efficiency solutions',
        },
        {
            title: 'Financial Advisors',
            description: 'Client strategies, portfolio construction, and practice management insights',
        },
    ];

    return (
        <section className="relative bg-white overflow-hidden">
            <Container>
                <div className="py-20 md:py-28">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">

                        {/* Left Side - Statement */}
                        <div className="lg:col-span-5 space-y-6">
                            <div className="flex items-center space-x-3">
                                <div className="h-px w-12 bg-[#49648C]"></div>
                                <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[#49648C]">
                                    Our Audience
                                </span>
                            </div>

                            <h2 className="text-4xl md:text-5xl font-light text-[#0B1F3B] leading-tight">
                                Educational insights for wealth management professionals
                            </h2>

                            <p className="text-lg text-gray-600 leading-relaxed font-light">
                                Whether you're navigating compliance requirements, evaluating technology solutions,
                                or scaling your practice, our content provides the clarity and depth you need.
                            </p>

                            <div className="pt-4">
                                <div className="inline-flex items-center space-x-2 text-sm font-medium text-[#49648C]">
                                    <span>Trusted by industry professionals</span>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        {/* Right Side - Audience Cards */}
                        <div className="lg:col-span-7">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {audiences.map((audience, index) => (
                                    <div
                                        key={index}
                                        className="group relative p-8 bg-white border border-gray-200 hover:border-[#49648C] transition-all duration-300 overflow-hidden"
                                    >
                                        {/* Top accent line on hover */}
                                        <div className="absolute top-0 left-0 w-full h-0.5 bg-[#49648C] transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></div>

                                        {/* Small square accent - top right */}
                                        <div className="absolute top-6 right-6 w-3 h-3 bg-[#49648C] opacity-20 group-hover:opacity-60 group-hover:rotate-45 transition-all duration-300"></div>

                                        <div className="relative">
                                            <h3 className="text-xl font-medium text-[#0B1F3B] mb-3 group-hover:text-[#49648C] transition-colors duration-300">
                                                {audience.title}
                                            </h3>
                                            <p className="text-sm text-gray-600 leading-relaxed">
                                                {audience.description}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </Container>
        </section>
    );
};