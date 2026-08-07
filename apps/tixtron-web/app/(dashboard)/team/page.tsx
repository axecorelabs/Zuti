'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Trash2, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/lib/store';
import { orgsApi, invitationsApi } from '@/lib/api';
import { useActiveRole } from '@/lib/use-role';

interface Member {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
  user: { id: string; name: string; email: string };
}

interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
}

const ROLES = ['ADMIN', 'AGENT'] as const;

export default function TeamPage() {
  const { activeOrgId, user } = useAuthStore();
  const isOwner = useActiveRole() === 'OWNER';
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'AGENT'>('AGENT');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        orgsApi.listMembers(activeOrgId),
        invitationsApi.listByOrg(activeOrgId),
      ]);
      setMembers(membersRes.data ?? []);
      setInvites(invitesRes.data ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [activeOrgId]);
  useEffect(() => { void load(); }, [load]);

  const sendInvite = async () => {
    if (!activeOrgId || !email.trim()) return;
    setInviting(true);
    try {
      await invitationsApi.create(activeOrgId, email.trim().toLowerCase(), role);
      toast.success('Invitation sent');
      setEmail('');
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not send invitation');
    } finally { setInviting(false); }
  };

  const removeMember = async (userId: string) => {
    if (!activeOrgId) return;
    if (!confirm('Remove this team member?')) return;
    try { await orgsApi.removeMember(activeOrgId, userId); toast.success('Removed'); await load(); }
    catch { toast.error('Could not remove member'); }
  };

  const changeRole = async (userId: string, newRole: string) => {
    if (!activeOrgId) return;
    try { await orgsApi.updateMemberRole(activeOrgId, userId, newRole); await load(); }
    catch { toast.error('Could not change role'); }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="h-32 rounded-xl bg-zinc-100 dark:bg-zinc-900 animate-pulse max-w-2xl mx-auto" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Team</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Who can manage events and tickets in this organizer account.</p>
      </div>

      {isOwner && (
        <div className="card p-5 space-y-3">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-white">Invite a teammate</h2>
          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="flex-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'ADMIN' | 'AGENT')}
              className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 text-sm text-zinc-700 dark:text-zinc-300 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            >
              {ROLES.map((r) => <option key={r} value={r}>{r === 'ADMIN' ? 'Admin' : 'Agent'}</option>)}
            </select>
            <button
              onClick={sendInvite}
              disabled={inviting || !email.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium"
            >
              <UserPlus className="w-3.5 h-3.5" /> Invite
            </button>
          </div>
        </div>
      )}

      <div className="card divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
        {members.map((m) => (
          <div key={m.userId} className="flex items-center justify-between px-5 py-3">
            <div className="min-w-0">
              <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">{m.user.name || m.user.email}</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 truncate">{m.user.email}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isOwner && m.userId !== user?.id ? (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.userId, e.target.value)}
                  className="bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                >
                  {['ADMIN', 'AGENT'].map((r) => <option key={r} value={r}>{r === 'ADMIN' ? 'Admin' : 'Agent'}</option>)}
                </select>
              ) : (
                <span className="text-xs px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">{m.role}</span>
              )}
              {isOwner && m.userId !== user?.id && (
                <button onClick={() => removeMember(m.userId)} className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-500 hover:text-red-400 hover:bg-zinc-200 dark:hover:bg-zinc-800" aria-label="Remove member">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {invites.length > 0 && (
        <div className="card divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
          <div className="px-5 py-2.5"><p className="text-xs text-zinc-500 dark:text-zinc-500">Pending invitations</p></div>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-600 shrink-0" />
                <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{inv.email}</span>
              </div>
              <span className="text-xs px-2 py-1 rounded-md bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-500 shrink-0">{inv.role}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
