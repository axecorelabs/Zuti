'use client';

import { Suspense, useEffect, useState } from 'react';
import { Menu, Leaf, Sun, Moon } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { SocketProvider } from '@/lib/socket';

const THEME_STORAGE_KEY = 'zuti-dashboard-theme';

function getInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'dark';
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, isLoading, loadFromStorage, setOrgRoles, activeOrgId, setActiveOrgId } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [roleCheckLoading, setRoleCheckLoading] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);
  const [setupBanner, setSetupBanner] = useState<{ show: boolean; count: number }>({ show: false, count: 0 });
  const isGlobalOverviewRoute = pathname === '/global-overview';
  const orgIdFromUrl = searchParams.get('org');

  useEffect(() => {
    const body = document.body;
    body.classList.toggle('dashboard-theme-light', theme === 'light');
    body.classList.toggle('dashboard-theme-dark', theme === 'dark');
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    return () => {
      body.classList.remove('dashboard-theme-light');
      body.classList.remove('dashboard-theme-dark');
    };
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      if (event.newValue === 'light' || event.newValue === 'dark') {
        setTheme(event.newValue);
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

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
        const list = res.data as Array<{
          id: string;
          role: string;
          managerSetupInProgress?: boolean;
          managerSetupActiveCount?: number;
        }>;

        if (active && list.length === 0) {
          setActiveOrgId(null);
          router.replace('/global-overview');
          navigatingAway = true;
          return;
        }

        const roles: Record<string, string> = {};
        list.forEach((org) => {
          roles[org.id] = org.role;
        });

        setOrgRoles(roles);
        const selectedFromUrl = orgIdFromUrl
          ? (list.find((org) => org.id === orgIdFromUrl) ?? null)
          : null;

        if (!isGlobalOverviewRoute && !selectedFromUrl) {
          setActiveOrgId(null);
          router.replace('/global-overview');
          navigatingAway = true;
          return;
        }

        // Prefer the org from URL, otherwise try to find the activeOrgId in the list.
        // Avoid redundant nullish checks: directly attempt to find the org by activeOrgId.
        const preferredOrg = selectedFromUrl ?? (activeOrgId ? list.find((org) => org.id === activeOrgId) ?? null : null);

        if (preferredOrg?.id && preferredOrg.id !== activeOrgId) {
          setActiveOrgId(preferredOrg.id);
        }
        if (isGlobalOverviewRoute && activeOrgId) {
          setActiveOrgId(null);
        }

        const activeRole = preferredOrg?.role;
        const showSetupBanner =
          !isGlobalOverviewRoute
          &&
          user.role === 'MANAGER'
          && Boolean(preferredOrg?.managerSetupInProgress)
          && (preferredOrg?.managerSetupActiveCount ?? 0) > 0;
        setSetupBanner({
          show: showSetupBanner,
          count: preferredOrg?.managerSetupActiveCount ?? 0,
        });
        const restrictedForAgent = ['/bots', '/knowledge', '/knowledge-gaps', '/billing-usage'];
        const blockedForAgent =
          activeRole === 'AGENT' &&
          restrictedForAgent.some((route) => pathname === route || pathname.startsWith(`${route}/`));

        if (active && blockedForAgent && preferredOrg?.id) {
          router.replace(`/dashboard?org=${preferredOrg.id}`);
          return;
        }
      } catch {
        // If role check fails, keep UX safe by allowing only non-restricted pages via API checks.
        setSetupBanner({ show: false, count: 0 });
      } finally {
        // Keep the spinner while navigating — the new route's effect run will clear it.
        if (active && !navigatingAway) {
          setRoleCheckLoading(false);
        }
      }
    };

    runRoleCheck();

    return () => {
      active = false;
    };
  }, [activeOrgId, isGlobalOverviewRoute, isLoading, orgIdFromUrl, user, pathname, router, setActiveOrgId, setOrgRoles]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading || roleCheckLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className={`flex h-screen overflow-hidden ${theme === 'light' ? 'bg-slate-100' : 'bg-black'}`}>
      {sidebarOpen && (
        <div
          className={`fixed inset-0 z-40 md:hidden ${theme === 'light' ? 'bg-slate-900/30' : 'bg-black/60'}`}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={`md:hidden flex items-center justify-between px-4 py-3 border-b shrink-0 ${theme === 'light' ? 'border-slate-200 bg-white' : 'border-zinc-900 bg-zinc-950'}`}>
          <button
            onClick={() => setSidebarOpen(true)}
            className={`p-1.5 rounded-lg transition-colors ${theme === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center shadow-sm">
              <Leaf className="w-3 h-3 text-white" />
            </div>
            <span className={`font-brand font-semibold text-base tracking-tight ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>Zuti</span>
          </div>
          <button
            onClick={toggleTheme}
            className={`w-8 h-8 rounded-lg inline-flex items-center justify-center ${theme === 'light' ? 'text-slate-700 hover:bg-slate-100' : 'text-zinc-300 hover:bg-zinc-800'}`}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
        <main className="flex-1 overflow-y-auto">
          {setupBanner.show ? (
            <div className={`border-b px-4 py-2 text-xs md:px-6 ${theme === 'light' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'}`}>
              You are currently setting up this organization for {setupBanner.count} requester{setupBanner.count === 1 ? '' : 's'}.
            </div>
          ) : null}
          <SocketProvider>{children}</SocketProvider>
        </main>
      </div>
    </div>
  );
}

function DashboardLayoutFallback() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
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
