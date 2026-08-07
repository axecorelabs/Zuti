'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
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
  // The org switcher updates `activeOrgId` synchronously but navigates asynchronously — reading it
  // via a ref (instead of depending on it below) means the role-check effect only ever reconciles
  // against genuine URL navigation, never against its own just-changed value before the URL catches up.
  const activeOrgIdRef = useRef(activeOrgId);
  useEffect(() => {
    activeOrgIdRef.current = activeOrgId;
  }, [activeOrgId]);

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
        // A newer org switch superseded this run (e.g. its `orgIdFromUrl` closure is already stale) —
        // acting on it now would revert `activeOrgId` back to the org this run started for.
        if (!active) return;
        const list = res.data as Array<{ id: string; role: string }>;

        if (list.length === 0) {
          setActiveOrgId(null);
          router.replace('/onboarding');
          navigatingAway = true;
          return;
        }

        const roles: Record<string, string> = {};
        list.forEach((org) => { roles[org.id] = org.role; });
        setOrgRoles(roles);

        const currentOrgId = activeOrgIdRef.current;
        const selectedFromUrl = orgIdFromUrl ? list.find((org) => org.id === orgIdFromUrl) ?? null : null;
        const preferredOrg = selectedFromUrl ?? (currentOrgId ? list.find((org) => org.id === currentOrgId) ?? null : null) ?? list[0];

        if (preferredOrg?.id && preferredOrg.id !== currentOrgId) {
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
    // Deliberately excludes `activeOrgId` — it's read via `activeOrgIdRef` above. Depending on it
    // directly would re-run this effect on every org switch, before the URL has updated to match,
    // and the resulting stale `orgIdFromUrl` would revert the switch back to the previous org.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, orgIdFromUrl, user, router, setActiveOrgId, setOrgRoles]);

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
