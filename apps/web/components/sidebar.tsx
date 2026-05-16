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

export default function Sidebar() {
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
    <aside className="w-60 shrink-0 h-screen bg-zinc-950 border-r border-zinc-900 flex flex-col">
      {/* Brand */}
      <div className="px-5 py-6 border-b border-zinc-900">
        <span className="font-brand font-semibold text-xl tracking-tight text-white">
          Zuti
        </span>
      </div>

      {/* Org switcher */}
      <div className="px-3 py-3 border-b border-zinc-900">
        <button
          onClick={() => setOrgOpen(!orgOpen)}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-zinc-900 transition-colors"
        >
          <div className="w-6 h-6 rounded-md bg-zinc-700 flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-white">
              {activeOrg?.name?.[0]?.toUpperCase() ?? '?'}
            </span>
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
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
                ${isActive
                  ? 'bg-zinc-900 text-white font-normal'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50 font-light'
                }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-zinc-600'}`} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-3 py-4 border-t border-zinc-900">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
            <span className="text-xs text-zinc-300 font-medium">
              {user?.name?.[0]?.toUpperCase() ?? 'U'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-300 font-light truncate">{user?.name}</p>
            <p className="text-xs text-zinc-600 truncate">{user?.email}</p>
          </div>
          <button onClick={handleLogout} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
