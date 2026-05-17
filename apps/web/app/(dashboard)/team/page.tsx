'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  UserPlus,
  Trash2,
  ChevronDown,
  Mail,
  ShieldCheck,
  Crown,
  UserRound,
  X,
  Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { orgsApi, invitationsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Member {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
  user: { id: string; name: string; email: string };
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  token: string;
}

const ROLE_LABELS: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', AGENT: 'Agent' };

const RoleBadge = ({ role }: { role: string }) => {
  const colors: Record<string, string> = {
    OWNER: 'bg-amber-500/15 text-amber-400 border border-amber-500/20',
    ADMIN: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
    AGENT: 'bg-zinc-700/40 text-zinc-400 border border-zinc-700',
  };
  const icons: Record<string, React.ReactNode> = {
    OWNER: <Crown className="w-3 h-3" />,
    ADMIN: <ShieldCheck className="w-3 h-3" />,
    AGENT: <UserRound className="w-3 h-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-lg ${colors[role] ?? colors.AGENT}`}>
      {icons[role]}
      {ROLE_LABELS[role] ?? role}
    </span>
  );
};

export default function TeamPage() {
  const router = useRouter();
  const { user, getRoleForOrg } = useAuthStore();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'AGENT'>('AGENT');
  const [inviting, setInviting] = useState(false);

  // Role change dropdown
  const [changingRole, setChangingRole] = useState<string | null>(null);

  // Remove
  const [removing, setRemoving] = useState<string | null>(null);

  const loadData = useCallback(async (oid: string) => {
    try {
      const [membersRes, invitesRes] = await Promise.all([
        orgsApi.listMembers(oid),
        invitationsApi.listByOrg(oid),
      ]);
      setMembers(membersRes.data);
      setInvites(invitesRes.data);
    } catch {
      toast.error('Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    orgsApi.list().then((res) => {
      const list = res.data as { id: string; slug: string; members?: { role: string }[] }[];
      if (!list.length) return;
      const first = list[0];
      setOrgId(first.id);
      const role = first.members?.[0]?.role ?? getRoleForOrg(first.id);
      setMyRole(role ?? null);
      if (role === 'AGENT') {
        // Agents can't manage team
        router.replace('/inbox');
        return;
      }
      loadData(first.id);
    }).catch(() => setLoading(false));
  }, [loadData, getRoleForOrg, router]);

  const handleInvite = async () => {
    if (!orgId || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      await invitationsApi.create(orgId, inviteEmail.trim(), inviteRole);
      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail('');
      await loadData(orgId);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to send invite';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    if (!orgId) return;
    setChangingRole(userId);
    try {
      await orgsApi.updateMemberRole(orgId, userId, role);
      setMembers((prev) =>
        prev.map((m) => m.userId === userId ? { ...m, role: role as Member['role'] } : m),
      );
      toast.success('Role updated');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update role';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setChangingRole(null);
    }
  };

  const handleRemove = async (userId: string, name: string) => {
    if (!orgId) return;
    if (!confirm(`Remove ${name} from this workspace?`)) return;
    setRemoving(userId);
    try {
      await orgsApi.removeMember(orgId, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      toast.success(`${name} removed`);
    } catch {
      toast.error('Failed to remove member');
    } finally {
      setRemoving(null);
    }
  };

  const handleRevokeInvite = async (token: string, email: string) => {
    if (!confirm(`Revoke invitation for ${email}?`)) return;
    try {
      await invitationsApi.decline(token);
      setInvites((prev) => prev.filter((i) => i.token !== token));
      toast.success('Invitation revoked');
    } catch {
      toast.error('Failed to revoke invitation');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen bg-zinc-950">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-screen bg-zinc-950 p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-white">Team</h1>
          <p className="text-sm text-zinc-500 font-light mt-1">Manage members and invitations for this workspace.</p>
        </div>

        {/* Invite form */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-white">Invite member</span>
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'ADMIN' | 'AGENT')}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-blue-500 transition-colors"
            >
              <option value="ADMIN">Admin</option>
              <option value="AGENT">Agent</option>
            </select>
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {inviting ? 'Sending…' : 'Invite'}
            </button>
          </div>
        </div>

        {/* Members table */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-white">Members</span>
            <span className="ml-auto text-xs text-zinc-600">{members.length}</span>
          </div>
          {members.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-600 font-light">No members found</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {members.map((m) => {
                const isMe = m.userId === user?.id;
                const isOwner = m.role === 'OWNER';
                const busy = changingRole === m.userId || removing === m.userId;
                return (
                  <div key={m.userId} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                      <UserRound className="w-4 h-4 text-zinc-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-white font-normal truncate">{m.user.name}</p>
                        {isMe && <span className="text-[10px] text-zinc-600 font-light">(you)</span>}
                      </div>
                      <p className="text-xs text-zinc-600 truncate">{m.user.email}</p>
                    </div>
                    <RoleBadge role={m.role} />
                    {/* Role change — OWNER only, can't change OWNER or self */}
                    {myRole === 'OWNER' && !isOwner && !isMe && (
                      <div className="relative">
                        <select
                          value={m.role}
                          disabled={busy}
                          onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                          className="bg-zinc-800 border border-zinc-700 rounded-lg pl-2 pr-6 py-1 text-xs text-zinc-400 focus:outline-none focus:border-blue-500 transition-colors appearance-none disabled:opacity-50"
                        >
                          <option value="ADMIN">Admin</option>
                          <option value="AGENT">Agent</option>
                        </select>
                        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-600 pointer-events-none" />
                      </div>
                    )}
                    {/* Remove — OWNER/ADMIN can remove others (not OWNER, not self) */}
                    {!isOwner && !isMe && (
                      <button
                        onClick={() => handleRemove(m.userId, m.user.name)}
                        disabled={busy}
                        title="Remove member"
                        className="text-zinc-700 hover:text-red-400 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending invitations */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
            <Mail className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-white">Pending invitations</span>
            <span className="ml-auto text-xs text-zinc-600">{invites.length}</span>
          </div>
          {invites.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-600 font-light">No pending invitations</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4 text-zinc-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-normal truncate">{inv.email}</p>
                    <p className="text-xs text-zinc-600 truncate">
                      Sent {new Date(inv.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <RoleBadge role={inv.role} />
                  <button
                    onClick={() => handleRevokeInvite(inv.token, inv.email)}
                    title="Revoke invitation"
                    className="text-zinc-700 hover:text-red-400 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
