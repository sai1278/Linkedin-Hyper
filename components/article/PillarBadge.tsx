import React from 'react';
import { Pillar } from '@/types';
import { cn } from '@/lib/utils';

interface PillarBadgeProps {
    pillar: Pillar;
    className?: string;
    variant?: 'light' | 'dark';
}

export const PillarBadge: React.FC<PillarBadgeProps> = ({ pillar, className, variant = 'light' }) => {
    return (
        <span
            className={cn(
                'text-xs font-medium tracking-[0.2em] uppercase',
                variant === 'dark' ? 'text-white/70' : 'text-[#49648C]',
                className
            )}
        >
            {pillar}
        </span>
    );
};