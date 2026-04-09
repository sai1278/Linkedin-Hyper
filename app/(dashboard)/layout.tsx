// FILE: app/(dashboard)/layout.tsx
'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { LoadingScreen } from '@/components/layout/LoadingScreen';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <LoadingScreen />;
  }
  
  if (!isAuthenticated) {
    redirect('/login');
  }
  
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div
          className="min-h-full"
          style={{
            background:
              'linear-gradient(180deg, rgba(26, 48, 85, 0.25) 0%, rgba(6, 13, 25, 0) 32%)',
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
