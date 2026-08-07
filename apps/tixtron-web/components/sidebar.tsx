'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, CalendarDays, CreditCard, Users, Settings, LogOut, ChevronDown, X, Check, Plus,
  Send, Megaphone, Contact, Wallet,
} from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { orgsApi, billingApi, authApi } from '@/lib/api';
import { ThemeToggle } from './ThemeToggle';
import { useTheme } from '@/lib/theme';

interface Org { id: string; name: string; slug: string }

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/events', label: 'Events', icon: CalendarDays },
      { href: '/customers', label: 'Customers', icon: Contact },
      { href: '/bot', label: 'Bot', icon: Send },
      { href: '/marketing', label: 'Marketing', icon: Megaphone },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/payouts', label: 'Payouts', icon: CreditCard },
      { href: '/billing', label: 'Billing', icon: Wallet },
      { href: '/team', label: 'Team', icon: Users },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function orgInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme } = useTheme();
  const { user, activeOrgId, setActiveOrgId, clearAuth } = useAuthStore();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  useEffect(() => {
    orgsApi.list().then((res) => setOrgs(res.data as Org[])).catch(() => setOrgs([]));
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId) return;
    billingApi.wallet(activeOrgId)
      .then((res) => setCreditBalance(res.data?.creditBalance ?? null))
      .catch(() => setCreditBalance(null));
  }, [activeOrgId]);

  const activeOrg = orgs.find((o) => o.id === activeOrgId);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' || pathname.startsWith('/dashboard/') : pathname.startsWith(href);

  const switchOrg = (orgId: string) => {
    setActiveOrgId(orgId);
    setOrgMenuOpen(false);
    router.push(`/dashboard?org=${orgId}`);
  };

  const createNewOrg = () => {
    setOrgMenuOpen(false);
    router.push('/onboarding');
  };

  const handleLogout = () => {
    authApi.logout().catch(() => {});
    clearAuth();
    router.push('/login');
  };

  return (
    <aside className={`fixed md:static inset-y-0 left-0 z-50 w-64 shrink-0 bg-zinc-50 dark:bg-[#121417] border-r border-zinc-200/60 dark:border-zinc-800/60 flex flex-col transition-transform md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center justify-between px-4 pt-5 pb-4 mb-1 border-b border-zinc-200/40 dark:border-zinc-800/40">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={theme === 'light' ? '/icon-light-192x192.png' : '/icon-192x192.png'} alt="" width={26} height={26} className="rounded-[7px]" />
          <span className="font-brand font-semibold text-[15px] tracking-wide text-zinc-900 dark:text-white">TIXTRON</span>
        </div>
        <button onClick={onClose} className="md:hidden p-1 text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Org switcher */}
      <div className="px-3.5 mb-1 relative">
        <button
          onClick={() => setOrgMenuOpen((v) => !v)}
          className="w-full flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900/60 px-2.5 py-2 text-left hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
        >
          <span className="w-[22px] h-[22px] rounded-md bg-gradient-to-br from-brand-600 to-brand-800 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {orgInitials(activeOrg?.name ?? '?')}
          </span>
          <span className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200 truncate flex-1">{activeOrg?.name ?? 'Select organizer'}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-500 shrink-0" />
        </button>
        {orgMenuOpen && (
          <div className="absolute left-3.5 right-3.5 mt-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 shadow-xl z-10 py-1 max-h-64 overflow-y-auto">
            {orgs.map((org) => (
              <button
                key={org.id}
                onClick={() => switchOrg(org.id)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
              >
                <span className="truncate">{org.name}</span>
                {org.id === activeOrgId && <Check className="w-3.5 h-3.5 text-brand-400 shrink-0" />}
              </button>
            ))}
            <div className="border-t border-zinc-200 dark:border-zinc-800 mt-1 pt-1">
              <button
                onClick={createNewOrg}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New organizer account
              </button>
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3.5 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-1">
            <p className="px-2.5 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-600">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={activeOrgId ? `${href}?org=${activeOrgId}` : href}
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    isActive(href) ? 'bg-brand-600/[0.14] text-brand-400' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900'
                  }`}
                >
                  <Icon className="w-[17px] h-[17px]" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3.5 pb-3.5 pt-2 border-t border-zinc-200/40 dark:border-zinc-800/40 space-y-2.5">
        <div className="flex items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900/60 px-3 py-2.5">
          <div>
            <p className="text-[13px] font-semibold text-zinc-900 dark:text-white tabular-nums">
              {creditBalance === null ? '—' : creditBalance.toLocaleString()}
              <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-500"> credits</span>
            </p>
            <p className="text-[10.5px] text-zinc-500 dark:text-zinc-500">Wallet balance</p>
          </div>
          <Link
            href={activeOrgId ? `/billing?org=${activeOrgId}` : '/billing'}
            onClick={onClose}
            className="text-[10.5px] font-semibold text-brand-400 bg-brand-600/[0.14] px-2 py-1 rounded-full hover:bg-brand-600/25 transition-colors"
          >
            Top up
          </Link>
        </div>

        <div className="flex items-center gap-2 px-1.5">
          <span className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 shrink-0">
            {(user?.email ?? '?').charAt(0).toUpperCase()}
          </span>
          <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate flex-1">{user?.email}</span>
          <ThemeToggle />
          <button onClick={handleLogout} aria-label="Log out" className="text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white shrink-0">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
