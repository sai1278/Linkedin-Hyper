import React from 'react';
import { cn } from '@/lib/utils';

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
    children: React.ReactNode;
    background?: 'white' | 'muted' | 'gradient';
}

export const Section: React.FC<SectionProps> = ({
    children,
    background = 'white',
    className,
    ...props
}) => {
    const backgrounds = {
        white: 'bg-white',
        muted: 'bg-cream',
        gradient: 'bg-gradient-to-b from-white to-cream',
    };

    return (
        <section
            className={cn('py-12 md:py-16 lg:py-20', backgrounds[background], className)}
            {...props}
        >
            {children}
        </section>
    );
};