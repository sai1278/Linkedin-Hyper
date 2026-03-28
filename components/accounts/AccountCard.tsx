// FILE: components/accounts/AccountCard.tsx
'use client';

import { useState } from 'react';
import { SessionStatus } from './SessionStatus';
import { RateLimitBar } from '../dashboard/RateLimitBar';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Account } from '@/types/dashboard';

interface RateLimits {
  messagesSent?: { current: number; limit: number; resetsAt?: number };
  connectRequests?: { current: number; limit: number; resetsAt?: number };
  searchQueries?: { current: number; limit: number; resetsAt?: number };
}

interface AccountCardProps {
  account: Account;
  onRefresh: () => void;
  onImport: (accountId: string) => void;
}

export function AccountCard({ account, onRefresh, onImport }: AccountCardProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [rateLimits, setRateLimits] = useState<RateLimits | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(false);

  const loadRateLimits = async () => {
    setLimitsLoading(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}/limits`);
      if (res.ok) {
        const data = await res.json();
        setRateLimits(data);
      }
    } catch (err) {
      console.error('Failed to load rate limits:', err);
    } finally {
      setLimitsLoading(false);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}/verify`, {
        method: 'POST',
      });
      
      if (res.ok) {
        toast.success(`Session verified for ${account.id}`);
        onRefresh();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Verification failed');
      }
    } catch {
      toast.error('Network error during verification');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete session for ${account.id}?`)) return;
    
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}/session`, {
        method: 'DELETE',
      });
      
      if (res.ok) {
        toast.success(`Session deleted for ${account.id}`);
        onRefresh();
      } else {
        toast.error('Failed to delete session');
      }
    } catch {
      toast.error('Network error during deletion');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="rounded-xl border p-4 space-y-4"
      style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
            {account.id}
          </h3>
          <SessionStatus
            isActive={account.isActive}
            hasSession={!!account.lastSeen}
            lastSeen={account.lastSeen}
          />
        </div>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', color: 'white' }}
        >
          {account.id.substring(0, 2).toUpperCase()}
        </div>
      </div>

      {/* Rate Limits */}
      {!rateLimits && !limitsLoading && (
        <button
          onClick={loadRateLimits}
          className="text-sm px-3 py-1.5 rounded-lg border transition-all"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          Load Rate Limits
        </button>
      )}
      
      {limitsLoading && (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          Loading limits...
        </div>
      )}

      {rateLimits && (
        <div className="space-y-3">
          {rateLimits.messagesSent && (
            <RateLimitBar
              label="Messages Sent"
              current={rateLimits.messagesSent.current}
              limit={rateLimits.messagesSent.limit}
              resetsAt={rateLimits.messagesSent.resetsAt}
            />
          )}
          {rateLimits.connectRequests && (
            <RateLimitBar
              label="Connection Requests"
              current={rateLimits.connectRequests.current}
              limit={rateLimits.connectRequests.limit}
              resetsAt={rateLimits.connectRequests.resetsAt}
            />
          )}
          {rateLimits.searchQueries && (
            <RateLimitBar
              label="Search Queries"
              current={rateLimits.searchQueries.current}
              limit={rateLimits.searchQueries.limit}
              resetsAt={rateLimits.searchQueries.resetsAt}
            />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => onImport(account.id)}
          className="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          Import Cookies
        </button>
        <button
          onClick={handleVerify}
          disabled={isVerifying}
          className="px-3 py-2 rounded-lg border text-sm font-medium transition-all disabled:opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          {isVerifying ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
        </button>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="px-3 py-2 rounded-lg border text-sm font-medium transition-all disabled:opacity-50"
          style={{ borderColor: '#ef4444', color: '#ef4444' }}
        >
          {isDeleting ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Trash2 size={16} />
          )}
        </button>
      </div>
    </div>
  );
}
