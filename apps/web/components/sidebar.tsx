'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  Bot,
  BookOpen,
  Settings,
  LogOut,
  ChevronDown,
  Plus,
  Building2,
  Leaf,
  UserRound,
} from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { orgsApi } from '@/lib/api';

interface Org {
  id: string;
  name: string;
  slug: string;
}

const navItems = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Inbox', href: '/inbox', icon: MessageSquare },
  { label: 'Bots', href: '/bots', icon: Bot },
  { label: 'Knowledge', href: '/knowledge', icon: BookOpen },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar({ isOpen = false, onClose }: { isOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAuthStore();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);

  useEffect(() => {
    orgsApi
      .list()
      .then((res) => {
        const list: Org[] = res.data;
        setOrgs(list);
        if (list.length > 0) setActiveOrg(list[0]);
      })
      .catch(() => {});
  }, []);

  const handleLogout = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <aside className={`fixed inset-y-0 left-0 z-50 md:relative md:inset-auto md:left-auto md:z-auto w-64 md:w-60 shrink-0 h-screen bg-zinc-950 border-r border-zinc-900 flex flex-col transition-transform duration-200 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
      {/* Brand */}
      <div className="px-4 py-5 border-b border-zinc-900">
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-600/30">
            <Leaf className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-brand font-semibold text-lg tracking-tight text-white">Zuti</span>
        </div>
      </div>

      {/* Org switcher */}
      <div className="px-3 py-3 border-b border-zinc-900">
        <button
          onClick={() => setOrgOpen(!orgOpen)}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-zinc-900 transition-colors"
        >
          <div className="w-6 h-6 rounded-md bg-zinc-700 flex items-center justify-center shrink-0">
            <Building2 className="w-3.5 h-3.5 text-zinc-300" />
          </div>
          <span className="text-sm text-zinc-300 font-light truncate flex-1 text-left">
            {activeOrg?.name ?? 'No workspace'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
        </button>

        {orgOpen && orgs.length > 0 && (
          <div className="mt-1 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            {orgs.map((org) => (
              <button
                key={org.id}
                onClick={() => {
                  setActiveOrg(org);
                  setOrgOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors font-light"
              >
                {org.name}
              </button>
            ))}
            <Link
              href="/onboarding"
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-zinc-600 hover:text-zinc-300 border-t border-zinc-800 transition-colors font-light"
            >
              <Plus className="w-3.5 h-3.5" />
              New workspace
            </Link>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all relative ${
                isActive
                  ? 'bg-blue-600/10 text-white font-normal'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/60 font-light'
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-r-full" />
              )}
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-zinc-600'}`} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-zinc-900">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-zinc-900/60 transition-colors group">
          <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
            <UserRound className="w-4 h-4 text-zinc-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-200 font-normal truncate leading-tight">{user?.name || 'Account'}</p>
            <p className="text-[11px] text-zinc-600 truncate leading-tight">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-zinc-700 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
