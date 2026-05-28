'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, Users, User, Mail, AtSign, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi, orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Member {
  userId: string;
  role: string;
  user: { name: string; email: string };
}

interface Org {
  id: string;
  name: string;
  slug: string;
  members?: Member[];
}

type Tab = 'workspace' | 'account';

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-orange-500/15 text-orange-400',
  ADMIN: 'bg-blue-500/15 text-blue-400',
  AGENT: 'bg-zinc-800 text-zinc-400',
};

export default function SettingsPage() {
  const { user, activeOrgId } = useAuthStore();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('workspace');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  useEffect(() => {
    orgsApi.list().then(async (res) => {
      const orgs = res.data as Org[];
      if (orgs.length > 0) {
        const preferred = activeOrgId
          ? (orgs.find((currentOrg) => currentOrg.id === activeOrgId) ?? orgs[0])
          : orgs[0];
        const membersRes = await orgsApi.listMembers(preferred.id).catch(() => ({ data: [] }));
        setOrg({ ...preferred, members: membersRes.data });
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [activeOrgId]);

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'workspace', label: 'Workspace', icon: Building2 },
    { key: 'account', label: 'Account', icon: User },
  ];

  const memberCount = org?.members?.length ?? 0;
  const currentMember = org?.members?.find((m) => m.userId === user?.id);
  const canManageForwarding = currentMember?.role === 'OWNER';
  const displayName = user?.name || currentMember?.user?.name || user?.email || '—';

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New password and confirmation do not match.');
      return;
    }

    setUpdatingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ??
        'Unable to update password';
      const normalized = Array.isArray(msg) ? msg[0] : msg;
      toast.error(normalized);
    } finally {
      setUpdatingPassword(false);
    }
  };

  return (
    <div className="settings-page w-full px-4 py-4 md:px-8 md:py-8">
      <div className="mx-auto w-full max-w-5xl lg:max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">Manage your workspace and account.</p>
      </div>

      {/* Tab nav */}
      <div className="settings-tabs flex gap-1 mb-6 bg-zinc-900 rounded-xl p-1 w-fit mx-auto md:mx-0">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`settings-tab-btn flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all font-normal ${
              tab === key
                ? 'is-active bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Workspace tab ── */}
      {tab === 'workspace' && (
        <div className="card p-6 space-y-5">
          <div className="flex items-center gap-3 pb-5 border-b border-zinc-900">
            <div className="w-12 h-12 rounded-xl bg-blue-600/15 border border-blue-600/20 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              {loading
                ? <div className="w-32 h-5 bg-zinc-800 animate-pulse rounded" />
                : <h2 className="font-semibold text-base text-white">{org?.name}</h2>}
              <p className="text-xs text-zinc-600 font-light mt-0.5">Workspace</p>
            </div>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => <div key={i} className="h-12 bg-zinc-800/50 animate-pulse rounded-xl" />)}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 border-b border-zinc-900">
                <div className="flex items-center gap-2.5">
                  <Building2 className="w-4 h-4 text-zinc-600" />
                  <div>
                    <p className="text-xs text-zinc-600 font-normal">Workspace name</p>
                    <p className="text-sm text-zinc-200 font-light mt-0.5">{org?.name}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between py-3 border-b border-zinc-900">
                <div className="flex items-center gap-2.5">
                  <AtSign className="w-4 h-4 text-zinc-600" />
                  <div>
                    <p className="text-xs text-zinc-600 font-normal">Slug</p>
                    <p className="text-sm text-zinc-400 font-mono font-light mt-0.5">{org?.slug}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-2.5">
                  <Users className="w-4 h-4 text-zinc-600" />
                  <div>
                    <p className="text-xs text-zinc-600 font-normal">Members</p>
                    <p className="text-sm text-zinc-200 font-light mt-0.5">{memberCount} {memberCount === 1 ? 'member' : 'members'}</p>
                  </div>
                </div>
              </div>
              {canManageForwarding && (
                <div className="pt-1">
                  <Link
                    href="/settings/forwarding"
                    className="inline-flex items-center rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-900 transition-colors"
                  >
                    Manage Forwarding Settings
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Account tab ── */}
      {tab === 'account' && (
        <div className="card p-6 md:p-8">
          <div className="flex items-center gap-3 pb-5 border-b border-zinc-900 mb-5">
            <div className="w-12 h-12 rounded-full bg-blue-600/15 border border-blue-600/20 flex items-center justify-center text-lg font-semibold text-blue-400">
              {displayName[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <h2 className="font-semibold text-base text-white">{displayName}</h2>
              <p className="text-xs text-zinc-600 font-light mt-0.5">{user?.email}</p>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center gap-3 py-3 border-b border-zinc-900">
              <User className="w-4 h-4 text-zinc-600 shrink-0" />
              <div>
                <p className="text-xs text-zinc-600 font-normal">Full name</p>
                <p className="text-sm text-zinc-200 font-light mt-0.5">{displayName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 py-3 border-b border-zinc-900">
              <Mail className="w-4 h-4 text-zinc-600 shrink-0" />
              <div>
                <p className="text-xs text-zinc-600 font-normal">Email</p>
                <p className="text-sm text-zinc-400 font-light mt-0.5">{user?.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 py-3">
              <Shield className="w-4 h-4 text-zinc-600 shrink-0" />
              <div>
                <p className="text-xs text-zinc-600 font-normal">Role</p>
                <div className="mt-1.5">
                  <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${ROLE_COLORS[org?.members?.find((m) => m.userId === user?.id)?.role ?? 'AGENT'] ?? ROLE_COLORS.AGENT}`}>
                    {org?.members?.find((m) => m.userId === user?.id)?.role ?? '—'}
                  </span>
                </div>
              </div>
            </div>

            <form onSubmit={handleChangePassword} className="pt-5 border-t border-zinc-900 space-y-4">
              <p className="text-sm text-zinc-300 font-medium">Change password</p>

              <div>
                <label className="block text-xs text-zinc-600 font-normal mb-2">Current password</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="input-base"
                  autoComplete="current-password"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-600 font-normal mb-2">New password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-base"
                  autoComplete="new-password"
                />
              </div>

              <div>
                <label className="block text-xs text-zinc-600 font-normal mb-2">Confirm new password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-base"
                  autoComplete="new-password"
                />
              </div>

              <button
                type="submit"
                disabled={updatingPassword}
                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
              >
                {updatingPassword ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}