'use client';

import { useState } from 'react';
import { getInitials } from '@/lib/utils';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

interface AvatarProps {
  name: string;
  size?: AvatarSize;
  src?: string | null;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
};

export function Avatar({ name, size = 'md', src }: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const canRenderImage = Boolean(src) && !imageFailed;

  return (
    <div
      className={`${sizeClasses[size]} flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white`}
      style={{
        background: canRenderImage
          ? 'var(--surface-panel, rgba(255,255,255,0.08))'
          : 'linear-gradient(135deg, var(--color-primary-600, var(--accent)) 0%, var(--color-primary-800, var(--accent-hover)) 100%)',
        border: '1px solid rgba(148, 163, 184, 0.22)',
        boxShadow: '0 10px 20px -16px rgba(15, 23, 42, 0.6)',
      }}
    >
      {canRenderImage ? (
        <img
          src={src || undefined}
          alt={`${name} avatar`}
          className="block h-full w-full rounded-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      ) : (
        getInitials(name)
      )}
    </div>
  );
}
