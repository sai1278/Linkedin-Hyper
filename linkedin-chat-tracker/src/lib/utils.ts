import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const past = typeof date === 'string' ? new Date(date) : date;
  
  if (isNaN(past.getTime())) return '';

  const diffMs = now.getTime() - past.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (past.getDate() === yesterday.getDate() && past.getMonth() === yesterday.getMonth() && past.getFullYear() === yesterday.getFullYear()) {
    return 'Yesterday';
  }

  // E.g., Jan 12
  return past.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
