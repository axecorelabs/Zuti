'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, Users, User, Mail, AtSign, Shield, Trash2, UserPlus } from 'lucide-react';
import { orgsApi } from '@/lib/api';
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

type Tab = 'workspace' | 'team' | 'account';

const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-orange-500/15 text-orange-400',
  ADMIN: 'bg-blue-500/15 text-blue-400',
  MEMBER: 'bg-zinc-800 text-zinc-500',
};

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [tab, setTab] = useState<Tab>('workspace');

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
      const full = await orgsApi.get(org.slug);
      setOrg(full.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to invite member';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally { setInviting(false); }
  };

  const handleRemove = async (userId: string) => {
    if (!org || !confirm('Remove this member?')) return;
    try {
      await orgsApi.removeMember(org.id, userId);
      setOrg((prev) => prev ? { ...prev, members: prev.members?.filter((m) => m.userId !== userId) } : prev);
      toast.success('Member removed');
    } catch { toast.error('Failed to remove member'); }
  };

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'workspace', label: 'Workspace', icon: Building2 },
    { key: 'team', label: 'Team', icon: Users },
    { key: 'account', label: 'Account', icon: User },
  ];

  const memberCount = org?.members?.length ?? 0;
  const currentMember = org?.members?.find((m) => m.userId === user?.id);
  const displayName = user?.name || currentMember?.user?.name || user?.email || '—';

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">Manage your workspace and account.</p>
      </div>

      {/* Tab nav */}
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
            </div>
          )}
        </div>
      )}

      {/* ── Team tab ── */}
      {tab === 'team' && (
        <div className="space-y-4">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-base text-white">Team members</h2>
              <span className="text-xs text-zinc-600 bg-zinc-900 px-2.5 py-1 rounded-lg">
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
            </div>
            {loading ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => <div key={i} className="h-14 bg-zinc-800/50 animate-pulse rounded-xl" />)}
              </div>
            ) : (
              <div className="space-y-1 mb-6">
                {org?.members?.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between py-3 px-1 rounded-xl hover:bg-zinc-900/50 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-medium text-zinc-400 shrink-0">
                        {m.user.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <div>
                        <p className="text-sm text-zinc-200 font-light">{m.user.name}</p>
                        <p className="text-xs text-zinc-600">{m.user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium ${ROLE_COLORS[m.role] ?? ROLE_COLORS.MEMBER}`}>
                        {m.role}
                      </span>
                      {m.userId !== user?.id && (
                        <button
                          onClick={() => handleRemove(m.userId)}
                          className="p-1.5 rounded-lg text-zinc-700 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Invite form */}
            <div className="border-t border-zinc-900 pt-5">
              <p className="text-xs text-zinc-500 font-medium mb-3 flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5" /> Invite a teammate
              </p>
              <form onSubmit={handleInvite} className="flex gap-2">
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 transition-colors"
                  placeholder="colleague@company.com"
                />
                <button
                  type="submit"
                  disabled={inviting}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors shrink-0"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {inviting ? 'Sending…' : 'Invite'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Account tab ── */}
      {tab === 'account' && (
        <div className="card p-6">
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
                <p className="text-sm text-zinc-200 font-light mt-0.5">
                  {org?.members?.find((m) => m.userId === user?.id)?.role ?? '—'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}