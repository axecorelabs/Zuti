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
  invitedBy: { name?: string; email: string };
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
  /** Invitation-specific payload — present when type === 'invitation' */
  inviteMeta?: PendingInvite;
  /** Server notification id for markRead calls */
  serverId?: string;
}

const navItems = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, agentVisible: true },
  { label: 'Inbox', href: '/inbox', icon: MessageSquare, agentVisible: true },
  { label: 'Escalations', href: '/resolution', icon: MessagesSquare, agentVisible: true },
  { label: 'Analytics', href: '/analytics', icon: BarChart2, agentVisible: false },
  { label: 'Ai Support Bots', href: '/bots', icon: Bot, agentVisible: false },
  { label: 'Billing & Usage', href: '/billing-usage', icon: CreditCard, agentVisible: false },
  { label: 'Knowledge', href: '/knowledge', icon: BookOpen, agentVisible: false },
  { label: 'Team', href: '/team', icon: Users, agentVisible: true },
  { label: 'Activity', href: '/activity', icon: Activity, agentVisible: true },
  { label: 'Settings', href: '/settings', icon: Settings, agentVisible: true },
];

export default function Sidebar({ isOpen = false, onClose }: { isOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth, setOrgRoles, getRoleForOrg } = useAuthStore();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [orgOpen, setOrgOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [actingToken, setActingToken] = useState<string | null>(null);

  const activeOrgRole = activeOrg ? getRoleForOrg(activeOrg.id) : undefined;
  const isAgent = activeOrgRole === 'AGENT';
  const roleResolved = !activeOrg || activeOrgRole !== undefined;

  const fetchOrgs = useCallback(() => {
    orgsApi
      .list()
      .then((res) => {
        const list: (Org & { members?: { role: string }[] })[] = res.data;
        setOrgs(list);
        if (list.length > 0) setActiveOrg((prev) => prev ?? list[0]);
        // Store each org's role for the current user
        const roles: Record<string, string> = {};
        list.forEach((org) => {
          if (org.members?.[0]?.role) roles[org.id] = org.members[0].role;
        });
        setOrgRoles(roles);
      })
      .catch(() => {});
  }, [setOrgRoles]);

  const fetchNotifications = useCallback(() => {
    // Invitations (personal, no org required)
    invitationsApi
      .listMine()
      .then((res) => {
        const inviteNotifs: AppNotification[] = (res.data as PendingInvite[]).map((inv) => ({
          id: `invite-${inv.id}`,
          type: 'invitation',
          title: `Join ${inv.organization.name}`,
          body: `Invited by ${inv.invitedBy.name ?? inv.invitedBy.email} · ${inv.role}`,
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
      .list(activeOrg.id)
      .then((res) => {
        interface ServerNotif { id: string; type: string; title: string; body: string; }
        const serverNotifs: AppNotification[] = (res.data as ServerNotif[]).map((n) => ({
          id: `server-${n.id}`,
          serverId: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
        }));
        setNotifications((prev) => [
          ...prev.filter((n) => !n.serverId),
          ...serverNotifs,
        ]);
      })
      .catch(() => {});
  }, [activeOrg]);

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

  const notifCount = notifications.length;

  const handleDismissServer = async (notif: AppNotification) => {
    if (!notif.serverId || !activeOrg) return;
    setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    await notificationsApi.markRead(activeOrg.id, notif.serverId).catch(() => {});
  };

  const handleMarkAllRead = async () => {
    if (!activeOrg) return;
    setNotifications((prev) => prev.filter((n) => n.type === 'invitation'));
    await notificationsApi.markAllRead(activeOrg.id).catch(() => {});
  };

  return (
    <>
      {/* Notification backdrop (mobile-only full dark, desktop transparent) */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-[55] bg-black/40"
          onClick={() => setNotifOpen(false)}
        />
      )}

      {/* Notification panel — slides in from right */}
      <div
        className={`fixed inset-y-0 right-0 z-[60] w-80 bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${
          notifOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-white">Notifications</span>
            {notifCount > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
                {notifCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {notifCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={() => setNotifOpen(false)}
              className="text-zinc-600 hover:text-zinc-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {notifCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="w-8 h-8 text-zinc-800 mb-3" />
              <p className="text-sm text-zinc-600 font-light">No new notifications</p>
            </div>
          ) : (
            notifications.map((notif) => {
              if (notif.type === 'invitation' && notif.inviteMeta) {
                const inv = notif.inviteMeta;
                const busy = actingToken === inv.token;
                return (
                  <div key={notif.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Mail className="w-3 h-3 text-blue-400 shrink-0" />
                      <span className="text-[10px] text-blue-400 font-medium uppercase tracking-wide">Invitation</span>
                    </div>
                    <p className="text-sm font-medium text-white mb-0.5">{inv.organization.name}</p>
                    <p className="text-xs text-zinc-500 font-light mb-1">
                      Invited by {inv.invitedBy.name ?? inv.invitedBy.email}
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
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-400 text-xs font-light transition-colors"
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
                <div key={notif.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 relative">
                  <button
                    onClick={() => handleDismissServer(notif)}
                    className="absolute top-2 right-2 text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <p className="text-sm font-medium text-white mb-0.5 pr-4">{notif.title}</p>
                  <p className="text-xs text-zinc-500 font-light">{notif.body}</p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 md:relative md:inset-auto md:left-auto md:z-auto w-64 md:w-60 shrink-0 h-screen bg-zinc-950 border-r border-zinc-900 flex flex-col transition-transform duration-200 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Brand */}
        <div className="px-4 py-5 border-b border-zinc-900">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-600/30">
                <Leaf className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-brand font-semibold text-lg tracking-tight text-white">Zuti</span>
            </div>
            {/* Notification bell */}
            <button
              onClick={() => setNotifOpen(true)}
              title="Notifications"
              className="relative text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {notifCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold flex items-center justify-center">
                  {notifCount}
                </span>
              )}
            </button>
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

        {/* User footer */}
        <div className="px-3 py-3 border-t border-zinc-900">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-zinc-900/60 transition-colors group">
            <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
              <UserRound className="w-4 h-4 text-zinc-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-200 font-normal truncate leading-tight">{user?.name || 'Account'}</p>
              <p className="text-[11px] text-zinc-600 truncate leading-tight">{user?.email}</p>
            </div>
            {/* Logout */}
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
    </>
  );
}
