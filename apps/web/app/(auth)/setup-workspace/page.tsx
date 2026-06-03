'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Handshake, Leaf, Loader2, Clock3, Ban, BadgeCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { orgsApi } from '@/lib/api';
import { clearNoWorkspaceFlowChoice, setNoWorkspaceFlowChoice } from '@/lib/no-workspace-flow';
import { useAuthStore } from '@/lib/store';
import { useSearchParams } from 'next/navigation';

type SetupRequestStatus = 'PENDING' | 'CONTACTED' | 'ORG_CREATED' | 'REQUESTER_ADDED' | 'COMPLETED' | 'DECLINED' | 'CANCELED';

type MySetupRequest = {
  id: string;
  status: SetupRequestStatus;
  note?: string | null;
  createdAt: string;
  manager: {
    id: string;
    name?: string | null;
    email: string;
    managerProfile?: {
      displayName?: string | null;
      status?: 'PENDING' | 'VERIFIED' | 'ARCHIVED';
    } | null;
  };
};

type VerifiedManager = {
  id: string;
  displayName: string;
  bio?: string | null;
  specialties?: string[];
  contactEmail: string;
};

type PreferredContactMode = 'EMAIL' | 'PHONE' | 'WHATSAPP' | 'TELEGRAM';

const MY_SETUP_REQUESTS_CACHE_TTL_MS = 5000;
let mySetupRequestsInFlight: Promise<MySetupRequest[]> | null = null;
let mySetupRequestsCache: MySetupRequest[] | null = null;
let mySetupRequestsCacheAt = 0;

async function fetchMySetupRequests(opts?: { force?: boolean }): Promise<MySetupRequest[]> {
  const force = opts?.force ?? false;
  const cacheFresh = Date.now() - mySetupRequestsCacheAt < MY_SETUP_REQUESTS_CACHE_TTL_MS;
  if (!force && mySetupRequestsCache && cacheFresh) {
    return mySetupRequestsCache;
  }

  if (!mySetupRequestsInFlight) {
    mySetupRequestsInFlight = orgsApi
      .listMySetupRequests()
      .then((res) => {
        const items = Array.isArray(res.data?.items) ? (res.data.items as MySetupRequest[]) : [];
        mySetupRequestsCache = items;
        mySetupRequestsCacheAt = Date.now();
        return items;
      })
      .finally(() => {
        mySetupRequestsInFlight = null;
      });
  }

  return mySetupRequestsInFlight;
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

function formatSyncAge(timestamp: number) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isSyncStale(timestamp: number) {
  return Date.now() - timestamp > 90_000;
}

function SetupWorkspacePageContent() {
  const MIN_BUSINESS_NATURE_LENGTH = 20;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading, loadFromStorage } = useAuthStore((s) => ({
    user: s.user,
    isLoading: s.isLoading,
    loadFromStorage: s.loadFromStorage,
  }));
  const [requests, setRequests] = useState<MySetupRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [requestsHydrated, setRequestsHydrated] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncClock, setSyncClock] = useState(0);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [managerModalOpen, setManagerModalOpen] = useState(false);
  const [assigningManager, setAssigningManager] = useState(false);
  const [assignedManager, setAssignedManager] = useState<VerifiedManager | null>(null);
  const [managerNote, setManagerNote] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [preferredContactMode, setPreferredContactMode] = useState<PreferredContactMode>('EMAIL');
  const [contactDetail, setContactDetail] = useState('');
  const [requestingManager, setRequestingManager] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const cameFromJoinWorkspace = searchParams.get('from') === 'join-workspace';

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    if (!cameFromJoinWorkspace) {
      setNoWorkspaceFlowChoice('SETUP_WORKSPACE');
    }
  }, [cameFromJoinWorkspace, user]);

  const loadMyRequests = async (opts?: { background?: boolean; showError?: boolean }) => {
    const background = opts?.background ?? false;
    const showError = opts?.showError ?? true;

    if (!background) {
      setLoadingRequests(true);
    }

    try {
      const items = await fetchMySetupRequests({ force: background });
      setRequests(items);
      setLastSyncedAt(Date.now());
    } catch {
      if (showError) {
        toast.error('Failed to load setup requests');
      }
    } finally {
      setRequestsHydrated(true);
      if (!background) {
        setLoadingRequests(false);
      }
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void loadMyRequests();
  }, [user?.id]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSyncClock((current) => current + 1);
    }, 10_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const refreshState = async () => {
      try {
        const orgsRes = await orgsApi.listSummary({ forceRefresh: true });
        const orgs = Array.isArray(orgsRes.data) ? orgsRes.data : [];
        if (!cancelled && orgs.length > 0) {
          router.replace('/dashboard');
          return;
        }
      } catch {
        // Keep UI stable on transient network failures.
      }

      if (!cancelled) {
        void loadMyRequests({ background: true, showError: false });
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshState();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [user, router]);

  const canCreateWorkspace = user?.canCreateWorkspace !== false;
  const hasPendingRequest = requests.some((request) => request.status === 'PENDING');
  const syncLabel = lastSyncedAt ? `Last synced ${formatSyncAge(lastSyncedAt)}` : 'Syncing...';
  const syncLabelClass = lastSyncedAt && isSyncStale(lastSyncedAt) ? 'text-amber-400' : 'text-zinc-500';

  const cancelSetupRequest = async (requestId: string) => {
    setCancellingId(requestId);
    try {
      const res = await orgsApi.updateSetupRequestStatus(requestId, 'CANCELED');
      const updated = res.data?.item as MySetupRequest | undefined;
      if (updated) {
        setRequests((current) => current.map((item) => (item.id === updated.id ? { ...item, status: updated.status } : item)));
      }
      toast.success('Setup request canceled');
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Could not cancel request');
    } finally {
      setCancellingId(null);
    }
  };

  const autoAssignManager = async () => {
    setAssigningManager(true);
    setAssignedManager(null);
    try {
      const res = await orgsApi.autoAssignVerifiedManager();
      const assigned = (res.data?.item as VerifiedManager | undefined) ?? null;
      if (!assigned) {
        toast.error('No verified managers are currently available');
        return;
      }
      setAssignedManager(assigned);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Could not assign a verified manager right now');
    } finally {
      setAssigningManager(false);
    }
  };

  const openManagerModal = () => {
    setManagerModalOpen(true);
    setManagerNote('');
    setWorkspaceName('');
    setPreferredContactMode('EMAIL');
    setContactDetail('');
    void autoAssignManager();
  };

  const submitAssignedManagerRequest = async () => {
    if (!assignedManager) return;
    const businessNature = managerNote.trim();
    const normalizedWorkspaceName = workspaceName.trim();
    const normalizedContactDetail = contactDetail.trim();
    if (!normalizedWorkspaceName) {
      toast.error('Please provide organization/workspace name');
      return;
    }
    if (normalizedWorkspaceName.length < 2) {
      toast.error('Organization/workspace name must be at least 2 characters');
      return;
    }
    if (!normalizedContactDetail) {
      toast.error('Please provide your contact detail');
      return;
    }
    if (normalizedContactDetail.length < 3) {
      toast.error('Contact detail must be at least 3 characters');
      return;
    }
    if (!businessNature) {
      toast.error('Please specify the nature of your business');
      return;
    }
    if (businessNature.length < MIN_BUSINESS_NATURE_LENGTH) {
      toast.error(`Nature of business must be at least ${MIN_BUSINESS_NATURE_LENGTH} characters`);
      return;
    }
    setRequestingManager(true);
    try {
      await orgsApi.requestWorkspaceSetup({
        managerId: assignedManager.id,
        preferredContactMode,
        contactDetail: normalizedContactDetail,
        workspaceName: normalizedWorkspaceName,
        note: businessNature,
      });
      setManagerModalOpen(false);
      setAssignedManager(null);
      setManagerNote('');
      setWorkspaceName('');
      setPreferredContactMode('EMAIL');
      setContactDetail('');
      setSuccessModalOpen(true);
      await loadMyRequests();
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      toast.error(Array.isArray(message) ? message[0] : message ?? 'Could not send setup request');
    } finally {
      setRequestingManager(false);
    }
  };

  return (
    <div className="min-h-screen bg-black px-6 py-10">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/25">
            <Leaf className="h-4 w-4 text-white" />
          </div>
          <span className="font-brand text-lg font-semibold tracking-tight text-white">Zuti</span>
        </div>

        <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-7">
          <div>
            <h1 className="font-brand text-xl font-semibold tracking-tight text-white">Set up your workspace</h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              Choose how you want to get started. You can switch later from settings.
            </p>
          </div>

          {!requestsHydrated || loadingRequests ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
              <div className="flex items-center gap-2 text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading setup status...
              </div>
            </div>
          ) : !hasPendingRequest ? (
            <>
              <Link
                href={canCreateWorkspace ? '/onboarding' : '#'}
                className={`block rounded-xl border p-4 transition-colors ${
                  canCreateWorkspace
                    ? 'border-zinc-800 bg-zinc-900/50 hover:border-blue-500/40 hover:bg-zinc-900'
                    : 'cursor-not-allowed border-zinc-900 bg-zinc-900/30 opacity-60'
                }`}
                onClick={(e) => {
                  if (!canCreateWorkspace) e.preventDefault();
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-blue-600/15 p-2 text-blue-400">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Create my own workspace</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                      Best for teams ready to self-serve. You will be the initial owner and can invite your team immediately.
                    </p>
                  </div>
                </div>
              </Link>

              <button
                type="button"
                onClick={openManagerModal}
                className="block w-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-left transition-colors hover:border-emerald-500/40 hover:bg-zinc-900"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-emerald-600/15 p-2 text-emerald-400">
                    <Handshake className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Get help from a verified manager</p>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                      We will auto-assign a verified setup manager and let you confirm before proceeding.
                    </p>
                  </div>
                </div>
              </button>
            </>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm text-zinc-300">
              You already have a pending setup request. New setup actions are hidden until it is contacted, completed, declined, or canceled.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                clearNoWorkspaceFlowChoice();
                router.push('/global-overview');
              }}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
            >
              Go to dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                setNoWorkspaceFlowChoice('JOIN_WORKSPACE');
                router.push('/join-workspace');
              }}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
            >
              {cameFromJoinWorkspace ? 'Back to join workspace' : 'Go to join workspace'}
            </button>
          </div>

          <div className="pt-1">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-zinc-500" />
                <p className="text-sm font-medium text-white">Your setup requests</p>
                <span className={`ml-auto text-[11px] ${syncLabelClass}`} key={syncClock}>
                  {syncLabel}
                </span>
              </div>

              {loadingRequests ? (
                <div className="py-6 flex justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
                </div>
              ) : requests.length === 0 ? (
                <p className="text-xs text-zinc-500">No setup requests yet. Request a verified manager to start assisted onboarding.</p>
              ) : (
                <div className="space-y-2">
                  {requests.map((request) => {
                    const managerName = request.manager.managerProfile?.displayName ?? request.manager.name ?? request.manager.email;
                    const canCancel = request.status === 'PENDING' || request.status === 'CONTACTED';
                    return (
                      <div key={request.id} className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-xs text-zinc-200">{managerName}</p>
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="Verified manager" />
                          </div>
                          <span className={`inline-flex h-5 items-center justify-center rounded-full border px-2 text-[10px] leading-none ${statusClass(request.status)}`}>
                            {statusLabel(request.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-500">Requested {formatDate(request.createdAt)}</p>
                        {request.note ? (
                          <p className="mt-1 line-clamp-2 text-[11px] text-zinc-400">{request.note}</p>
                        ) : null}
                        {canCancel ? (
                          <button
                            type="button"
                            onClick={() => void cancelSetupRequest(request.id)}
                            disabled={cancellingId === request.id}
                            className="mt-2 inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {cancellingId === request.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Ban className="h-3 w-3" />}
                            Cancel request
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {managerModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div>
              <h2 className="font-brand text-lg font-semibold tracking-tight text-white">Assigned verified manager</h2>
              <p className="mt-1 text-xs text-zinc-500">Confirm this manager to continue your assisted setup flow.</p>
            </div>

            {assigningManager ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
              </div>
            ) : assignedManager ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-white">{assignedManager.displayName}</p>
                    <BadgeCheck className="h-4 w-4 text-emerald-400" aria-label="Verified manager" />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{assignedManager.contactEmail}</p>
                  {assignedManager.bio ? (
                    <p className="mt-2 text-xs text-zinc-400">{assignedManager.bio}</p>
                  ) : null}
                  {assignedManager.specialties?.length ? (
                    <p className="mt-2 text-[11px] text-zinc-500">Specialties: {assignedManager.specialties.join(', ')}</p>
                  ) : null}
                </div>

                <div>
                  <label className="text-xs text-zinc-400">Organization/workspace name</label>
                  <input
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. Acme Support Workspace"
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-400">Preferred mode of contact</label>
                  <select
                    value={preferredContactMode}
                    onChange={(e) => setPreferredContactMode(e.target.value as PreferredContactMode)}
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  >
                    <option value="EMAIL">Email</option>
                    <option value="PHONE">Phone</option>
                    <option value="WHATSAPP">WhatsApp</option>
                    <option value="TELEGRAM">Telegram</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-400">Contact detail for selected mode</label>
                  <input
                    value={contactDetail}
                    onChange={(e) => setContactDetail(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. you@company.com or +234..."
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-400">Specify the nature of your business</label>
                  <textarea
                    value={managerNote}
                    onChange={(e) => setManagerNote(e.target.value)}
                    rows={3}
                    minLength={MIN_BUSINESS_NATURE_LENGTH}
                    maxLength={1000}
                    placeholder="Describe your business type and what you need help setting up"
                    className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-zinc-500">Minimum {MIN_BUSINESS_NATURE_LENGTH} characters.</p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">No manager is available right now. Please try again shortly.</p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setManagerModalOpen(false);
                  setAssignedManager(null);
                  setManagerNote('');
                }}
                className="inline-flex items-center justify-center rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitAssignedManagerRequest()}
                disabled={
                  !assignedManager
                  || assigningManager
                  || requestingManager
                  || workspaceName.trim().length < 2
                  || contactDetail.trim().length < 3
                  || managerNote.trim().length < MIN_BUSINESS_NATURE_LENGTH
                }
                className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {requestingManager ? 'Proceeding...' : 'Proceed'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {successModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div>
              <h2 className="font-brand text-lg font-semibold tracking-tight text-white">Request submitted</h2>
              <p className="mt-2 text-sm text-zinc-300">
                Setup request sent. <strong>Agent will contact you within 24 hours.</strong>
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  clearNoWorkspaceFlowChoice();
                  setSuccessModalOpen(false);
                  router.push('/global-overview');
                }}
                className="inline-flex items-center justify-center rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
              >
                Go to dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  setNoWorkspaceFlowChoice('JOIN_WORKSPACE');
                  setSuccessModalOpen(false);
                  router.push('/join-workspace');
                }}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                {cameFromJoinWorkspace ? 'Back to join workspace' : 'Go to join workspace'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SetupWorkspaceFallback() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
    </div>
  );
}

export default function SetupWorkspacePage() {
  return (
    <Suspense fallback={<SetupWorkspaceFallback />}>
      <SetupWorkspacePageContent />
    </Suspense>
  );
}
