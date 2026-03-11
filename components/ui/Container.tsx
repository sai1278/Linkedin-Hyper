import React from 'react';
import { cn } from '@/lib/utils';

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}

export const Container: React.FC<ContainerProps> = ({
    children,
    maxWidth = 'xl',
    className,
    ...props
}) => {
    const maxWidths = {
        sm: 'max-w-3xl',
        md: 'max-w-5xl',
        lg: 'max-w-6xl',
        xl: 'max-w-7xl',
        '2xl': 'max-w-[1400px]',
        full: 'max-w-full',
    };

    return (
        <div
            className={cn(
                'mx-auto px-4 sm:px-6 lg:px-8',
                maxWidths[maxWidth],
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
};