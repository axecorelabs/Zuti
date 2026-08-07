'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, Activity, Wallet, LogOut, Leaf, Building2, Wrench, ShieldAlert, BarChart3, ShieldCheck, Bot, Send, Users2, CalendarDays, Star, Mail } from 'lucide-react';
import { clearAuthTokens } from '@/lib/session';
import { authApi } from '@/lib/api';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/bots', label: 'Bots', icon: Bot },
  { href: '/managers', label: 'Managers', icon: ShieldCheck },
  { href: '/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/members', label: 'Operations', icon: Wrench },
  { href: '/system', label: 'System', icon: ShieldAlert },
  { href: '/cashflow', label: 'Cashflow', icon: Wallet },
  { href: '/activity', label: 'Activity', icon: Activity },
];

// Separate section, separate guard on the backend (TixtronOpsGuard, not SuperAdminGuard) — Zuti
// infra access and Tixtron marketplace access are deliberately independent permissions that just
// happen to share this app/login.
const TIXTRON_NAV_ITEMS = [
  { href: '/tixtron/bot', label: 'Bot', icon: Send },
  { href: '/tixtron/community', label: 'Community', icon: Users2 },
  { href: '/tixtron/events', label: 'Events', icon: CalendarDays },
  { href: '/tixtron/organizers', label: 'Organizers', icon: Building2 },
  { href: '/tixtron/featured', label: 'Featured events', icon: Star },
  { href: '/tixtron/subscribers', label: 'Email list', icon: Mail },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    authApi.logout().catch(() => {});
    clearAuthTokens();
    router.push('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-black">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 md:flex">
        <div className="flex h-20 items-center border-b border-zinc-900 px-5">
          <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-600/30">
              <Leaf className="w-4.5 h-4.5 text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-brand font-semibold text-[17px] tracking-tight text-white">Zuti</span>
              <span className="text-xs text-zinc-500 font-light">Admin</span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}

          <p className="px-3 pt-5 pb-1.5 text-[10.5px] font-semibold text-zinc-600 tracking-[0.12em]">TIXTRON</p>
          {TIXTRON_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-orange-950/60 text-orange-400'
                    : 'text-zinc-400 hover:text-orange-400 hover:bg-zinc-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-zinc-900 p-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-900 bg-zinc-950 px-4 py-3 md:hidden">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/30">
              <Leaf className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-brand font-semibold text-sm tracking-tight text-white">Zuti Admin</span>
          </Link>
          <button
            onClick={handleLogout}
            className="text-zinc-400 hover:text-white transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
