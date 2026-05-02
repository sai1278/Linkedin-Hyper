// FILE: app/(dashboard)/layout.tsx
'use client';

import { useAuth } from '@/components/providers/AuthProvider';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { LoadingScreen } from '@/components/layout/LoadingScreen';
import { DashboardTopbar } from '@/components/layout/DashboardTopbar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <LoadingScreen />;
  }
  
  if (!isAuthenticated) {
    redirect('/login');
  }
  
  return (
    <div className="flex h-screen overflow-hidden max-[900px]:flex-col">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <DashboardTopbar />
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
