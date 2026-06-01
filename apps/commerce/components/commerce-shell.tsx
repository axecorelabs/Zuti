'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Store, Boxes, ShoppingCart, LayoutDashboard, LogOut, Leaf,
  Settings, Bell, X, CheckCircle, XCircle, Wifi, WifiOff, CreditCard,
} from 'lucide-react';
import { clearAuthTokens } from '@/lib/session';
import { notificationsApi, orgApi, resolveOrgId } from '@/lib/api';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/stores', label: 'Stores', icon: Store },
  { href: '/catalog', label: 'Catalog', icon: Boxes },
  { href: '/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface AppNotif {
  id: string;
  serverId?: string;
  type: string;
  title: string;
  body: string;
  isRead?: boolean;
}

export default function CommerceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<AppNotif[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifView, setNotifView] = useState<'unread' | 'all'>('unread');
  const [apiStatus, setApiStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');

  // Resolve orgId once on mount
  useEffect(() => {
    orgApi.listSummary().then((res) => {
      const id = resolveOrgId(res.data);
      setOrgId(id);
    }).catch(() => {});
  }, []);

  // Check API status
  useEffect(() => {
    orgApi.listSummary()
      .then(() => setApiStatus('connected'))
      .catch(() => setApiStatus('disconnected'));
  }, []);

  const fetchNotifications = useCallback(() => {
    if (!orgId) return;
    notificationsApi.list(orgId, notifView === 'all').then((res) => {
      interface ServerNotif { id: string; type: string; title: string; body: string; isRead: boolean; }
      const list: AppNotif[] = (res.data as ServerNotif[]).map((n) => ({
        id: `server-${n.id}`,
        serverId: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        isRead: n.isRead,
      }));
      setNotifications(list);
    }).catch(() => {});
  }, [orgId, notifView]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    if (notifOpen) fetchNotifications();
  }, [notifOpen, fetchNotifications]);

  const handleMarkAllRead = async () => {
    if (!orgId) return;
    await notificationsApi.markAllRead(orgId).catch(() => {});
    if (notifView === 'all') {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } else {
      setNotifications((prev) => prev.filter((n) => !n.serverId));
    }
  };

  const handleDismiss = async (notif: AppNotif) => {
    if (!orgId || !notif.serverId) return;
    if (notifView === 'all') {
      setNotifications((prev) => prev.map((n) => n.id === notif.id ? { ...n, isRead: true } : n));
    } else {
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    }
    await notificationsApi.markRead(orgId, notif.serverId).catch(() => {});
  };

  const handleLogout = () => {
    clearAuthTokens();
    router.push('/login');
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const visible = notifView === 'all' ? notifications : notifications.filter((n) => !n.isRead);

  const SidebarContent = () => (
    <>
      {/* Brand */}
      <div className="flex h-20 items-center justify-between border-b border-zinc-900 px-5">
        <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-600/30">
            <Leaf className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-brand font-semibold text-[17px] tracking-tight text-white">Zuti</span>
            <span className="text-xs text-zinc-500 font-light">Commerce</span>
          </div>
        </Link>
        {/* Bell */}
        <button
          onClick={() => setNotifOpen(true)}
          className="relative text-zinc-500 hover:text-zinc-200 transition-colors"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Nav */}
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
      </nav>

      {/* API status + sign out */}
      <div className="border-t border-zinc-900 p-3 space-y-1">
        {/* API status chip */}
        <div className="flex items-center gap-2 px-3 py-2">
          {apiStatus === 'connected' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
              <span className="text-xs text-zinc-500 font-light">API connected</span>
              <Wifi className="w-3 h-3 text-zinc-700 ml-auto" />
            </>
          )}
          {apiStatus === 'disconnected' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
              <span className="text-xs text-zinc-500 font-light">API offline</span>
              <WifiOff className="w-3 h-3 text-zinc-700 ml-auto" />
            </>
          )}
          {apiStatus === 'checking' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600 shrink-0" />
              <span className="text-xs text-zinc-600 font-light">Connecting…</span>
            </>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Notification backdrop */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-[55] bg-black/40"
          onClick={() => setNotifOpen(false)}
        />
      )}

      {/* Notification panel */}
      <div
        className={`fixed inset-y-0 right-0 z-[60] w-80 flex flex-col bg-zinc-950 border-l border-zinc-800 shadow-2xl transition-transform duration-300 ease-in-out ${
          notifOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between px-4 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-medium text-white">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
                  {unreadCount}
                </span>
              )}
            </div>
            {visible.length > 0 && notifView === 'unread' && (
              <button
                onClick={handleMarkAllRead}
                className="w-fit text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="flex items-start gap-3">
            <div className="inline-flex rounded-full border border-zinc-700 bg-zinc-900 px-1 py-1">
              <button
                onClick={() => setNotifView('unread')}
                className={`px-2 py-1 text-[10px] rounded-full transition-colors ${notifView === 'unread' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                Unread
              </button>
              <button
                onClick={() => setNotifView('all')}
                className={`px-2 py-1 text-[10px] rounded-full transition-colors ${notifView === 'all' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                All
              </button>
            </div>
            <button
              onClick={() => setNotifOpen(false)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="w-8 h-8 mb-3 text-zinc-800" />
              <p className="text-sm font-light text-zinc-600">
                {notifView === 'all' ? 'No notifications found' : 'No new notifications'}
              </p>
            </div>
          ) : (
            visible.map((notif) => (
              <div
                key={notif.id}
                className={`rounded-xl p-4 relative bg-zinc-900 border border-zinc-800 ${notif.isRead ? 'opacity-60' : ''}`}
              >
                {!notif.isRead && (
                  <button
                    onClick={() => handleDismiss(notif)}
                    className="absolute top-2 right-2 text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                <p className="text-sm font-medium text-white pr-4 mb-0.5">{notif.title}</p>
                <p className="text-xs font-light text-zinc-500">{notif.body}</p>
                {notif.isRead && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-700">Read</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex h-screen overflow-hidden bg-black">
        {/* Sidebar — desktop */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 md:flex">
          <SidebarContent />
        </aside>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Mobile top bar */}
          <div className="flex items-center justify-between border-b border-zinc-900 bg-zinc-950 px-4 py-3 md:hidden">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/30">
                <Leaf className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-brand font-semibold text-sm tracking-tight text-white">Zuti Commerce</span>
            </Link>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setNotifOpen(true)}
                className="relative text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={handleLogout}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
