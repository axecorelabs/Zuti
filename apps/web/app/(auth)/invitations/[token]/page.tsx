'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Leaf, CheckCircle, XCircle, Clock, Users } from 'lucide-react';
import { invitationsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import toast from 'react-hot-toast';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  organization: { name: string };
  invitedBy: { name?: string; email: string };
}

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [invite, setInvite] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState(false);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);

  useEffect(() => {
    invitationsApi
      .getByToken(token)
      .then((res) => setInvite(res.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    setActing(true);
    try {
      await invitationsApi.accept(token);
      setDone('accepted');
      toast.success(`You joined ${invite?.organization.name}!`);
      setTimeout(() => router.push('/dashboard'), 1500);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to accept invitation';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setActing(false);
    }
  };

  const handleDecline = async () => {
    setActing(true);
    try {
      await invitationsApi.decline(token);
      setDone('declined');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to decline invitation';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setActing(false);
    }
  };

  const isExpired = invite && new Date(invite.expiresAt) < new Date();
  const isAlreadyHandled = invite && invite.status !== 'PENDING';

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-2 mb-10">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/30">
          <Leaf className="w-4 h-4 text-white" />
        </div>
        <span className="font-brand font-semibold text-xl tracking-tight text-white">Zuti</span>
      </Link>

      <div className="w-full max-w-md">
        {loading ? (
          <div className="card p-8 space-y-4">
            <div className="h-6 bg-zinc-800 animate-pulse rounded-lg w-3/4" />
            <div className="h-4 bg-zinc-800 animate-pulse rounded-lg w-1/2" />
            <div className="h-10 bg-zinc-800 animate-pulse rounded-xl w-full mt-4" />
          </div>
        ) : notFound ? (
          <div className="card p-8 text-center">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-white mb-2">Invitation not found</h1>
            <p className="text-sm text-zinc-500 font-light">
              This invitation link is invalid or has already been used.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Go to dashboard →
            </Link>
          </div>
        ) : done === 'accepted' ? (
          <div className="card p-8 text-center">
            <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-white mb-2">Welcome aboard!</h1>
            <p className="text-sm text-zinc-500 font-light">
              You've joined <strong className="text-zinc-300">{invite?.organization.name}</strong>.
              Redirecting you now…
            </p>
          </div>
        ) : done === 'declined' ? (
          <div className="card p-8 text-center">
            <XCircle className="w-10 h-10 text-zinc-500 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-white mb-2">Invitation declined</h1>
            <p className="text-sm text-zinc-500 font-light">
              You've declined the invitation to {invite?.organization.name}.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Go to dashboard →
            </Link>
          </div>
        ) : isExpired || isAlreadyHandled ? (
          <div className="card p-8 text-center">
            <Clock className="w-10 h-10 text-orange-400 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-white mb-2">
              {isExpired ? 'Invitation expired' : `Invitation already ${invite?.status.toLowerCase()}`}
            </h1>
            <p className="text-sm text-zinc-500 font-light">
              {isExpired
                ? 'This invitation link has expired. Ask the workspace owner to send a new one.'
                : 'This invitation has already been processed.'}
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Go to dashboard →
            </Link>
          </div>
        ) : (
          <div className="card p-8">
            {/* Org icon */}
            <div className="flex items-center gap-3 mb-6 pb-6 border-b border-zinc-900">
              <div className="w-12 h-12 rounded-xl bg-blue-600/15 border border-blue-600/20 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-zinc-500 font-light mb-0.5">You're invited to join</p>
                <h1 className="text-xl font-semibold text-white">{invite?.organization.name}</h1>
              </div>
            </div>

            {/* Details */}
            <div className="space-y-3 mb-8">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500 font-light">Invited by</span>
                <span className="text-zinc-200">{invite?.invitedBy.name ?? invite?.invitedBy.email}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500 font-light">Role</span>
                <span className="text-xs px-2 py-0.5 rounded-lg bg-blue-500/15 text-blue-400 font-medium">
                  {invite?.role}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500 font-light">Expires</span>
                <span className="text-zinc-400 font-light">
                  {invite ? new Date(invite.expiresAt).toLocaleDateString() : '—'}
                </span>
              </div>
            </div>

            {/* Logged-in: accept/decline */}
            {user ? (
              <div className="flex gap-3">
                <button
                  onClick={handleAccept}
                  disabled={acting}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {acting ? 'Processing…' : 'Accept invitation'}
                </button>
                <button
                  onClick={handleDecline}
                  disabled={acting}
                  className="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-zinc-400 text-sm font-light transition-colors border border-zinc-800"
                >
                  Decline
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500 text-center font-light">
                  Sign in to accept this invitation
                </p>
                <Link
                  href={`/login?redirect=/invitations/${token}`}
                  className="block w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors text-center"
                >
                  Sign in
                </Link>
                <Link
                  href={`/register?invite=${token}`}
                  className="block w-full py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 text-sm font-light transition-colors text-center border border-zinc-800"
                >
                  Create an account
                </Link>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="mt-10 text-xs text-zinc-700">© 2026 axecorelabs</p>
    </div>
  );
}
