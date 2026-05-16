'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Org {
  id: string;
  name: string;
  slug: string;
  members?: Array<{ userId: string; role: string; user: { name: string; email: string } }>;
}

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    orgsApi.list().then(async (res) => {
      const orgs = res.data;
      if (orgs.length > 0) {
        const full = await orgsApi.get(orgs[0].slug);
        setOrg(full.data);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setInviting(true);
    try {
      await orgsApi.inviteMember(org.id, inviteEmail);
      toast.success('Invitation sent');
      setInviteEmail('');
      // Refresh
      const full = await orgsApi.get(org.slug);
      setOrg(full.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to invite member';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!org || !confirm('Remove this member?')) return;
    try {
      await orgsApi.removeMember(org.id, userId);
      setOrg((prev) =>
        prev ? { ...prev, members: prev.members?.filter((m) => m.userId !== userId) } : prev,
      );
      toast.success('Member removed');
    } catch {
      toast.error('Failed to remove member');
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Manage your workspace and team.
        </p>
      </div>

      {/* Workspace info */}
      <div className="card p-6 mb-6">
        <h2 className="font-brand font-semibold text-base tracking-tight text-white mb-4">
          Workspace
        </h2>
        {loading ? (
          <div className="space-y-2">
            <div className="h-4 bg-zinc-800 animate-pulse rounded w-40" />
            <div className="h-4 bg-zinc-800 animate-pulse rounded w-28" />
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <p className="text-xs text-zinc-600 font-normal mb-0.5">Name</p>
              <p className="text-sm text-zinc-200 font-light">{org?.name}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-600 font-normal mb-0.5">Slug</p>
              <p className="text-sm text-zinc-400 font-light font-mono">{org?.slug}</p>
            </div>
          </div>
        )}
      </div>

      {/* Team members */}
      <div className="card p-6 mb-6">
        <h2 className="font-brand font-semibold text-base tracking-tight text-white mb-4">
          Team members
        </h2>

        {loading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-10 bg-zinc-800 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-1 mb-4">
            {org?.members?.map((m) => (
              <div key={m.userId} className="flex items-center justify-between py-2.5 px-1 border-b border-zinc-900 last:border-0">
                <div>
                  <p className="text-sm text-zinc-200 font-light">{m.user.name}</p>
                  <p className="text-xs text-zinc-600">{m.user.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded font-normal">
                    {m.role}
                  </span>
                  {m.userId !== user?.id && (
                    <button
                      onClick={() => handleRemove(m.userId)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors font-light"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invite */}
        <form onSubmit={handleInvite} className="flex gap-2">
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="input-base flex-1"
            placeholder="colleague@company.com"
          />
          <button
            type="submit"
            disabled={inviting}
            className="btn-secondary py-2.5 px-5 text-sm shrink-0"
          >
            {inviting ? '…' : 'Invite'}
          </button>
        </form>
      </div>

      {/* Account */}
      <div className="card p-6">
        <h2 className="font-brand font-semibold text-base tracking-tight text-white mb-4">
          Account
        </h2>
        <div className="space-y-2">
          <div>
            <p className="text-xs text-zinc-600 font-normal mb-0.5">Name</p>
            <p className="text-sm text-zinc-200 font-light">{user?.name}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-600 font-normal mb-0.5">Email</p>
            <p className="text-sm text-zinc-400 font-light">{user?.email}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
