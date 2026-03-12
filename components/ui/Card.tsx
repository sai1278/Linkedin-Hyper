import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    hover?: boolean;
}

export const Card: React.FC<CardProps> = ({
    children,
    hover = false,
    className,
    ...props
}) => {
    return (
        <div
            className={cn(
                'bg-white rounded-lg shadow-md overflow-hidden',
                hover && 'transition-transform hover:scale-105 hover:shadow-lg cursor-pointer',
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
};