'use client';

import { useEffect, useState } from 'react';
import { Menu, Leaf, Sun, Moon } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

const THEME_STORAGE_KEY = 'zuti-dashboard-theme';

function getInitialTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'dark';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, loadFromStorage, setOrgRoles, activeOrgId, setActiveOrgId } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [roleCheckLoading, setRoleCheckLoading] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>(getInitialTheme);

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
      try {
        const res = await orgsApi.listSummary();
        const list = res.data as { id: string; role: string }[];

        if (active && list.length === 0) {
          router.replace(user.role === 'MANAGER' ? '/onboarding' : '/join-workspace');
          return;
        }

        const roles: Record<string, string> = {};
        list.forEach((org) => {
          roles[org.id] = org.role;
        });

        setOrgRoles(roles);

        const preferredOrg = activeOrgId
          ? (list.find((org) => org.id === activeOrgId) ?? list[0])
          : list[0];
        if (preferredOrg?.id && preferredOrg.id !== activeOrgId) {
          setActiveOrgId(preferredOrg.id);
        }
        const activeRole = preferredOrg?.role;
        const restrictedForAgent = ['/bots', '/knowledge', '/knowledge-gaps', '/billing-usage'];
        const blockedForAgent =
          activeRole === 'AGENT' &&
          restrictedForAgent.some((route) => pathname === route || pathname.startsWith(`${route}/`));

        if (active && blockedForAgent) {
          router.replace('/dashboard');
          return;
        }
      } catch {
        // If role check fails, keep UX safe by allowing only non-restricted pages via API checks.
      } finally {
        if (active) {
          setRoleCheckLoading(false);
        }
      }
    };

    runRoleCheck();

    return () => {
      active = false;
    };
  }, [activeOrgId, isLoading, user, pathname, router, setActiveOrgId, setOrgRoles]);

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
          {children}
        </main>
      </div>
    </div>
  );
}
