'use client';

import { Suspense, useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { SocketProvider } from '@/lib/socket';

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading, loadFromStorage, setOrgRoles, activeOrgId, setActiveOrgId } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [roleCheckLoading, setRoleCheckLoading] = useState(true);
  const orgIdFromUrl = searchParams.get('org');

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (isLoading || !user) return;

    let active = true;

    const runRoleCheck = async () => {
      let navigatingAway = false;
      try {
        const res = await orgsApi.listSummary();
        const list = res.data as Array<{ id: string; role: string }>;

        if (active && list.length === 0) {
          setActiveOrgId(null);
          router.replace('/onboarding');
          navigatingAway = true;
          return;
        }

        const roles: Record<string, string> = {};
        list.forEach((org) => { roles[org.id] = org.role; });
        setOrgRoles(roles);

        const selectedFromUrl = orgIdFromUrl ? list.find((org) => org.id === orgIdFromUrl) ?? null : null;
        const preferredOrg = selectedFromUrl ?? (activeOrgId ? list.find((org) => org.id === activeOrgId) ?? null : null) ?? list[0];

        if (preferredOrg?.id && preferredOrg.id !== activeOrgId) {
          setActiveOrgId(preferredOrg.id);
        }
      } catch {
        // Keep UX safe — the backend's own guards are the real enforcement.
      } finally {
        if (active && !navigatingAway) {
          setRoleCheckLoading(false);
        }
      }
    };

    runRoleCheck();

    return () => {
      active = false;
    };
  }, [activeOrgId, isLoading, orgIdFromUrl, user, router, setActiveOrgId, setOrgRoles]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading || roleCheckLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-200 dark:border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden bg-black/60" onClick={() => setSidebarOpen(false)} />
      )}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-brand font-semibold text-base tracking-tight text-zinc-900 dark:text-white">TIXTRON</span>
          <div className="w-8" />
        </div>
        <main className="flex-1 overflow-y-auto">
          <SocketProvider>{children}</SocketProvider>
        </main>
      </div>
    </div>
  );
}

function DashboardLayoutFallback() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-zinc-200 dark:border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<DashboardLayoutFallback />}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
}
