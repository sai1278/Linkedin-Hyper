import React from 'react';
import { Container } from '@/components/ui/Container';
import { Section } from '@/components/ui/Section';
import { NewsletterForm } from '@/components/forms/NewsletterForm';

export const NewsletterSection: React.FC = () => {
    return (
        <Section background="gradient">
            <Container maxWidth="md">
                <div className="bg-white rounded-2xl shadow-xl p-8 md:p-12">
                    <NewsletterForm variant="centered" />
                </div>
            </Container>
        </Section>
    );
};