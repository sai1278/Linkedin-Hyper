'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection, Account } from '@/types/dashboard';
import { getAccounts, getUnifiedConnections } from '@/lib/api-client';
import { getAccountLabel } from '@/lib/account-label';
import { ConnectionGrid } from '@/components/connections/ConnectionGrid';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { DASHBOARD_ROUTE_META } from '@/lib/dashboard-route-meta';
import { readSessionCache, writeSessionCache } from '@/lib/session-cache';

type ConnectionSort = 'recent' | 'name' | 'account' | 'important';
type ConnectionAnnotation = { important: boolean; note: string };
type ConnectionAnnotations = Record<string, ConnectionAnnotation>;

type DecoratedConnection = Connection & {
  rowKey: string;
  accountLabel: string;
  important: boolean;
  note: string;
};

const NOTES_STORAGE_KEY = 'linkedin-hyper:connection-annotations:v1';
const CONNECTIONS_PAGE_CACHE_KEY = 'linkedin-hyper:connections-page:v1';

interface ConnectionsPageCachePayload {
  accounts: Account[];
  connections: Connection[];
}

function getConnectionKey(connection: Pick<Connection, 'accountId' | 'profileUrl' | 'name'>): string {
  return `${connection.accountId}::${connection.profileUrl || connection.name}`;
}

function getDefaultAnnotation(): ConnectionAnnotation {
  return { important: false, note: '' };
}

export default function ConnectionsPage() {
  const routeMeta = DASHBOARD_ROUTE_META.connections;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [annotations, setAnnotations] = useState<ConnectionAnnotations>({});
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [sort, setSort] = useState<ConnectionSort>('recent');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<ConnectionsPageCachePayload | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(NOTES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ConnectionAnnotations;
      setAnnotations(parsed || {});
    } catch {
      // Ignore invalid local data and continue with an empty store.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(annotations));
  }, [annotations]);

  const load = useCallback(async (options?: { refresh?: boolean; background?: boolean }) => {
    const refresh = options?.refresh ?? false;
    const background = options?.background ?? false;
    try {
      if (refresh) {
        setSyncing(true);
      }

      if (!refresh && !background) {
        setLoading(true);
      }

      const [{ accounts: nextAccounts }, { connections: unifiedConnections }] = await Promise.all([
        getAccounts(),
        getUnifiedConnections(500, refresh),
      ]);

      setAccounts(nextAccounts);
      setConnections(unifiedConnections);
      setError(null);
      const cachePayload = {
        accounts: nextAccounts,
        connections: unifiedConnections,
      } satisfies ConnectionsPageCachePayload;
      cacheRef.current = cachePayload;
      writeSessionCache(CONNECTIONS_PAGE_CACHE_KEY, cachePayload);
    } catch (nextError) {
      const errorMessage = nextError instanceof Error ? nextError.message : 'Failed to load network';
      if (cacheRef.current) {
        setAccounts(cacheRef.current.accounts);
        setConnections(cacheRef.current.connections);
        setError(null);
      } else {
        setError(errorMessage);
      }
    } finally {
      if (!refresh) {
        setLoading(false);
      }
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const cached = readSessionCache<ConnectionsPageCachePayload>(CONNECTIONS_PAGE_CACHE_KEY);
    if (cached) {
      cacheRef.current = cached;
      setAccounts(cached.accounts);
      setConnections(cached.connections);
      setLoading(false);
      void load({ background: true });
      return;
    }

    void load();
  }, [load]);

  const accountLabelById = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, getAccountLabel(account)])),
    [accounts]
  );

  const decoratedConnections = useMemo<DecoratedConnection[]>(() => {
    return connections.map((connection) => {
      const rowKey = getConnectionKey(connection);
      const annotation = annotations[rowKey] ?? getDefaultAnnotation();
      return {
        ...connection,
        rowKey,
        accountLabel: accountLabelById[connection.accountId] ?? connection.accountId,
        important: annotation.important,
        note: annotation.note,
      };
    });
  }, [accountLabelById, annotations, connections]);

  const filteredConnections = useMemo(() => {
    const normalizedSearch = debouncedSearch.trim().toLowerCase();

    const filtered = decoratedConnections.filter((connection) => {
      const matchesFilter = filter === 'all' || connection.accountId === filter;
      if (!matchesFilter) return false;

      if (!normalizedSearch) return true;

      return [
        connection.name,
        connection.accountLabel,
        connection.profileUrl,
        connection.headline || '',
        connection.note,
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch);
    });

    return [...filtered].sort((left, right) => {
      if (sort === 'important') {
        const importantDiff = Number(right.important) - Number(left.important);
        if (importantDiff !== 0) return importantDiff;
      }

      if (sort === 'name') {
        return left.name.localeCompare(right.name);
      }

      if (sort === 'account') {
        const labelDiff = left.accountLabel.localeCompare(right.accountLabel);
        if (labelDiff !== 0) return labelDiff;
      }

      const timeDiff = (Number(right.connectedAt) || 0) - (Number(left.connectedAt) || 0);
      if (timeDiff !== 0) return timeDiff;

      return left.name.localeCompare(right.name);
    });
  }, [debouncedSearch, decoratedConnections, filter, sort]);

  const liveCount = useMemo(
    () => decoratedConnections.filter((connection) => connection.source === 'linkedin').length,
    [decoratedConnections]
  );
  const activityCount = useMemo(
    () => decoratedConnections.filter((connection) => connection.source === 'connectionSent').length,
    [decoratedConnections]
  );

  const handleToggleImportant = useCallback((rowKey: string) => {
    setAnnotations((current) => {
      const existing = current[rowKey] ?? getDefaultAnnotation();
      return {
        ...current,
        [rowKey]: {
          ...existing,
          important: !existing.important,
        },
      };
    });
  }, []);

  const handleNoteChange = useCallback((rowKey: string, note: string) => {
    setAnnotations((current) => {
      const existing = current[rowKey] ?? getDefaultAnnotation();
      return {
        ...current,
        [rowKey]: {
          ...existing,
          note,
        },
      };
    });
  }, []);

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => void load()} />;
  }

  return (
    <div className="h-full" style={{ background: 'var(--bg-base)' }}>
      <ConnectionGrid
        connections={filteredConnections}
        accounts={accounts}
        accountLabels={accountLabelById}
        total={decoratedConnections.length}
        liveCount={liveCount}
        activityCount={activityCount}
        search={search}
        filter={filter}
        sort={sort}
        syncing={syncing}
        title={routeMeta.pageTitle}
        subtitle="Last synced LinkedIn network plus recent tool activity across your managed accounts"
        onSearchChange={setSearch}
        onFilterChange={setFilter}
        onSortChange={setSort}
        onSync={() => void load({ refresh: true })}
        onToggleImportant={handleToggleImportant}
        onNoteChange={handleNoteChange}
      />
    </div>
  );
}
