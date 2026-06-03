'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Building2,
  MessageSquare,
  AlertCircle,
  CheckCircle2,
  Ban,
  Users,
  Bot,
  Clock3,
  UserRound,
  Loader2,
  PieChart as PieChartIcon,
  Search,
  Plus,
  ChevronDown,
  Check,
  X,
  KeyRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { invitationsApi, orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type MemberRole = 'OWNER' | 'ADMIN' | 'AGENT';
type SetupRequestStatus = 'PENDING' | 'CONTACTED' | 'ORG_CREATED' | 'REQUESTER_ADDED' | 'COMPLETED' | 'DECLINED' | 'CANCELED';
type SetupActionKind = 'CREATE_ORGANIZATION' | 'RETRY_REQUESTER_ADD' | 'FINALIZE_HANDOVER' | 'MARK_CONTACTED' | 'MARK_COMPLETE' | 'DECLINE_REQUEST';
type GlobalTab = 'organizations' | 'statistics' | 'setup-requests';
type JoinMode = 'JOIN_CODE' | 'PENDING_INVITES';

const SETUP_STATUS_OPTIONS: Array<'ALL' | SetupRequestStatus> = [
  'ALL',
  'PENDING',
  'CONTACTED',
  'ORG_CREATED',
  'REQUESTER_ADDED',
  'COMPLETED',
  'DECLINED',
  'CANCELED',
];

type PendingInvite = {
  id: string;
  token: string;
  role: string;
  createdAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  invitedBy?: {
    name?: string;
    email?: string;
  };
};

type OverviewOrganization = {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
  memberCount: number | null;
  botCount: number | null;
  conversationTotals: {
    total: number;
    open: number;
    resolved: number;
    escalated: number;
    pending: number;
  };
};

type SetupRequestRow = {
  id: string;
  status: SetupRequestStatus;
  createdAt: string;
  updatedAt: string;
  note?: string | null;
  organization?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  requester: {
    id: string;
    name?: string | null;
    email: string;
  };
};

type RequesterSetupRequestRow = {
  id: string;
  status: SetupRequestStatus;
  createdAt: string;
  updatedAt: string;
  note?: string | null;
  organization?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  manager: {
    id: string;
    name?: string | null;
    email: string;
    managerProfile?: {
      displayName?: string | null;
    } | null;
  };
};

type OverviewData = {
  totals: {
    organizationCount: number;
    visibleMemberCount: number;
    visibleBotCount: number;
    conversations: {
      total: number;
      open: number;
      resolved: number;
      escalated: number;
      pending: number;
    };
  };
  organizations: OverviewOrganization[];
  setupRequests: {
    totals: {
      total: number;
      pending: number;
      contacted: number;
      orgCreated: number;
      requesterAdded: number;
      completed: number;
      declined: number;
      canceled: number;
    };
    recent: SetupRequestRow[];
  } | null;
  generatedAt: string;
};

function roleLabel(role: MemberRole) {
  if (role === 'OWNER') return 'Owner';
  if (role === 'ADMIN') return 'Admin';
  return 'Agent';
}

function statusLabel(status: SetupRequestStatus) {
  if (status === 'PENDING') return 'Pending';
  if (status === 'CONTACTED') return 'Contacted';
  if (status === 'ORG_CREATED') return 'Organization created';
  if (status === 'REQUESTER_ADDED') return 'Requester added';
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'DECLINED') return 'Declined';
  return 'Canceled';
}

function statusClass(status: SetupRequestStatus) {
  if (status === 'COMPLETED' || status === 'REQUESTER_ADDED') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
  if (status === 'ORG_CREATED') return 'border-violet-500/20 bg-violet-500/10 text-violet-200';
  if (status === 'DECLINED' || status === 'CANCELED') return 'border-zinc-700 bg-zinc-900/60 text-zinc-500';
  if (status === 'CONTACTED') return 'border-blue-500/20 bg-blue-500/10 text-blue-300';
  return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseWorkspaceName(note?: string | null) {
  if (!note) return null;
  const line = note
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith('workspace name:'));
  if (!line) return null;
  return line.slice('workspace name:'.length).trim() || null;
}

const STATUS_COLORS: Record<string, string> = {
  Open: '#3b82f6',
  Pending: '#71717a',
  Resolved: '#22c55e',
  Escalated: '#f87171',
};

function GlobalOverviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | MemberRole>('ALL');
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinMode, setJoinMode] = useState<JoinMode>('JOIN_CODE');
  const [joinId, setJoinId] = useState('');
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [actingToken, setActingToken] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupStatusFilter, setSetupStatusFilter] = useState<'ALL' | SetupRequestStatus>('ALL');
  const [setupQuery, setSetupQuery] = useState('');
  const [setupItems, setSetupItems] = useState<SetupRequestRow[]>([]);
  const [setupSavingId, setSetupSavingId] = useState<string | null>(null);
  const [openSetupActionMenuId, setOpenSetupActionMenuId] = useState<string | null>(null);
  const [pendingSetupAction, setPendingSetupAction] = useState<{
    requestId: string;
    requesterName: string;
    action: SetupActionKind;
  } | null>(null);
  const [confirmingSetupAction, setConfirmingSetupAction] = useState(false);
  const [requesterSetupLoading, setRequesterSetupLoading] = useState(false);
  const [requesterSetupItems, setRequesterSetupItems] = useState<RequesterSetupRequestRow[]>([]);

  useEffect(() => {
    if (!openSetupActionMenuId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const selector = `[data-setup-menu-root="${openSetupActionMenuId}"]`;
      const clickedInsideMenu = target.closest(selector);
      if (!clickedInsideMenu) {
        setOpenSetupActionMenuId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openSetupActionMenuId]);

  const isManager = user?.role === 'MANAGER';
  const requestedTab = (searchParams.get('tab') ?? 'organizations') as GlobalTab;
  const tab: GlobalTab = requestedTab === 'statistics' || requestedTab === 'setup-requests' ? requestedTab : 'organizations';

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const res = await orgsApi.globalOverview();
        if (active) {
          setData(res.data as OverviewData);
        }
      } catch (error: unknown) {
        const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
        toast.error(Array.isArray(message) ? message[0] : message ?? 'Failed to load overview');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const totals = data?.totals;
  const orgRows = data?.organizations ?? [];
  const filteredOrganizations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return orgRows.filter((org) => {
      if (roleFilter !== 'ALL' && org.role !== roleFilter) return false;
      if (!normalized) return true;
      return org.name.toLowerCase().includes(normalized) || org.slug.toLowerCase().includes(normalized);
    });
  }, [orgRows, query, roleFilter]);

  const topCards = useMemo(() => {
    const conversationTotals = totals?.conversations ?? {
      total: 0,
      open: 0,
      resolved: 0,
      escalated: 0,
      pending: 0,
    };

    return [
      { label: 'Organizations', value: totals?.organizationCount ?? 0, icon: Building2 },
      { label: 'Visible conversations', value: conversationTotals.total, icon: MessageSquare },
      { label: 'Open', value: conversationTotals.open, icon: AlertCircle },
      { label: 'Escalated', value: conversationTotals.escalated, icon: Clock3 },
      { label: 'Visible team members', value: totals?.visibleMemberCount ?? 0, icon: Users },
      { label: 'Visible bots', value: totals?.visibleBotCount ?? 0, icon: Bot },
    ];
  }, [totals]);

  const volumeByOrg = useMemo(() => {
    return orgRows
      .map((org) => ({
        name: org.name.length > 14 ? `${org.name.slice(0, 14)}...` : org.name,
        conversations: org.conversationTotals.total,
      }))
      .sort((a, b) => b.conversations - a.conversations)
      .slice(0, 8);
  }, [orgRows]);

  const statusBreakdown = useMemo(() => {
    const conversationTotals = totals?.conversations ?? {
      total: 0,
      open: 0,
      resolved: 0,
      escalated: 0,
      pending: 0,
    };

    return [
      { name: 'Open', value: conversationTotals.open, color: STATUS_COLORS.Open },
      { name: 'Pending', value: conversationTotals.pending, color: STATUS_COLORS.Pending },
      { name: 'Resolved', value: conversationTotals.resolved, color: STATUS_COLORS.Resolved },
      { name: 'Escalated', value: conversationTotals.escalated, color: STATUS_COLORS.Escalated },
    ].filter((item) => item.value > 0);
  }, [totals]);

  const loadInvites = async () => {
    setLoadingInvites(true);
    try {
      const res = await invitationsApi.listMine();
      setPendingInvites(res.data as PendingInvite[]);
    } catch {
      toast.error('Failed to load pending invitations');
    } finally {
      setLoadingInvites(false);
    }
  };

  const openJoinModal = () => {
    setJoinModalOpen(true);
    setJoinMode('JOIN_CODE');
    setJoinId('');
    setCode('');
    void loadInvites();
  };

  const handleJoinByCode = async () => {
    if (!joinId.trim() || !code.trim()) return;
    setJoining(true);
    try {
      await invitationsApi.redeemJoinCode(joinId.trim().toUpperCase(), code.trim());
      toast.success('Workspace joined successfully');
      setJoinModalOpen(false);
      const res = await orgsApi.globalOverview();
      setData(res.data as OverviewData);
      await loadInvites();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Failed to join workspace';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setJoining(false);
    }
  };

  const handleAcceptInvite = async (token: string) => {
    setActingToken(token);
    try {
      await invitationsApi.accept(token);
      toast.success('Invitation accepted');
      await loadInvites();
      const res = await orgsApi.globalOverview();
      setData(res.data as OverviewData);
    } catch {
      toast.error('Failed to accept invitation');
    } finally {
      setActingToken(null);
    }
  };

  const handleDeclineInvite = async (token: string) => {
    setActingToken(token);
    try {
      await invitationsApi.decline(token);
      setPendingInvites((prev) => prev.filter((invite) => invite.token !== token));
      toast.success('Invitation declined');
    } catch {
      toast.error('Failed to decline invitation');
    } finally {
      setActingToken(null);
    }
  };

  const loadSetupRequests = async () => {
    setSetupLoading(true);
    try {
      const res = await orgsApi.listAssignedSetupRequests(
        setupStatusFilter === 'ALL' ? undefined : { status: setupStatusFilter },
      );
      const nextItems = Array.isArray(res.data?.items) ? (res.data.items as SetupRequestRow[]) : [];
      setSetupItems(nextItems);
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Failed to load setup requests');
    } finally {
      setSetupLoading(false);
    }
  };

  useEffect(() => {
    if (!isManager || tab !== 'setup-requests') return;
    void loadSetupRequests();
  }, [isManager, tab, setupStatusFilter]);

  const loadRequesterSetupRequests = async () => {
    setRequesterSetupLoading(true);
    try {
      const res = await orgsApi.listMySetupRequests();
      const nextItems = Array.isArray(res.data?.items) ? (res.data.items as RequesterSetupRequestRow[]) : [];
      setRequesterSetupItems(nextItems);
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Failed to load your setup requests');
    } finally {
      setRequesterSetupLoading(false);
    }
  };

  useEffect(() => {
    if (isManager || tab !== 'organizations') return;
    void loadRequesterSetupRequests();
  }, [isManager, tab]);

  const filteredSetupItems = useMemo(() => {
    const normalized = setupQuery.trim().toLowerCase();
    if (!normalized) return setupItems;
    return setupItems.filter((item) => {
      const requesterName = (item.requester.name ?? '').toLowerCase();
      const requesterEmail = item.requester.email.toLowerCase();
      const note = (item.note ?? '').toLowerCase();
      return requesterName.includes(normalized) || requesterEmail.includes(normalized) || note.includes(normalized);
    });
  }, [setupItems, setupQuery]);

  const setupCounts = useMemo(() => ({
    total: setupItems.length,
    pending: setupItems.filter((item) => item.status === 'PENDING').length,
    contacted: setupItems.filter((item) => item.status === 'CONTACTED').length,
    requesterAdded: setupItems.filter((item) => item.status === 'REQUESTER_ADDED').length,
  }), [setupItems]);

  const requesterSetupCards = useMemo(() => {
    if (isManager) return [];

    const orgIds = new Set(orgRows.map((org) => org.id));
    return requesterSetupItems.filter((item) => {
      if (item.status === 'PENDING' || item.status === 'CONTACTED') return true;
      if ((item.status === 'COMPLETED' || item.status === 'REQUESTER_ADDED' || item.status === 'ORG_CREATED')
        && item.organization && !orgIds.has(item.organization.id)) return true;
      return false;
    });
  }, [isManager, orgRows, requesterSetupItems]);

  const updateSetupStatus = async (requestId: string, status: SetupRequestStatus) => {
    setSetupSavingId(requestId);
    try {
      const res = await orgsApi.updateSetupRequestStatus(requestId, status);
      const updated = res.data?.item as SetupRequestRow | undefined;
      if (!updated) return;
      setSetupItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(`Request marked as ${statusLabel(status).toLowerCase()}`);
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Failed to update setup request');
    } finally {
      setSetupSavingId(null);
    }
  };

  const createOrganizationFromSetup = async (requestId: string) => {
    setSetupSavingId(requestId);
    try {
      const res = await orgsApi.createOrganizationFromSetupRequest(requestId);
      const updated = res.data?.item as SetupRequestRow | undefined;
      if (!updated) return;

      setSetupItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      const createdName = updated.organization?.name ?? 'organization';
      toast.success(`Created ${createdName} and added requester`);
      if (updated.organization?.id) {
        router.push(`/dashboard?org=${updated.organization.id}`);
      }
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Failed to create organization from setup request');
    } finally {
      setSetupSavingId(null);
    }
  };

  const retryRequesterAddFromSetup = async (requestId: string) => {
    setSetupSavingId(requestId);
    try {
      const res = await orgsApi.retryRequesterAddFromSetupRequest(requestId);
      const updated = res.data?.item as SetupRequestRow | undefined;
      if (!updated) return;

      setSetupItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success('Requester added to workspace successfully');
      if (updated.organization?.id) {
        router.push(`/dashboard?org=${updated.organization.id}`);
      }
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Failed to retry requester add');
    } finally {
      setSetupSavingId(null);
    }
  };

  const finalizeSetupHandover = async (requestId: string) => {
    setSetupSavingId(requestId);
    try {
      const res = await orgsApi.finalizeSetupHandover(requestId);
      const updated = res.data?.item as SetupRequestRow | undefined;
      if (!updated) return;

      setSetupItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success('Ownership transferred and setup completed');
      if (updated.organization?.id) {
        router.push(`/dashboard?org=${updated.organization.id}`);
      }
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Failed to finalize setup handover');
    } finally {
      setSetupSavingId(null);
    }
  };

  const getSetupActionCopy = (action: SetupActionKind) => {
    if (action === 'CREATE_ORGANIZATION') {
      return {
        title: 'Create organization?',
        description: 'This will create a new organization for this setup request and assign the requester.',
        confirmLabel: 'Create organization',
      };
    }

    if (action === 'RETRY_REQUESTER_ADD') {
      return {
        title: 'Retry requester add?',
        description: 'This will retry adding the requester to the created organization and continue the setup flow.',
        confirmLabel: 'Retry add requester',
      };
    }

    if (action === 'FINALIZE_HANDOVER') {
      return {
        title: 'Finalize handover?',
        description: 'This will transfer workspace ownership from manager to requester and mark setup as completed.',
        confirmLabel: 'Finalize handover',
      };
    }

    if (action === 'MARK_CONTACTED') {
      return {
        title: 'Mark as contacted?',
        description: 'This marks the setup request as contacted.',
        confirmLabel: 'Mark contacted',
      };
    }

    if (action === 'MARK_COMPLETE') {
      return {
        title: 'Mark as complete?',
        description: 'This marks the setup request as complete.',
        confirmLabel: 'Mark complete',
      };
    }

    return {
      title: 'Decline request?',
      description: 'This action declines the setup request. You can not undo this from the queue.',
      confirmLabel: 'Decline request',
    };
  };

  const confirmPendingSetupAction = async () => {
    if (!pendingSetupAction) return;

    const { requestId, action } = pendingSetupAction;
    setConfirmingSetupAction(true);
    try {
      if (action === 'CREATE_ORGANIZATION') {
        await createOrganizationFromSetup(requestId);
      } else if (action === 'RETRY_REQUESTER_ADD') {
        await retryRequesterAddFromSetup(requestId);
      } else if (action === 'FINALIZE_HANDOVER') {
        await finalizeSetupHandover(requestId);
      } else if (action === 'MARK_CONTACTED') {
        await updateSetupStatus(requestId, 'CONTACTED');
      } else if (action === 'MARK_COMPLETE') {
        await updateSetupStatus(requestId, 'COMPLETED');
      } else {
        await updateSetupStatus(requestId, 'DECLINED');
      }
    } finally {
      setConfirmingSetupAction(false);
      setPendingSetupAction(null);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">Global Overview</h1>
        <p className="mt-1 text-sm text-zinc-500">Cross-workspace mode.</p>
      </div>

      {tab === 'organizations' ? (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <label className="relative block md:min-w-[360px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search workspaces"
                  className="input-base h-10 rounded-xl border-zinc-700/80 bg-zinc-900/80 pl-10"
                />
              </label>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setRoleMenuOpen((v) => !v)}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-3 text-xs text-zinc-300 hover:border-zinc-600"
                  >
                    {roleFilter === 'ALL' ? 'All roles' : roleLabel(roleFilter)}
                  </button>
                  {roleMenuOpen ? (
                    <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
                      {(['ALL', 'OWNER', 'ADMIN', 'AGENT'] as const).map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => {
                            setRoleFilter(role);
                            setRoleMenuOpen(false);
                          }}
                          className={`w-full rounded-lg px-2 py-1.5 text-left text-xs ${roleFilter === role ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}`}
                        >
                          {role === 'ALL' ? 'All roles' : roleLabel(role)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={openJoinModal}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-3 text-xs text-zinc-300 hover:border-zinc-600 hover:text-white"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Join organization
                </button>

                <Link
                  href="/setup-workspace"
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 text-xs text-blue-200 hover:bg-blue-500/20"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New workspace
                </Link>
              </div>
            </div>
          </div>

          {!isManager ? (
            <div className="card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white">Workspace setup requests</p>
                  <p className="text-xs text-zinc-500">Track manager-assisted workspace creation.</p>
                </div>
              </div>

              {requesterSetupLoading ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[...Array(3)].map((_, index) => (
                    <div key={index} className="h-32 rounded-2xl bg-zinc-900 animate-pulse" />
                  ))}
                </div>
              ) : requesterSetupCards.length === 0 ? (
                <p className="mt-4 text-xs text-zinc-600">No active setup requests.</p>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {requesterSetupCards.map((item) => {
                    const managerName = item.manager.managerProfile?.displayName || item.manager.name || item.manager.email;
                    const workspaceName = item.organization?.name ?? parseWorkspaceName(item.note) ?? 'Workspace setup in progress';
                    const canOpen = false;

                    return (
                      <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm text-white">{workspaceName}</p>
                          <span className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] leading-none ${statusClass(item.status)}`}>
                            {statusLabel(item.status)}
                          </span>
                        </div>

                        <p className="mt-2 text-xs text-zinc-400">Managed by {managerName}</p>
                        <p className="mt-1 text-[11px] text-zinc-500">Requested {formatDate(item.createdAt)}</p>

                        {(item.status === 'COMPLETED' || item.status === 'REQUESTER_ADDED' || item.status === 'ORG_CREATED') && item.organization ? (
                          <p className="mt-2 text-[11px] text-zinc-500">
                            Workspace created. Access card will unlock when membership sync completes.
                          </p>
                        ) : null}

                        <button
                          type="button"
                          disabled={!canOpen}
                          className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Open workspace
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card h-36 animate-pulse bg-zinc-900" />
              ))}
            </div>
          ) : filteredOrganizations.length === 0 ? (
            <div className="card p-10 text-center">
              <p className="text-sm text-zinc-400">No organizations found.</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={openJoinModal}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-700/80 bg-zinc-900/80 px-4 text-xs text-zinc-300 hover:border-zinc-600 hover:text-white"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Join organization
                </button>
                <Link
                  href="/setup-workspace"
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 text-xs text-blue-200 hover:bg-blue-500/20"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New workspace
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredOrganizations.map((org) => (
                <Link
                  key={org.id}
                  href={`/dashboard?org=${org.id}`}
                  className="card block h-44 p-5 transition-colors hover:bg-zinc-900/40"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{org.name}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">{roleLabel(org.role)}</p>
                    </div>
                    <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300">Workspace</span>
                  </div>

                  <div className="mt-auto flex h-[78px] items-end justify-end">
                    <span className="inline-flex items-center justify-center rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300">
                      Open workspace
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {tab === 'statistics' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {topCards.map(({ label, value, icon: Icon }) => (
              <div key={label} className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <Icon className="h-4 w-4 text-zinc-500" />
                </div>
                {loading ? (
                  <div className="h-7 w-12 animate-pulse rounded bg-zinc-800" />
                ) : (
                  <p className="font-brand text-3xl font-semibold tracking-tight text-white">{value}</p>
                )}
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <div className="mb-4 flex items-center gap-2">
                <BarChart className="h-4 w-4 text-zinc-500" />
                <p className="text-sm text-white">Conversations by organization</p>
              </div>
              {loading ? (
                <div className="h-44 animate-pulse rounded bg-zinc-900" />
              ) : volumeByOrg.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-xs text-zinc-600">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={volumeByOrg}>
                    <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip />
                    <Bar dataKey="conversations" radius={[4, 4, 0, 0]} fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="card p-5">
              <div className="mb-4 flex items-center gap-2">
                <PieChartIcon className="h-4 w-4 text-zinc-500" />
                <p className="text-sm text-white">Status breakdown</p>
              </div>
              {loading ? (
                <div className="h-44 animate-pulse rounded bg-zinc-900" />
              ) : statusBreakdown.length === 0 ? (
                <div className="h-44 flex items-center justify-center text-xs text-zinc-600">No data yet</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={34} outerRadius={56} strokeWidth={0}>
                        {statusBreakdown.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1">
                    {statusBreakdown.map((entry) => (
                      <div key={entry.name} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">{entry.name}</span>
                        <span className="text-zinc-300">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'setup-requests' ? (
        <div className="space-y-4">
          {!isManager ? (
            <div className="card p-10 text-center text-sm text-zinc-500">Setup requests are only available to manager accounts.</div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="card p-5">
                  <p className="text-xs text-zinc-500">Total</p>
                  <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{setupCounts.total}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-zinc-500">Pending</p>
                  <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{setupCounts.pending}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-zinc-500">Contacted</p>
                  <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{setupCounts.contacted}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-zinc-500">Requester added</p>
                  <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{setupCounts.requesterAdded}</p>
                </div>
              </div>

              <div className="card overflow-visible">
                <div className="border-b border-zinc-800 px-5 py-5 md:px-6">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-wrap gap-2">
                      {SETUP_STATUS_OPTIONS.map((status) => {
                        const active = setupStatusFilter === status;
                        return (
                          <button
                            key={status}
                            type="button"
                            onClick={() => setSetupStatusFilter(status)}
                            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                              active
                                ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                                : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                            }`}
                          >
                            {status === 'ALL' ? 'All statuses' : statusLabel(status)}
                          </button>
                        );
                      })}
                    </div>

                    <label className="relative block md:min-w-[260px]">
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <input
                        value={setupQuery}
                        onChange={(event) => setSetupQuery(event.target.value)}
                        placeholder="Search requester or note"
                        className="input-base h-10 rounded-2xl border-zinc-700/80 bg-zinc-900/80 pl-11"
                      />
                    </label>
                  </div>
                </div>

                {setupLoading ? (
                  <div className="space-y-3 p-4 md:p-6">
                    {[...Array(5)].map((_, index) => (
                      <div key={index} className="h-20 rounded-2xl bg-zinc-900 animate-pulse" />
                    ))}
                  </div>
                ) : filteredSetupItems.length === 0 ? (
                  <div className="p-10 text-center">
                    <p className="text-sm text-zinc-400">No setup requests match the current filter.</p>
                    <p className="mt-1 text-xs text-zinc-600">Try changing status filters or clearing search.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/60">
                    {filteredSetupItems.map((item) => {
                      const requesterName = item.requester.name || item.requester.email;
                      const requestedWorkspaceName = item.organization?.name ?? parseWorkspaceName(item.note);
                      const isSaving = setupSavingId === item.id;
                      const canMarkContacted = item.status === 'PENDING';
                      const canCreateOrganization = !item.organization && (item.status === 'PENDING' || item.status === 'CONTACTED');
                      const canRetryRequesterAdd = Boolean(item.organization) && item.status === 'ORG_CREATED';
                      const canFinalizeHandover = Boolean(item.organization) && item.status === 'REQUESTER_ADDED';
                      const canMarkCompleted = Boolean(item.organization)
                        && (item.status === 'PENDING' || item.status === 'CONTACTED' || item.status === 'ORG_CREATED');
                      const canDecline = item.status === 'PENDING' || item.status === 'CONTACTED';

                      return (
                        <div key={item.id} className="px-5 py-4 md:px-6">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <UserRound className="h-4 w-4 text-zinc-500" />
                                <p className="truncate text-sm text-white">{requesterName}</p>
                                <span className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] leading-none ${statusClass(item.status)}`}>
                                  {statusLabel(item.status)}
                                </span>
                              </div>

                              <p className="mt-1 text-xs text-zinc-500">{item.requester.email}</p>

                              {requestedWorkspaceName ? (
                                <p className="mt-1 text-xs text-zinc-400">Requested workspace: {requestedWorkspaceName}</p>
                              ) : null}

                              {item.organization ? (
                                <p className="mt-1 text-xs text-zinc-400">Created organization: {item.organization.name}</p>
                              ) : null}

                              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                                <span className="inline-flex items-center gap-1">
                                  <Clock3 className="h-3.5 w-3.5" />
                                  Requested {formatDate(item.createdAt)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  Updated {formatDate(item.updatedAt)}
                                </span>
                              </div>

                              {item.note ? (
                                <p className="mt-2 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
                                  {item.note}
                                </p>
                              ) : null}
                            </div>

                            <div className="relative md:ml-4" data-setup-menu-root={item.id}>
                              <button
                                type="button"
                                onClick={() => setOpenSetupActionMenuId((current) => (current === item.id ? null : item.id))}
                                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                              >
                                Actions
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openSetupActionMenuId === item.id ? 'rotate-180' : ''}`} />
                              </button>

                              {openSetupActionMenuId === item.id ? (
                                <div className="absolute bottom-full right-0 z-50 mb-2 w-56 rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 shadow-2xl">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenSetupActionMenuId(null);
                                      setPendingSetupAction({
                                        requestId: item.id,
                                        requesterName,
                                        action: 'CREATE_ORGANIZATION',
                                      });
                                    }}
                                    disabled={!canCreateOrganization || isSaving}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-violet-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Building2 className="h-3.5 w-3.5" />
                                    Create organization
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenSetupActionMenuId(null);
                                      setPendingSetupAction({
                                        requestId: item.id,
                                        requesterName,
                                        action: 'RETRY_REQUESTER_ADD',
                                      });
                                    }}
                                    disabled={!canRetryRequesterAdd || isSaving}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-emerald-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Users className="h-3.5 w-3.5" />
                                    Retry add requester
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenSetupActionMenuId(null);
                                      setPendingSetupAction({
                                        requestId: item.id,
                                        requesterName,
                                        action: 'FINALIZE_HANDOVER',
                                      });
                                    }}
                                    disabled={!canFinalizeHandover || isSaving}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-emerald-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Finalize handover
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenSetupActionMenuId(null);
                                      setPendingSetupAction({
                                        requestId: item.id,
                                        requesterName,
                                        action: 'MARK_CONTACTED',
                                      });
                                    }}
                                    disabled={!canMarkContacted || isSaving}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-blue-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    Mark contacted
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenSetupActionMenuId(null);
                                      setPendingSetupAction({
                                        requestId: item.id,
                                        requesterName,
                                        action: 'MARK_COMPLETE',
                                      });
                                    }}
                                    disabled={!canMarkCompleted || isSaving}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-emerald-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Mark complete
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenSetupActionMenuId(null);
                                      setPendingSetupAction({
                                        requestId: item.id,
                                        requesterName,
                                        action: 'DECLINE_REQUEST',
                                      });
                                    }}
                                    disabled={!canDecline || isSaving}
                                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <Ban className="h-3.5 w-3.5" />
                                    Decline request
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}

      {pendingSetupAction ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div>
              <h2 className="font-brand text-lg font-semibold tracking-tight text-white">{getSetupActionCopy(pendingSetupAction.action).title}</h2>
              <p className="mt-2 text-sm text-zinc-400">{getSetupActionCopy(pendingSetupAction.action).description}</p>
              <p className="mt-2 text-xs text-zinc-500">Requester: {pendingSetupAction.requesterName}</p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSetupAction(null)}
                disabled={confirmingSetupAction}
                className="inline-flex h-10 items-center rounded-lg border border-zinc-700 px-4 text-xs text-zinc-300 hover:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmPendingSetupAction()}
                disabled={confirmingSetupAction}
                className="inline-flex h-10 items-center rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 text-xs text-blue-200 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmingSetupAction ? 'Processing...' : getSetupActionCopy(pendingSetupAction.action).confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {joinModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div>
              <h2 className="font-brand text-lg font-semibold tracking-tight text-white">Join organization</h2>
              <p className="mt-1 text-xs text-zinc-500">Join with one-time code or accept pending invites.</p>
            </div>

            <div className="mt-4 flex justify-center">
              <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900/60 p-1">
                <button
                  type="button"
                  onClick={() => setJoinMode('JOIN_CODE')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    joinMode === 'JOIN_CODE' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Manual
                </button>
                <button
                  type="button"
                  onClick={() => setJoinMode('PENDING_INVITES')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    joinMode === 'PENDING_INVITES' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Pending invites ({loadingInvites ? '...' : pendingInvites.length})
                </button>
              </div>
            </div>

            {joinMode === 'JOIN_CODE' ? (
              <div className="mt-4 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 h-4 w-4 text-zinc-500" />
                  <p className="text-sm text-zinc-300">Enter one-time workspace credentials</p>
                </div>
                <input
                  type="text"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                  placeholder="Join ID"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Code"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => void handleJoinByCode()}
                  disabled={joining || !joinId.trim() || !code.trim()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                >
                  {joining && <Loader2 className="h-4 w-4 animate-spin" />}
                  {joining ? 'Joining...' : 'Join with code'}
                </button>
              </div>
            ) : (
              <div className="mt-4">
                {loadingInvites ? (
                  <div className="py-10 flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                  </div>
                ) : pendingInvites.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-500">
                    No pending invitations found for your account.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                    {pendingInvites.map((invite) => (
                      <div key={invite.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                        <p className="text-sm font-medium text-white">{invite.organization.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Invited {new Date(invite.createdAt).toLocaleDateString()} as {invite.role}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleAcceptInvite(invite.token)}
                            disabled={actingToken === invite.token}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeclineInvite(invite.token)}
                            disabled={actingToken === invite.token}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            <X className="h-3.5 w-3.5" />
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setJoinModalOpen(false)}
                className="inline-flex items-center justify-center rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GlobalOverviewPageFallback() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
    </div>
  );
}

export default function GlobalOverviewPage() {
  return (
    <Suspense fallback={<GlobalOverviewPageFallback />}>
      <GlobalOverviewPageContent />
    </Suspense>
  );
}
