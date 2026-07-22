'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Building2, User, Mail, AtSign, Shield, Users } from 'lucide-react';
import { authApiExtra, orgApi, resolveOrgId } from '@/lib/api';

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
  const [org, setOrg] = useState<Org | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('workspace');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const orgsRes = await orgApi.listSummary();
        const orgs = orgsRes.data;
        const orgId = resolveOrgId(orgs);
        if (!orgId) return;

        const found = orgs.find((o) => o.id === orgId) ?? null;
        if (!found) return;

        // Try to fetch members list via a direct org detail — if not available,
        // fall back to the summary data which contains the requesting user's role.
        try {
          const detailRes = await fetch(`/api/organizations/${orgId}`, { headers: {} });
          if (!detailRes.ok) throw new Error('no detail');
          const detail = await detailRes.json() as Org & { members?: Member[] };
          setOrg(detail);
        } catch {
          setOrg(found as Org);
        }

        // Extract user info from accessToken payload (base64 decode)
        const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]!));
            setUserId(payload.sub ?? null);
            setUserEmail(payload.email ?? null);
            setUserName(payload.name ?? null);
          } catch { /* ignore */ }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMessage(null);
    if (newPassword.length < 8) {
      setPwMessage({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    setUpdatingPassword(true);
    try {
      await authApiExtra.changePassword(currentPassword, newPassword);
      setPwMessage({ type: 'success', text: 'Password updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Unable to update password';
      setPwMessage({ type: 'error', text: Array.isArray(msg) ? msg[0] : msg });
    } finally {
      setUpdatingPassword(false);
    }
  };

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'workspace', label: 'Workspace', icon: Building2 },
    { key: 'account', label: 'Account', icon: User },
  ];

  const members = org?.members ?? [];
  const memberCount = members.length;
  const currentMember = members.find((m) => m.userId === userId);
  const displayName = userName || currentMember?.user?.name || userEmail || '—';

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">Manage your workspace and account preferences.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-zinc-900 rounded-xl p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all font-normal ${
              tab === key
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-600 hover:text-zinc-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Workspace tab */}
      {tab === 'workspace' && (
        <div className="card p-6 space-y-5 max-w-xl">
          <div className="flex items-center gap-3 pb-5 border-b border-zinc-900">
            <div className="w-12 h-12 rounded-xl bg-blue-600/15 border border-blue-600/20 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              {loading
                ? <div className="w-32 h-5 bg-zinc-800 animate-pulse rounded" />
                : <h2 className="font-semibold text-base text-white">{org?.name}</h2>}
              <p className="text-xs text-zinc-600 font-light mt-0.5">Commerce workspace</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-zinc-800/50 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 py-3 border-b border-zinc-900">
                <Building2 className="w-4 h-4 text-zinc-600" />
                <div>
                  <p className="text-xs text-zinc-600 font-normal">Workspace name</p>
                  <p className="text-sm text-zinc-200 font-light mt-0.5">{org?.name ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 py-3 border-b border-zinc-900">
                <AtSign className="w-4 h-4 text-zinc-600" />
                <div>
                  <p className="text-xs text-zinc-600 font-normal">Slug</p>
                  <p className="text-sm text-zinc-400 font-mono font-light mt-0.5">{org?.slug ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 py-3">
                <Users className="w-4 h-4 text-zinc-600" />
                <div>
                  <p className="text-xs text-zinc-600 font-normal">Members</p>
                  <p className="text-sm text-zinc-200 font-light mt-0.5">
                    {memberCount > 0 ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}` : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Account tab */}
      {tab === 'account' && (
        <div className="card p-6 max-w-xl">
          <div className="flex items-center gap-3 pb-5 border-b border-zinc-900 mb-5">
            <div className="w-12 h-12 rounded-full bg-blue-600/15 border border-blue-600/20 flex items-center justify-center text-lg font-semibold text-blue-400">
              {displayName[0]?.toUpperCase() ?? '?'}
            </div>
            <div>
              <h2 className="font-semibold text-base text-white">{displayName}</h2>
              <p className="text-xs text-zinc-600 font-light mt-0.5">{userEmail}</p>
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
                <p className="text-sm text-zinc-400 font-light mt-0.5">{userEmail ?? '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 py-3 border-b border-zinc-900">
              <Shield className="w-4 h-4 text-zinc-600 shrink-0" />
              <div>
                <p className="text-xs text-zinc-600 font-normal">Role in workspace</p>
                <div className="mt-1.5">
                  {currentMember?.role ? (
                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${ROLE_COLORS[currentMember.role] ?? ROLE_COLORS.AGENT}`}>
                      {currentMember.role}
                    </span>
                  ) : <p className="text-sm text-zinc-500 font-light">—</p>}
                </div>
              </div>
            </div>

            {/* Change password */}
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
              {pwMessage && (
                <p className={`text-xs font-light ${pwMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pwMessage.text}
                </p>
              )}
              <button
                type="submit"
                disabled={updatingPassword}
                className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
              >
                {updatingPassword ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
