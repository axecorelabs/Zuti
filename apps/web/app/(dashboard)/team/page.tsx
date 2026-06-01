'use client';

import { useEffect, useState, useCallback } from 'react';
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
  Settings,
  KeyRound,
  Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { orgsApi, invitationsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface Member {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'AGENT';
  specializations?: string[] | null;
  isAvailable?: boolean | null;
  maxConcurrentConversations?: number | null;
  user: { id: string; name: string; email: string };
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  token: string;
}

interface ActiveJoinCode {
  id: string;
  joinId: string;
  role: string;
  createdAt: string;
  expiresAt: string;
}

type TeamJoinMode = 'EMAIL_INVITE' | 'ONE_TIME_CODE';

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
  const { user, getRoleForOrg, activeOrgId, setOrgRoles } = useAuthStore();

  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [myRole, setMyRole] = useState<string | null>(null);
  const canManageWorkspaceAccess = user?.role === 'MANAGER' || myRole === 'OWNER' || myRole === 'ADMIN';
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [joinCodes, setJoinCodes] = useState<ActiveJoinCode[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'AGENT'>('AGENT');
  const [inviting, setInviting] = useState(false);
  const [joinRole, setJoinRole] = useState<'ADMIN' | 'AGENT'>('AGENT');
  const [creatingJoinCode, setCreatingJoinCode] = useState(false);
  const [generatedJoinCode, setGeneratedJoinCode] = useState<{ joinId: string; code: string; role: string } | null>(null);
  const [teamJoinMode, setTeamJoinMode] = useState<TeamJoinMode>('EMAIL_INVITE');

  // Role change dropdown
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [ownershipTransferTarget, setOwnershipTransferTarget] = useState<Member | null>(null);
  const [ownershipTransferInput, setOwnershipTransferInput] = useState('');

  // Remove
  const [removing, setRemoving] = useState<string | null>(null);

  // Agent profile editing
  const [activeMemberPanelId, setActiveMemberPanelId] = useState<string | null>(null);
  const [profileSpecInput, setProfileSpecInput] = useState(''); // comma-separated tags input
  const [profileMaxInput, setProfileMaxInput] = useState(10);

  const loadData = useCallback(async (oid: string, role: string | null) => {
    try {
      const membersPromise = orgsApi.listMembers(oid);

      if (role === 'AGENT' && user?.role !== 'MANAGER') {
        const membersRes = await membersPromise;
        setMembers(membersRes.data);
        setInvites([]);
        setJoinCodes([]);
        return;
      }

      const [membersRes, invitesRes, joinCodesRes] = await Promise.all([
        membersPromise,
        invitationsApi.listByOrg(oid),
        invitationsApi.listJoinCodesByOrg(oid),
      ]);
      setMembers(membersRes.data);
      setInvites(invitesRes.data);
      setJoinCodes(joinCodesRes.data);
    } catch {
      toast.error('Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    orgsApi.list().then((res) => {
      const list = res.data as { id: string; name: string; slug: string; members?: { role: string }[] }[];
      if (!list.length) {
        setOrgId(null);
        setOrgName('');
        setMyRole(null);
        setMembers([]);
        setInvites([]);
        setJoinCodes([]);
        setLoading(false);
        return;
      }
      const preferred = activeOrgId
        ? (list.find((org) => org.id === activeOrgId) ?? list[0])
        : list[0];
      setOrgId(preferred.id);
      setOrgName(preferred.name ?? '');
      const role = preferred.members?.[0]?.role ?? getRoleForOrg(preferred.id) ?? null;
      setMyRole(role ?? null);
      loadData(preferred.id, role);
    }).catch(() => setLoading(false));
  }, [activeOrgId, loadData, getRoleForOrg]);

  const handleInvite = async () => {
    if (!orgId || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      await invitationsApi.create(orgId, inviteEmail.trim(), inviteRole);
      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail('');
      await loadData(orgId, myRole);
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
      await invitationsApi.revoke(token);
      setInvites((prev) => prev.filter((i) => i.token !== token));
      toast.success('Invitation revoked');
    } catch {
      toast.error('Failed to revoke invitation');
    }
  };

  const handleCreateJoinCode = async () => {
    if (!orgId) return;
    setCreatingJoinCode(true);
    try {
      const res = await invitationsApi.createJoinCode(orgId, joinRole);
      const payload = res.data as { joinId: string; code: string; role: string };
      setGeneratedJoinCode(payload);
      toast.success('One-time join code created');
      await loadData(orgId, myRole);
    } catch {
      toast.error('Failed to create one-time join code');
    } finally {
      setCreatingJoinCode(false);
    }
  };

  const copyGeneratedJoinText = async () => {
    if (!generatedJoinCode) return;
    const text = `Join ID: ${generatedJoinCode.joinId}\nCode: ${generatedJoinCode.code}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Join credentials copied');
    } catch {
      toast.error('Failed to copy credentials');
    }
  };

  const handleRevokeJoinCode = async (joinId: string) => {
    if (!confirm(`Revoke one-time join code ${joinId}?`)) return;
    try {
      await invitationsApi.revokeJoinCode(joinId);
      setJoinCodes((prev) => prev.filter((code) => code.joinId !== joinId));
      toast.success('Join code revoked');
    } catch {
      toast.error('Failed to revoke join code');
    }
  };

  const handleAvailabilityToggle = async (member: Member) => {
    if (!orgId) return;
    const next = !(member.isAvailable ?? true);
    setMembers((prev) => prev.map((m) => m.userId === member.userId ? { ...m, isAvailable: next } : m));
    try {
      await orgsApi.updateAgentProfile(orgId, member.userId, { isAvailable: next });
    } catch {
      // Revert on failure
      setMembers((prev) => prev.map((m) => m.userId === member.userId ? { ...m, isAvailable: !next } : m));
      toast.error('Failed to update availability');
    }
  };

  const openMemberPanel = (member: Member) => {
    setActiveMemberPanelId(member.userId);
    setProfileSpecInput((member.specializations ?? []).join(', '));
    setProfileMaxInput(member.maxConcurrentConversations ?? 10);
  };

  const handleSaveProfile = async (userId: string) => {
    if (!orgId) return;
    const specializations = profileSpecInput
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    try {
      const res = await orgsApi.updateAgentProfile(orgId, userId, {
        specializations,
        maxConcurrentConversations: profileMaxInput,
      });
      const updated = res.data as Member;
      setMembers((prev) => prev.map((m) =>
        m.userId === userId
          ? { ...m, specializations: updated.specializations, maxConcurrentConversations: updated.maxConcurrentConversations }
          : m
      ));
      setActiveMemberPanelId(null);
      toast.success('Profile saved');
    } catch {
      toast.error('Failed to save profile');
    }
  };

  const refreshOrgRoleContext = useCallback(async (preferredOrgId: string) => {
    const res = await orgsApi.list({ forceRefresh: true });
    const list = res.data as { id: string; members?: { role: string }[] }[];
    const roles: Record<string, string> = {};
    list.forEach((org) => {
      if (org.members?.[0]?.role) roles[org.id] = org.members[0].role;
    });
    setOrgRoles(roles);
    const current = list.find((org) => org.id === preferredOrgId);
    if (current?.members?.[0]?.role) {
      setMyRole(current.members[0].role);
    }
  }, [setOrgRoles]);

  const handleTransferOwnership = async (member: Member) => {
    if (!orgId) return;

    setChangingRole(member.userId);
    try {
      await orgsApi.transferOwnership(orgId, member.userId);
      setMembers((prev) => prev.map((entry) => {
        if (entry.userId === member.userId) return { ...entry, role: 'OWNER' };
        if (entry.userId === user?.id) return { ...entry, role: 'ADMIN' };
        return entry;
      }));
      setActiveMemberPanelId(null);
      setMyRole('ADMIN');
      await refreshOrgRoleContext(orgId);
      toast.success('Ownership transferred');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ?? 'Failed to transfer ownership';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setChangingRole(null);
      setOwnershipTransferTarget(null);
      setOwnershipTransferInput('');
    }
  };

  const renderTeamJoinMode = () => {
    switch (teamJoinMode) {
      case 'ONE_TIME_CODE':
        return (
          <div className="space-y-4">
            <div className="flex gap-2">
              <select
                value={joinRole}
                onChange={(e) => setJoinRole(e.target.value as 'ADMIN' | 'AGENT')}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-blue-500 transition-colors"
              >
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </select>
              <button
                onClick={handleCreateJoinCode}
                disabled={creatingJoinCode}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {creatingJoinCode ? 'Generating…' : 'Generate ID + code'}
              </button>
            </div>

            {generatedJoinCode && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-zinc-200">Join ID: <span className="font-mono text-white">{generatedJoinCode.joinId}</span></p>
                    <p className="text-zinc-200">Code: <span className="font-mono text-white">{generatedJoinCode.code}</span></p>
                    <p className="text-[11px] text-zinc-400">This code is one-time use. Share it securely.</p>
                  </div>
                  <button
                    onClick={copyGeneratedJoinText}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-800 text-xs text-zinc-500">Active one-time joins ({joinCodes.length})</div>
              {joinCodes.length === 0 ? (
                <div className="px-4 py-6 text-xs text-zinc-600">No active one-time join credentials</div>
              ) : (
                <div className="divide-y divide-zinc-800">
                  {joinCodes.map((entry) => (
                    <div key={entry.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white font-mono">{entry.joinId}</p>
                        <p className="text-xs text-zinc-600">Expires {new Date(entry.expiresAt).toLocaleString()}</p>
                      </div>
                      <RoleBadge role={entry.role} />
                      <button
                        onClick={() => handleRevokeJoinCode(entry.joinId)}
                        className="text-zinc-700 hover:text-red-400 transition-colors"
                        title="Revoke one-time join code"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      case 'EMAIL_INVITE':
      default:
        return (
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
        );
    }
  };

  const activePanelMember = activeMemberPanelId
    ? members.find((member) => member.userId === activeMemberPanelId) ?? null
    : null;

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
          <p className="text-sm text-zinc-500 font-light mt-1">
            {myRole === 'AGENT'
              ? 'Browse your workspace roster and maintain your own agent profile.'
              : 'Manage members and invitations for this workspace.'}
          </p>
        </div>

        {/* Add member */}
        {canManageWorkspaceAccess && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-white">Add member</span>
            </div>
            <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-800/80 p-1">
              <button
                type="button"
                onClick={() => setTeamJoinMode('EMAIL_INVITE')}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  teamJoinMode === 'EMAIL_INVITE' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Email invite
              </button>
              <button
                type="button"
                onClick={() => setTeamJoinMode('ONE_TIME_CODE')}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  teamJoinMode === 'ONE_TIME_CODE' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Join ID + code
              </button>
            </div>
          </div>

          {renderTeamJoinMode()}
        </div>
        )}

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
                const canEditAgentProfile = m.role === 'AGENT' && (myRole === 'OWNER' || myRole === 'ADMIN' || isMe);
                const canTransferOwnership = myRole === 'OWNER' && !isOwner && !isMe;
                const canChangeMemberRole = myRole === 'OWNER' && !isOwner && !isMe;
                const canRemoveMember = !isOwner && !isMe && (myRole === 'OWNER' || myRole === 'ADMIN');
                const canOpenMemberPanel = canEditAgentProfile || canTransferOwnership || canChangeMemberRole || canRemoveMember;
                return (
                  <div key={m.userId} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                        <UserRound className="w-4 h-4 text-zinc-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-white font-normal truncate">{m.user.name}</p>
                          {isMe && <span className="text-[10px] text-zinc-600 font-light">(you)</span>}
                        </div>
                        <p className="text-xs text-zinc-600 truncate">{m.user.email}</p>
                        {/* Specialization tags */}
                        {m.role === 'AGENT' && (m.specializations?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(m.specializations ?? []).map((s) => (
                              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-500 border border-zinc-700">
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <RoleBadge role={m.role} />
                      {/* Availability toggle for any routable role */}
                      {(myRole === 'OWNER' || myRole === 'ADMIN' || isMe) && (
                        <button
                          onClick={() => handleAvailabilityToggle(m)}
                          title={(m.isAvailable ?? true) ? 'Mark unavailable' : 'Mark available'}
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                            (m.isAvailable ?? true)
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-zinc-800 text-zinc-600 border-zinc-700'
                          }`}
                        >
                          {(m.isAvailable ?? true) ? 'Online' : 'Offline'}
                        </button>
                      )}
                      {canOpenMemberPanel && (
                        <button
                          onClick={() => openMemberPanel(m)}
                          title="Open member panel"
                          className="text-zinc-600 hover:text-zinc-300 transition-colors"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending invitations */}
        {canManageWorkspaceAccess && (
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
        )}

      </div>

      {activePanelMember && (
        <>
          <button
            type="button"
            aria-label="Close member panel overlay"
            onClick={() => setActiveMemberPanelId(null)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px]"
          />
          <aside
            className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-200 ease-out ${
              activePanelMember ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-600">Member panel</p>
                <h2 className="mt-1 truncate text-lg font-semibold text-white">{activePanelMember.user.name}</h2>
                <p className="mt-1 truncate text-sm text-zinc-500">{activePanelMember.user.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveMemberPanelId(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {activePanelMember.role === 'AGENT' && (myRole === 'OWNER' || myRole === 'ADMIN' || activePanelMember.userId === user?.id) && (
                <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Agent profile</p>
                    <p className="mt-1 text-xs text-zinc-600">Update routing specialties and concurrency for this agent.</p>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-zinc-500">
                      Specializations <span className="font-light">(comma-separated)</span>
                    </label>
                    <input
                      type="text"
                      value={profileSpecInput}
                      onChange={(e) => setProfileSpecInput(e.target.value)}
                      placeholder="e.g. billing, technical, returns"
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-600 transition-colors focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-zinc-500">
                      Max concurrent conversations
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={profileMaxInput}
                      onChange={(e) => setProfileMaxInput(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                      className="w-28 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white transition-colors focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSaveProfile(activePanelMember.userId)}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                    >
                      Save profile
                    </button>
                    <button
                      onClick={() => setActiveMemberPanelId(null)}
                      className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
                    >
                      Cancel
                    </button>
                  </div>
                </section>
              )}

              {((myRole === 'OWNER' && activePanelMember.role !== 'OWNER' && activePanelMember.userId !== user?.id)
                || (!['OWNER'].includes(activePanelMember.role) && activePanelMember.userId !== user?.id && (myRole === 'OWNER' || myRole === 'ADMIN'))) && (
                <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Action items</p>
                    <p className="mt-1 text-xs text-zinc-600">Apply membership changes for this person from one place.</p>
                  </div>

                  {myRole === 'OWNER' && activePanelMember.role !== 'OWNER' && activePanelMember.userId !== user?.id && (
                    <button
                      onClick={() => {
                        setOwnershipTransferTarget(activePanelMember);
                        setOwnershipTransferInput('');
                      }}
                      disabled={changingRole === activePanelMember.userId || removing === activePanelMember.userId}
                      className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left transition-colors hover:bg-amber-500/15 disabled:opacity-50"
                    >
                      <span className="block text-sm font-medium text-amber-300">Make owner</span>
                      <span className="mt-1 block text-xs text-amber-100/70">Transfer workspace ownership to this member.</span>
                    </button>
                  )}

                  {myRole === 'OWNER' && activePanelMember.role !== 'OWNER' && activePanelMember.userId !== user?.id && (
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-zinc-500">Workspace role</label>
                      <div className="relative">
                        <select
                          value={activePanelMember.role}
                          disabled={changingRole === activePanelMember.userId || removing === activePanelMember.userId}
                          onChange={(e) => handleRoleChange(activePanelMember.userId, e.target.value)}
                          className="w-full appearance-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 pr-8 text-sm text-zinc-300 transition-colors focus:border-blue-500 focus:outline-none disabled:opacity-50"
                        >
                          <option value="ADMIN">Admin</option>
                          <option value="AGENT">Agent</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                      </div>
                    </div>
                  )}

                  {activePanelMember.role !== 'OWNER' && activePanelMember.userId !== user?.id && (myRole === 'OWNER' || myRole === 'ADMIN') && (
                    <button
                      onClick={() => handleRemove(activePanelMember.userId, activePanelMember.user.name)}
                      disabled={changingRole === activePanelMember.userId || removing === activePanelMember.userId}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/15 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove member
                    </button>
                  )}
                </section>
              )}
            </div>
          </aside>
        </>
      )}

      {ownershipTransferTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Close ownership transfer modal"
            onClick={() => setOwnershipTransferTarget(null)}
            className="absolute inset-0 bg-black/70"
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-600">Ownership transfer</p>
                <h2 className="mt-1 text-lg font-semibold text-white">Transfer workspace ownership?</h2>
              </div>
              <button
                type="button"
                onClick={() => setOwnershipTransferTarget(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-zinc-300">
              <p>
                You are about to transfer ownership of this workspace to <span className="font-medium text-white">{ownershipTransferTarget.user.name || ownershipTransferTarget.user.email}</span>.
              </p>
                <p>
                  Workspace: <span className="font-medium text-white">{orgName}</span>
                </p>
              <p>
                After transfer:
              </p>
              <ul className="list-disc pl-5 text-zinc-400">
                <li>The selected member becomes the new owner.</li>
                <li>You will be downgraded to admin.</li>
                <li>Only the new owner will be able to transfer ownership again.</li>
              </ul>
              <div className="space-y-2 pt-2">
                <label className="block text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                  Type the workspace name to confirm
                </label>
                <input
                  type="text"
                  value={ownershipTransferInput}
                  onChange={(event) => setOwnershipTransferInput(event.target.value)}
                  placeholder={orgName || 'Workspace name'}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setOwnershipTransferTarget(null);
                  setOwnershipTransferInput('');
                }}
                className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleTransferOwnership(ownershipTransferTarget)}
                disabled={changingRole === ownershipTransferTarget.userId || ownershipTransferInput.trim() !== orgName}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
              >
                {changingRole === ownershipTransferTarget.userId ? 'Transferring…' : 'Transfer ownership'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
