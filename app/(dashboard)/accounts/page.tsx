'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountCard } from '@/components/accounts/AccountCard';
import { AddAccountModal } from '@/components/accounts/AddAccountModal';
import { ArrowUpDown, Info, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Account, ActivityEntry } from '@/types/dashboard';
import {
  deleteAccountSession,
  getAccountActivity,
  getAccountLimits,
  getAccounts,
  getAccountSessionStatus,
  syncAllMessages,
  verifyAccountSession,
  type AccountRateLimits,
  type AccountSessionStatus,
} from '@/lib/api-client';
import { ExportButton } from '@/components/ui/ExportButton';
import { DASHBOARD_ROUTE_META } from '@/lib/dashboard-route-meta';
import { deriveAccountHealth, type AccountHealthKey, type DerivedAccountHealth } from '@/lib/account-health';
import { getAccountLabel } from '@/lib/account-label';
import { ErrorState } from '@/components/ui/ErrorState';
import { readSessionCache, writeSessionCache } from '@/lib/session-cache';

type AccountSort = 'name' | 'health' | 'lastSynced' | 'messagesSent';

interface AccountDetails {
  sessionStatus: AccountSessionStatus | null;
  rateLimits: AccountRateLimits | null;
  lastSyncedAt: number | null;
  recentEntries: ActivityEntry[];
  messagesSent: number;
  health: DerivedAccountHealth;
}

interface AccountViewModel {
  account: Account;
  label: string;
  details: AccountDetails;
}

interface AccountsPageCachePayload {
  accounts: Account[];
  accountDetails: Record<string, AccountDetails>;
}

const HEALTH_ORDER: Record<AccountHealthKey, number> = {
  degraded: 0,
  expired: 1,
  expiringSoon: 2,
  healthy: 3,
};
const ACCOUNTS_PAGE_CACHE_KEY = 'linkedin-hyper:accounts-page:v1';

function getFallbackAccountDetails(account: Account): AccountDetails {
  const health = deriveAccountHealth({ hasSession: Boolean(account.lastSeen) });
  return {
    sessionStatus: account.lastSeen ? { exists: true, savedAt: new Date(account.lastSeen).getTime() } : { exists: false },
    rateLimits: null,
    lastSyncedAt: null,
    recentEntries: [],
    messagesSent: 0,
    health,
  };
}

export default function AccountsPage() {
  const routeMeta = DASHBOARD_ROUTE_META.accounts;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountDetails, setAccountDetails] = useState<Record<string, AccountDetails>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | AccountHealthKey>('all');
  const [sortBy, setSortBy] = useState<AccountSort>('health');
  const [showRefreshGuide, setShowRefreshGuide] = useState(false);
  const [isBulkVerifying, setIsBulkVerifying] = useState(false);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [verifyingIds, setVerifyingIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<AccountsPageCachePayload | null>(null);

  const fetchAccounts = useCallback(async (options?: { background?: boolean }) => {
    const background = options?.background ?? false;
    if (!background) {
      setIsLoading(true);
    }

    try {
      const { accounts: nextAccounts } = await getAccounts();
      setAccounts(nextAccounts || []);
      setError(null);

      const detailsEntries = await Promise.all(
        (nextAccounts || []).map(async (account) => {
          const [sessionResult, limitsResult, activityResult] = await Promise.allSettled([
            getAccountSessionStatus(account.id),
            getAccountLimits(account.id),
            getAccountActivity(account.id, 0, 50),
          ]);

          const sessionStatus = sessionResult.status === 'fulfilled'
            ? sessionResult.value
            : (account.lastSeen ? { exists: true, savedAt: new Date(account.lastSeen).getTime() } : { exists: false });

          const rateLimits = limitsResult.status === 'fulfilled' ? limitsResult.value : null;
          const recentEntries = activityResult.status === 'fulfilled' ? activityResult.value.entries : [];
          const lastSyncedAt = recentEntries.reduce<number | null>((latest, entry) => {
            const timestamp = Number(entry.timestamp) || 0;
            if (!timestamp) return latest;
            return latest === null || timestamp > latest ? timestamp : latest;
          }, null);
          const recentMessageCount = recentEntries.filter((entry) => entry.type === 'messageSent').length;
          const messagesSent = rateLimits?.messagesSent?.current ?? recentMessageCount;
          const health = deriveAccountHealth({
            hasSession: Boolean(sessionStatus?.exists),
            sessionAgeSeconds: sessionStatus?.ageSeconds,
            lastSyncedAt,
          });

          return [
            account.id,
            {
              sessionStatus,
              rateLimits,
              lastSyncedAt,
              recentEntries,
              messagesSent,
              health,
            } satisfies AccountDetails,
          ] as const;
        })
      );

      const nextAccountDetails = Object.fromEntries(detailsEntries);
      const cachePayload = {
        accounts: nextAccounts || [],
        accountDetails: nextAccountDetails,
      } satisfies AccountsPageCachePayload;

      cacheRef.current = cachePayload;
      writeSessionCache(ACCOUNTS_PAGE_CACHE_KEY, cachePayload);
      setAccountDetails(nextAccountDetails);
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load account health data';
      if (cacheRef.current) {
        setAccounts(cacheRef.current.accounts);
        setAccountDetails(cacheRef.current.accountDetails);
        setError(null);
      } else {
        setError(errorMessage);
        toast.error(errorMessage);
      }
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const cached = readSessionCache<AccountsPageCachePayload>(ACCOUNTS_PAGE_CACHE_KEY);
    if (cached) {
      cacheRef.current = cached;
      setAccounts(cached.accounts);
      setAccountDetails(cached.accountDetails);
      setIsLoading(false);
      void fetchAccounts({ background: true });
      return;
    }

    void fetchAccounts();
  }, [fetchAccounts]);

  const accountViewModels = useMemo<AccountViewModel[]>(() => {
    return accounts.map((account) => ({
      account,
      label: getAccountLabel(account),
      details: accountDetails[account.id] ?? getFallbackAccountDetails(account),
    }));
  }, [accountDetails, accounts]);

  const filteredAccounts = useMemo(() => {
    const filtered = accountViewModels.filter((viewModel) => (
      statusFilter === 'all' ? true : viewModel.details.health.key === statusFilter
    ));

    return [...filtered].sort((left, right) => {
      if (sortBy === 'health') {
        const healthDiff = HEALTH_ORDER[left.details.health.key] - HEALTH_ORDER[right.details.health.key];
        if (healthDiff !== 0) return healthDiff;
      }

      if (sortBy === 'name') {
        return left.label.localeCompare(right.label);
      }

      if (sortBy === 'messagesSent') {
        const messageDiff = right.details.messagesSent - left.details.messagesSent;
        if (messageDiff !== 0) return messageDiff;
      }

      if (sortBy === 'lastSynced') {
        const syncDiff = (Number(right.details.lastSyncedAt) || 0) - (Number(left.details.lastSyncedAt) || 0);
        if (syncDiff !== 0) return syncDiff;
      }

      return left.label.localeCompare(right.label);
    });
  }, [accountViewModels, sortBy, statusFilter]);

  const healthCounts = useMemo(() => {
    return accountViewModels.reduce<Record<AccountHealthKey, number>>((counts, viewModel) => {
      counts[viewModel.details.health.key] += 1;
      return counts;
    }, {
      healthy: 0,
      expiringSoon: 0,
      degraded: 0,
      expired: 0,
    });
  }, [accountViewModels]);

  const handleOpenAddModal = (accountId?: string) => {
    if (accountId) {
      setSelectedAccountId(accountId);
    }
    setIsAddModalOpen(true);
  };

  const handleCloseAddModal = () => {
    setIsAddModalOpen(false);
    setSelectedAccountId(null);
  };

  const handleVerifyAccount = useCallback(async (accountId: string) => {
    setVerifyingIds((current) => [...current, accountId]);
    try {
      await verifyAccountSession(accountId);
      toast.success(`Session verified for ${accountId}`);
      await fetchAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Verification failed for ${accountId}`);
    } finally {
      setVerifyingIds((current) => current.filter((id) => id !== accountId));
    }
  }, [fetchAccounts]);

  const handleDeleteAccount = useCallback(async (accountId: string) => {
    if (!confirm(`Delete session for ${accountId}?`)) return;

    setDeletingIds((current) => [...current, accountId]);
    try {
      await deleteAccountSession(accountId);
      toast.success(`Session deleted for ${accountId}`);
      await fetchAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete session');
    } finally {
      setDeletingIds((current) => current.filter((id) => id !== accountId));
    }
  }, [fetchAccounts]);

  const handleVerifyAll = useCallback(async () => {
    const candidates = accountViewModels.filter((viewModel) => viewModel.details.sessionStatus?.exists);
    if (candidates.length === 0) {
      toast.error('No saved sessions found to verify');
      return;
    }

    setIsBulkVerifying(true);
    let successCount = 0;
    let failureCount = 0;

    for (const viewModel of candidates) {
      try {
        await verifyAccountSession(viewModel.account.id);
        successCount += 1;
      } catch {
        failureCount += 1;
      }
    }

    await fetchAccounts();
    setIsBulkVerifying(false);

    if (failureCount === 0) {
      toast.success(`Verified ${successCount} account${successCount === 1 ? '' : 's'}`);
      return;
    }

    toast.error(`Verified ${successCount}; ${failureCount} need cookie refresh`);
  }, [accountViewModels, fetchAccounts]);

  const handleSyncAll = useCallback(async () => {
    setIsBulkSyncing(true);
    try {
      const result = await syncAllMessages();
      toast.success(result.message || 'Sync started for all accounts');
      setTimeout(() => {
        void fetchAccounts();
      }, 1500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start sync');
    } finally {
      setIsBulkSyncing(false);
    }
  }, [fetchAccounts]);

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {routeMeta.pageTitle}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Session health, sync recency, and guided cookie refresh for your managed LinkedIn accounts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ExportButton type="activity" label="Export Data" size="sm" />
          <button
            onClick={() => setShowRefreshGuide((current) => !current)}
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Info size={16} />
            Cookie Refresh Guide
          </button>
          <button
            onClick={() => void handleSyncAll()}
            disabled={isBulkSyncing}
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {isBulkSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Sync All Accounts
          </button>
          <button
            onClick={() => void handleVerifyAll()}
            disabled={isBulkVerifying}
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {isBulkVerifying ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            Verify All Sessions
          </button>
          <button
            onClick={() => handleOpenAddModal()}
            className="flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-all hover:opacity-90"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <Plus size={18} />
            Add Account
          </button>
        </div>
      </div>

      {showRefreshGuide && (
        <div
          className="mb-6 rounded-2xl border p-5"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-start gap-3">
            <Info size={18} style={{ color: 'var(--accent)', marginTop: 2 }} />
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                Guided cookie refresh
              </h2>
              <ol className="mt-3 space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li>1. Click <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Refresh Cookies</span> on the account card that needs attention.</li>
                <li>2. Paste or upload the latest LinkedIn cookie JSON in the modal.</li>
                <li>3. The modal imports and verifies the session automatically.</li>
                <li>4. If a card shows <span style={{ color: '#d97706', fontWeight: 600 }}>Expiring Soon</span> or <span style={{ color: '#ea580c', fontWeight: 600 }}>Degraded</span>, refresh before inbox or send operations drift.</li>
              </ol>
              <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                Normal refresh flow is now guided in the dashboard; command-line scripts are no longer the only visible path.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4" style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap gap-2">
          {([
            ['all', `All (${accountViewModels.length})`],
            ['healthy', `Healthy (${healthCounts.healthy})`],
            ['expiringSoon', `Expiring Soon (${healthCounts.expiringSoon})`],
            ['degraded', `Degraded (${healthCounts.degraded})`],
            ['expired', `Expired (${healthCounts.expired})`],
          ] as const).map(([value, label]) => {
            const isActive = statusFilter === value;
            return (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className="rounded-full px-3 py-1.5 text-sm font-medium transition-all"
                style={{
                  background: isActive ? 'var(--accent)' : 'var(--bg-elevated)',
                  color: isActive ? '#ffffff' : 'var(--text-secondary)',
                  border: '1px solid',
                  borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <ArrowUpDown size={16} />
            Sort by
          </div>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as AccountSort)}
            className="rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="health">Health</option>
            <option value="lastSynced">Last synced</option>
            <option value="messagesSent">Messages sent</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 size={32} className="mx-auto mb-2 animate-spin" style={{ color: 'var(--accent)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading account health...
            </p>
          </div>
        </div>
      )}

      {!isLoading && error && (
        <ErrorState message={error} onRetry={() => void fetchAccounts()} />
      )}

      {!isLoading && !error && accountViewModels.length === 0 && (
        <div
          className="rounded-xl border py-16 text-center"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <Plus size={32} style={{ color: 'var(--text-muted)' }} />
          </div>
          <h3 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            No Accounts Yet
          </h3>
          <p className="mx-auto mb-6 max-w-md text-sm" style={{ color: 'var(--text-muted)' }}>
            Add your first LinkedIn account to start tracking session health, sync recency, and guided cookie refresh.
          </p>
          <button
            onClick={() => handleOpenAddModal()}
            className="rounded-lg px-6 py-2 font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Add Your First Account
          </button>
        </div>
      )}

      {!isLoading && !error && accountViewModels.length > 0 && filteredAccounts.length === 0 && (
        <div
          className="rounded-xl border py-12 text-center"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            No accounts match this health filter
          </p>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Try a different status filter or sort order.
          </p>
        </div>
      )}

      {!isLoading && !error && filteredAccounts.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredAccounts.map((viewModel) => (
            <AccountCard
              key={viewModel.account.id}
              account={viewModel.account}
              label={viewModel.label}
              health={viewModel.details.health}
              sessionStatus={viewModel.details.sessionStatus}
              rateLimits={viewModel.details.rateLimits}
              messagesSent={viewModel.details.messagesSent}
              lastSyncedAt={viewModel.details.lastSyncedAt}
              isVerifying={verifyingIds.includes(viewModel.account.id)}
              isDeleting={deletingIds.includes(viewModel.account.id)}
              onVerify={handleVerifyAccount}
              onDelete={handleDeleteAccount}
              onImport={handleOpenAddModal}
            />
          ))}
        </div>
      )}

      <AddAccountModal
        open={isAddModalOpen}
        onClose={handleCloseAddModal}
        onSuccess={fetchAccounts}
        existingAccounts={accounts.map((account) => account.id)}
        initialAccountId={selectedAccountId}
      />
    </div>
  );
}
