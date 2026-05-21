'use client';

import { useEffect, useState } from 'react';
import { Menu, Leaf } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, loadFromStorage, setOrgRoles } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [roleCheckLoading, setRoleCheckLoading] = useState(true);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (isLoading || !user) return;

    let active = true;

    const runRoleCheck = async () => {
      try {
        const res = await orgsApi.list();
        const list = res.data as { id: string; members?: { role: string }[] }[];

        if (active && list.length === 0) {
          router.replace('/onboarding');
          return;
        }

        const roles: Record<string, string> = {};
        list.forEach((org) => {
          if (org.members?.[0]?.role) {
            roles[org.id] = org.members[0].role;
          }
        });

        setOrgRoles(roles);

        const firstRole = list[0]?.members?.[0]?.role;
        const restrictedForAgent = ['/bots', '/knowledge', '/knowledge-gaps', '/billing-usage'];
        const blockedForAgent =
          firstRole === 'AGENT' &&
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
  }, [isLoading, user, pathname, router, setOrgRoles]);

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
    <div className="flex h-screen overflow-hidden bg-black">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-zinc-900 bg-zinc-950 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center shadow-sm">
              <Leaf className="w-3 h-3 text-white" />
            </div>
            <span className="font-brand font-semibold text-base tracking-tight text-white">Zuti</span>
          </div>
          <div className="w-8" />
        </div>
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
