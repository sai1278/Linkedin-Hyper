// FILE: app/(dashboard)/accounts/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { AccountCard } from '@/components/accounts/AccountCard';
import { AddAccountModal } from '@/components/accounts/AddAccountModal';
import { Plus, Loader2 } from 'lucide-react';
import type { Account } from '@/types/dashboard';

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      setIsLoading(false);
    }
  };

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

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            LinkedIn Accounts
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Manage your LinkedIn account sessions and view rate limits
          </p>
        </div>
        <button
          onClick={() => handleOpenAddModal()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all hover:opacity-90"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <Plus size={18} />
          Add Account
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" style={{ color: 'var(--accent)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Loading accounts...
            </p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && accounts.length === 0 && (
        <div
          className="text-center py-16 rounded-xl border"
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: 'var(--bg-elevated)' }}
          >
            <Plus size={32} style={{ color: 'var(--text-muted)' }} />
          </div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No Accounts Yet
          </h3>
          <p className="text-sm mb-6 max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            Add your first LinkedIn account to get started. You'll need to import session cookies from your browser.
          </p>
          <button
            onClick={() => handleOpenAddModal()}
            className="px-6 py-2 rounded-lg font-medium"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Add Your First Account
          </button>
        </div>
      )}

      {/* Account Grid */}
      {!isLoading && accounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onRefresh={fetchAccounts}
              onImport={handleOpenAddModal}
            />
          ))}
        </div>
      )}

      {/* Add Account Modal */}
      <AddAccountModal
        open={isAddModalOpen}
        onClose={handleCloseAddModal}
        onSuccess={fetchAccounts}
        existingAccounts={accounts.map((a) => a.id)}
      />
    </div>
  );
}
