'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Leaf, KeyRound, Check, X, Loader2 } from 'lucide-react';
import { invitationsApi, orgsApi } from '@/lib/api';
import { setNoWorkspaceFlowChoice } from '@/lib/no-workspace-flow';
import { useAuthStore } from '@/lib/store';

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

type JoinMode = 'JOIN_CODE' | 'PENDING_INVITES';

export default function JoinWorkspacePage() {
  const router = useRouter();
  const { user, isLoading, loadFromStorage, clearAuth } = useAuthStore((s) => ({
    user: s.user,
    isLoading: s.isLoading,
    loadFromStorage: s.loadFromStorage,
    clearAuth: s.clearAuth,
  }));

  const [joinId, setJoinId] = useState('');
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [actingToken, setActingToken] = useState<string | null>(null);
  const [joinMode, setJoinMode] = useState<JoinMode>('JOIN_CODE');

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
    setLoadingInvites(true);
    invitationsApi.listMine()
      .then((res) => {
        setPendingInvites(res.data as PendingInvite[]);
      })
      .catch(() => {
        toast.error('Failed to load pending invitations');
      })
      .finally(() => setLoadingInvites(false));
  }, [user]);

  const handleJoinByCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!joinId.trim() || !code.trim()) return;

    setJoining(true);
    setNoWorkspaceFlowChoice('JOIN_WORKSPACE');
    try {
      await invitationsApi.redeemJoinCode(joinId.trim().toUpperCase(), code.trim());
      toast.success('Workspace joined successfully');
      router.replace('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Failed to join workspace';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setJoining(false);
    }
  };

  const handleAcceptInvite = async (token: string) => {
    setActingToken(token);
    setNoWorkspaceFlowChoice('JOIN_WORKSPACE');
    try {
      await invitationsApi.accept(token);
      toast.success('Invitation accepted');
      router.replace('/dashboard');
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
      setPendingInvites((prev) => prev.filter((inv) => inv.token !== token));
      toast.success('Invitation declined');
    } catch {
      toast.error('Failed to decline invitation');
    } finally {
      setActingToken(null);
    }
  };

  const renderJoinMode = () => {
    switch (joinMode) {
      case 'PENDING_INVITES':
        if (loadingInvites) {
          return (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
            </div>
          );
        }

        if (pendingInvites.length === 0) {
          return (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-500">
              No pending invitations found for your account.
            </div>
          );
        }

        return (
          <div className="space-y-3">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="text-sm font-medium text-white">{invite.organization.name}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Invited {new Date(invite.createdAt).toLocaleDateString()} as {invite.role}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleAcceptInvite(invite.token)}
                    disabled={actingToken === invite.token}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Accept
                  </button>
                  <button
                    onClick={() => handleDeclineInvite(invite.token)}
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
        );
      case 'JOIN_CODE':
        return (
          <form onSubmit={handleJoinByCode} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
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
              type="submit"
              disabled={joining || !joinId.trim() || !code.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {joining && <Loader2 className="h-4 w-4 animate-spin" />}
              {joining ? 'Joining...' : 'Join with code'}
            </button>
          </form>
        );
      default:
        return null;
    }
  };

  const handleGoToDashboard = () => {
    router.replace('/global-overview');
  };

  return (
    <div className="min-h-screen bg-black px-6 py-10">
      <div className="mx-auto w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <span className="font-brand font-semibold text-lg tracking-tight text-white">Zuti</span>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-7 space-y-4">
          <div>
            <h1 className="font-brand font-semibold text-xl tracking-tight text-white">Join a workspace</h1>
          </div>

          <div className="flex justify-center">
            <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900/60 p-1">
              <button
                type="button"
                onClick={() => {
                  setNoWorkspaceFlowChoice('JOIN_WORKSPACE');
                  setJoinMode('JOIN_CODE');
                }}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  joinMode === 'JOIN_CODE' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => {
                  setNoWorkspaceFlowChoice('JOIN_WORKSPACE');
                  setJoinMode('PENDING_INVITES');
                }}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  joinMode === 'PENDING_INVITES' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Pending invites ({loadingInvites ? '...' : pendingInvites.length})
              </button>
            </div>
          </div>

          {renderJoinMode()}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleGoToDashboard}
              className="inline-flex w-full items-center justify-center rounded-lg border border-zinc-800 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-900 transition-colors"
            >
              Go to dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                setNoWorkspaceFlowChoice('SETUP_WORKSPACE');
                router.push('/setup-workspace?from=join-workspace');
              }}
              className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm text-white hover:bg-blue-500 transition-colors"
            >
              Set up my own workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}