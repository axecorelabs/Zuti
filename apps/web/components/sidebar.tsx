'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  AlertTriangle,
  MessageSquare,
  MessagesSquare,
  Bot,
  CreditCard,
  BookOpen,
  Settings,
  LogOut,
  ChevronDown,
  Plus,
  Building2,
  Leaf,
  UserRound,
  Users,
  Bell,
  X,
  CheckCircle,
  XCircle,
  Mail,
  Activity,
  BarChart2,
  Briefcase,
  Sun,
  Moon,
} from 'lucide-react';
import { useAuthStore } from '@/lib/store';
import { orgsApi, invitationsApi, notificationsApi } from '@/lib/api';
import toast from 'react-hot-toast';

interface Org {
  id: string;
  name: string;
  slug: string;
}

interface PendingInvite {
  id: string;
  token: string;
  email: string;
  role: string;
  organization: { id: string; name: string; slug: string };
  invitedBy?: { name?: string; email?: string } | null;
}

// ─── General notification model ──────────────────────────────────────────────
// Add new types here as features grow (e.g. 'escalation' | 'mention' | 'system')
export type NotificationType =
  | 'invitation'
  | 'member_joined'
  | 'agent_took_over'
  | 'conversation_escalated'
  | string;

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  isRead?: boolean;
  /** Invitation-specific payload — present when type === 'invitation' */
  inviteMeta?: PendingInvite;
  /** Server notification id for markRead calls */
  serverId?: string;
}

const navItems = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, agentVisible: true },
  { label: 'Inbox', href: '/inbox', icon: MessageSquare, agentVisible: true },
  { label: 'AI Agents', href: '/bots', icon: Bot, agentVisible: false },
  { label: 'Knowledge', href: '/knowledge', icon: BookOpen, agentVisible: false },
  { label: 'Team', href: '/team', icon: Users, agentVisible: true },
  { label: 'Analytics', href: '/analytics', icon: BarChart2, agentVisible: false },
  { label: 'Operations', href: '/operations', icon: Briefcase, agentVisible: true },
  { label: 'Billing & Usage', href: '/billing-usage', icon: CreditCard, agentVisible: false },
  { label: 'Activity', href: '/activity', icon: Activity, agentVisible: true },
  { label: 'Settings', href: '/settings', icon: Settings, agentVisible: true },
];

export default function Sidebar({
  isOpen = false,
  onClose,
  theme,
  onToggleTheme,
}: {
  isOpen?: boolean;
  onClose?: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth, setOrgRoles, getRoleForOrg, activeOrgId, setActiveOrgId } = useAuthStore();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifView, setNotifView] = useState<'unread' | 'all'>('unread');
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [actingToken, setActingToken] = useState<string | null>(null);

  const activeOrgRole = activeOrg ? getRoleForOrg(activeOrg.id) : undefined;
  const isAgent = activeOrgRole === 'AGENT';
  const roleResolved = !activeOrg || activeOrgRole !== undefined;
  const canViewOrgWideNotifications = activeOrgRole === 'OWNER' || activeOrgRole === 'ADMIN';
  const isOrgWideAllView = notifView === 'all' && canViewOrgWideNotifications;

  const fetchOrgs = useCallback(() => {
    orgsApi
      .list()
      .then((res) => {
        const list: (Org & { members?: { role: string }[] })[] = res.data;
        setOrgs(list);
        if (list.length > 0) {
          const preferred = activeOrgId
            ? (list.find((org) => org.id === activeOrgId) ?? list[0])
            : list[0];
          setActiveOrg(preferred);
          if (preferred.id !== activeOrgId) {
            setActiveOrgId(preferred.id);
          }
        } else {
          setActiveOrg(null);
          if (activeOrgId) setActiveOrgId(null);
        }
        // Store each org's role for the current user
        const roles: Record<string, string> = {};
        list.forEach((org) => {
          if (org.members?.[0]?.role) roles[org.id] = org.members[0].role;
        });
        setOrgRoles(roles);
      })
      .catch(() => {});
  }, [activeOrgId, setActiveOrgId, setOrgRoles]);

  const fetchNotifications = useCallback(() => {
    // Invitations (personal, no org required)
    invitationsApi
      .listMine()
      .then((res) => {
        const inviteNotifs: AppNotification[] = (res.data as PendingInvite[]).map((inv) => ({
          id: `invite-${inv.id}`,
          type: 'invitation',
          title: `Join ${inv.organization.name}`,
          body: `Invited by ${inv.invitedBy?.name ?? inv.invitedBy?.email ?? 'a teammate'} · ${inv.role}`,
          inviteMeta: inv,
        }));
        setNotifications((prev) => [
          ...prev.filter((n) => n.type !== 'invitation'),
          ...inviteNotifs,
        ]);
      })
      .catch(() => {});
  }, []);

  // Separate effect: fetch server notifications whenever the active org changes
  const fetchServerNotifications = useCallback(() => {
    if (!activeOrg) return;
    notificationsApi
      .list(activeOrg.id, notifView === 'all', isOrgWideAllView)
      .then((res) => {
        interface ServerNotif { id: string; type: string; title: string; body: string; isRead: boolean; }
        const serverNotifs: AppNotification[] = (res.data as ServerNotif[]).map((n) => ({
          id: `server-${n.id}`,
          serverId: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          isRead: n.isRead,
        }));
        setNotifications((prev) => [
          ...prev.filter((n) => !n.serverId),
          ...serverNotifs,
        ]);
      })
      .catch(() => {});
  }, [activeOrg, notifView, isOrgWideAllView]);

  useEffect(() => {
    fetchOrgs();
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchOrgs, fetchNotifications]);

  useEffect(() => {
    fetchServerNotifications();
    const interval = setInterval(fetchServerNotifications, 60_000);
    return () => clearInterval(interval);
  }, [fetchServerNotifications]);

  useEffect(() => {
    if (!notifOpen) return;
    fetchNotifications();
    fetchServerNotifications();
  }, [notifOpen, fetchNotifications, fetchServerNotifications]);

  const handleAccept = async (token: string) => {
    setActingToken(token);
    try {
      await invitationsApi.accept(token);
      setNotifications((prev) => prev.filter((n) => n.inviteMeta?.token !== token));
      toast.success('Invitation accepted!');
      fetchOrgs();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to accept';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setActingToken(null);
    }
  };

  const handleDecline = async (token: string) => {
    setActingToken(token);
    try {
      await invitationsApi.decline(token);
      setNotifications((prev) => prev.filter((n) => n.inviteMeta?.token !== token));
      toast.success('Invitation declined');
    } catch {
      toast.error('Failed to decline');
    } finally {
      setActingToken(null);
    }
  };

  const handleLogout = () => {
    clearAuth();
    router.push('/login');
  };

  const isLight = theme === 'light';

  const handleDismissServer = async (notif: AppNotification) => {
    if (!notif.serverId || !activeOrg) return;
    if (isOrgWideAllView) return;
    if (notifView === 'all') {
      setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n)));
    } else {
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    }
    await notificationsApi.markRead(activeOrg.id, notif.serverId).catch(() => {});
  };

  const handleMarkAllRead = async () => {
    if (!activeOrg) return;
    if (isOrgWideAllView) return;
    await notificationsApi.markAllRead(activeOrg.id).catch(() => {});
    if (notifView === 'all') {
      setNotifications((prev) => prev.map((n) => (n.serverId ? { ...n, isRead: true } : n)));
      return;
    }
    setNotifications((prev) => prev.filter((n) => n.type === 'invitation'));
  };

  const unreadServerCount = notifications.filter((n) => n.serverId && n.isRead !== true).length;
  const inviteCount = notifications.filter((n) => n.type === 'invitation').length;
  const notifCount = inviteCount + unreadServerCount;
  const visibleNotifications = notifView === 'all'
    ? notifications
    : notifications.filter((n) => n.type === 'invitation' || n.isRead !== true);

  return (
    <>
      {/* Notification backdrop (mobile-only full dark, desktop transparent) */}
      {notifOpen && (
        <div
          className={`fixed inset-0 z-[55] ${isLight ? 'bg-slate-900/25' : 'bg-black/40'}`}
          onClick={() => setNotifOpen(false)}
        />
      )}

      {/* Notification panel — slides in from right */}
      <div
        className={`fixed inset-y-0 right-0 z-[60] w-80 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${
          isLight ? 'bg-white border-l border-slate-200' : 'bg-zinc-950 border-l border-zinc-800'
        } ${
          notifOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className={`flex items-start justify-between px-4 py-4 border-b shrink-0 ${isLight ? 'border-slate-200' : 'border-zinc-800'}`}>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Bell className={`w-4 h-4 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`} />
              <span className={`text-sm font-medium ${isLight ? 'text-slate-900' : 'text-white'}`}>Notifications</span>
              {notifCount > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
                  {notifCount}
                </span>
              )}
            </div>
            {visibleNotifications.length > 0 && !isOrgWideAllView ? (
              <button
                onClick={handleMarkAllRead}
                className={`w-fit text-[10px] transition-colors ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-end gap-1.5">
              <div className={`inline-flex rounded-full border px-1 py-1 ${isLight ? 'border-slate-200 bg-slate-100' : 'border-zinc-700 bg-zinc-900'}`}>
                <button
                  onClick={() => setNotifView('unread')}
                  className={`px-2 py-1 text-[10px] rounded-full transition-colors ${notifView === 'unread' ? 'bg-blue-600 text-white' : isLight ? 'text-slate-600 hover:text-slate-800' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  Unread
                </button>
                <button
                  onClick={() => setNotifView('all')}
                  className={`px-2 py-1 text-[10px] rounded-full transition-colors ${notifView === 'all' ? 'bg-blue-600 text-white' : isLight ? 'text-slate-600 hover:text-slate-800' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  All
                </button>
              </div>
            </div>
            <button
              onClick={() => setNotifOpen(false)}
              className={`transition-colors ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-zinc-600 hover:text-zinc-300'}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {visibleNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className={`w-8 h-8 mb-3 ${isLight ? 'text-slate-300' : 'text-zinc-800'}`} />
              <p className={`text-sm font-light ${isLight ? 'text-slate-500' : 'text-zinc-600'}`}>
                {notifView === 'all' ? 'No notifications found' : 'No new notifications'}
              </p>
            </div>
          ) : (
            visibleNotifications.map((notif) => {
              if (notif.type === 'invitation' && notif.inviteMeta) {
                const inv = notif.inviteMeta;
                const busy = actingToken === inv.token;
                return (
                  <div key={notif.id} className={`rounded-xl p-4 ${isLight ? 'bg-slate-50 border border-slate-200' : 'bg-zinc-900 border border-zinc-800'}`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Mail className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="text-[10px] text-blue-400 font-medium uppercase tracking-wide">Invitation</span>
                    </div>
                    <p className={`text-sm font-medium mb-0.5 ${isLight ? 'text-slate-900' : 'text-white'}`}>{inv.organization.name}</p>
                    <p className={`text-xs font-light mb-1 ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>
                      Invited by {inv.invitedBy?.name ?? inv.invitedBy?.email ?? 'a teammate'}
                    </p>
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded-lg bg-blue-500/15 text-blue-400 font-medium mb-3">
                      {inv.role}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAccept(inv.token)}
                        disabled={busy}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Accept
                      </button>
                      <button
                        onClick={() => handleDecline(inv.token)}
                        disabled={busy}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg disabled:opacity-50 text-xs font-light transition-colors ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}
                      >
                        <XCircle className="w-3 h-3" />
                        Decline
                      </button>
                    </div>
                  </div>
                );
              }
              // Server notification card (with dismiss button)
              return (
                <div key={notif.id} className={`rounded-xl p-4 relative ${isLight ? 'bg-slate-50 border border-slate-200' : 'bg-zinc-900 border border-zinc-800'} ${notif.isRead ? 'opacity-75' : ''}`}>
                  {!notif.isRead && !isOrgWideAllView ? (
                    <button
                      onClick={() => handleDismissServer(notif)}
                      className={`absolute top-2 right-2 transition-colors ${isLight ? 'text-slate-400 hover:text-slate-700' : 'text-zinc-600 hover:text-zinc-300'}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  ) : null}
                  <p className={`text-sm font-medium mb-0.5 pr-4 ${isLight ? 'text-slate-900' : 'text-white'}`}>{notif.title}</p>
                  <p className={`text-xs font-light ${isLight ? 'text-slate-500' : 'text-zinc-500'}`}>{notif.body}</p>
                  {notif.isRead ? (
                    <p className={`mt-1 text-[10px] uppercase tracking-wide ${isLight ? 'text-slate-400' : 'text-zinc-600'}`}>Read</p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 md:relative md:inset-auto md:left-auto md:z-auto w-64 md:w-60 shrink-0 h-screen flex flex-col transition-transform duration-200 ease-in-out ${isLight ? 'bg-white border-r border-slate-200' : 'bg-zinc-950 border-r border-zinc-900'} ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Brand */}
        <div className={`px-4 py-5 border-b ${isLight ? 'border-slate-200' : 'border-zinc-900'}`}>
          <div className="flex items-center justify-between px-1">
            <Link
              href="/"
              onClick={onClose}
              className="flex items-center gap-2.5 hover:opacity-90 transition-opacity"
            >
              <div className="sidebar-brand-logo w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-600/30">
                <Leaf className="sidebar-brand-logo-icon w-3.5 h-3.5 text-white" />
              </div>
              <span className={`font-brand font-semibold text-lg tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>Zuti Studio</span>
            </Link>
            {/* Notification bell */}
            <button
              onClick={() => setNotifOpen(true)}
              title="Notifications"
              className={`relative transition-colors ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-zinc-500 hover:text-zinc-200'}`}
            >
              <Bell className="w-4 h-4" />
              {notifCount > 0 && (
                <span className="sidebar-notif-badge absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center">
                  {notifCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Org switcher */}
        <div className={`px-3 py-3 border-b ${isLight ? 'border-slate-200' : 'border-zinc-900'}`}>
          <button
            onClick={() => setOrgOpen(!orgOpen)}
            className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-colors ${isLight ? 'hover:bg-slate-100' : 'hover:bg-zinc-900'}`}
          >
            <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${isLight ? 'bg-slate-200' : 'bg-zinc-700'}`}>
              <Building2 className={`w-3.5 h-3.5 ${isLight ? 'text-slate-600' : 'text-zinc-300'}`} />
            </div>
            <span className={`text-sm font-light truncate flex-1 text-left ${isLight ? 'text-slate-700' : 'text-zinc-300'}`}>
              {activeOrg?.name ?? 'No workspace'}
            </span>
            <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-slate-500' : 'text-zinc-600'}`} />
          </button>

          {orgOpen && orgs.length > 0 && (
            <div className={`mt-1 rounded-lg overflow-hidden ${isLight ? 'bg-white border border-slate-200' : 'bg-zinc-900 border border-zinc-800'}`}>
              {orgs.map((org) => (
                <button
                  key={org.id}
                  onClick={() => {
                    setActiveOrg(org);
                    setActiveOrgId(org.id);
                    setOrgOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors font-light ${isLight ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                >
                  {org.name}
                </button>
              ))}
              <Link
                href="/onboarding"
                className={`flex items-center gap-1.5 px-3 py-2 text-sm border-t transition-colors font-light ${isLight ? 'text-slate-500 hover:text-slate-800 border-slate-200' : 'text-zinc-600 hover:text-zinc-300 border-zinc-800'}`}
              >
                <Plus className="w-3.5 h-3.5" />
                New workspace
              </Link>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems
            .filter((item) => item.agentVisible || (roleResolved && !isAgent))
            .map(({ label, href, icon: Icon }) => {
            const isActive =
              pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all relative ${
                  isActive
                    ? (isLight ? 'bg-blue-50 text-slate-900 font-normal' : 'bg-blue-600/10 text-white font-normal')
                    : (isLight ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 font-light' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/60 font-light')
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-r-full" />
                )}
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-500' : isLight ? 'text-slate-400' : 'text-zinc-600'}`} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className={`px-3 py-3 border-t ${isLight ? 'border-slate-200' : 'border-zinc-900'}`}>
          <button
            onClick={onToggleTheme}
            className={`w-full mb-2 flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border transition-colors ${isLight ? 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900' : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:text-white hover:bg-zinc-900'}`}
          >
            <span className="inline-flex items-center gap-2 text-xs font-medium">
              {theme === 'light' ? <Sun className="w-3.5 h-3.5 text-blue-400" /> : <Moon className="w-3.5 h-3.5 text-blue-400" />}
              {theme === 'light' ? 'Light mode' : 'Dark mode'}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/25">
              Switch
            </span>
          </button>

          <div className={`flex items-center gap-2.5 px-2 py-2 rounded-lg transition-colors group ${isLight ? 'hover:bg-slate-100' : 'hover:bg-zinc-900/60'}`}>
            <div className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${isLight ? 'bg-slate-100 border-slate-200' : 'bg-zinc-800 border-zinc-700'}`}>
              <UserRound className={`w-4 h-4 ${isLight ? 'text-slate-500' : 'text-zinc-400'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-normal truncate leading-tight ${isLight ? 'text-slate-800' : 'text-zinc-200'}`}>{user?.name || 'Account'}</p>
              <p className={`text-[11px] truncate leading-tight ${isLight ? 'text-slate-500' : 'text-zinc-600'}`}>{user?.email}</p>
            </div>
            {/* Logout */}
            <button
              onClick={handleLogout}
              title="Sign out"
              className={`transition-colors opacity-0 group-hover:opacity-100 ${isLight ? 'text-slate-400 hover:text-slate-700' : 'text-zinc-700 hover:text-zinc-300'}`}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
