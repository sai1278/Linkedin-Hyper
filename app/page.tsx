import React from 'react';
import { HeroSection } from '@/components/home/HeroSection';
import { WhoThisIsForSection } from '@/components/home/WhoThisIsForSection';
import { IndustryInsightsSection } from '@/components/home/IndustryInsightsSection';
import { RecentArticlesSection } from '@/components/home/RecentArticlesSection';
import { NewsletterSection } from '@/components/home/NewsletterSection';

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <WhoThisIsForSection />
      <IndustryInsightsSection />
      <RecentArticlesSection />
      <NewsletterSection />
    </>
  );
}