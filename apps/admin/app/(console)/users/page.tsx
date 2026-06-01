'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronRight, Filter, Search, Users2, Mail, CalendarDays, ShieldCheck } from 'lucide-react';
import { adminApi } from '@/lib/api';

type UserItem = {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  role: 'USER' | 'MANAGER';
  createdAt: string;
  memberships: Array<{
    id: string;
    role: 'OWNER' | 'ADMIN' | 'AGENT';
    organization: {
      id: string;
      name: string;
      slug: string;
    };
  }>;
};

const ROLE_ORDER: Array<'ALL' | 'OWNER' | 'ADMIN' | 'AGENT'> = ['ALL', 'OWNER', 'ADMIN', 'AGENT'];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(user: UserItem) {
  return (user.name || user.email).slice(0, 1).toUpperCase();
}

function formatRoleLabel(role: 'OWNER' | 'ADMIN' | 'AGENT') {
  if (role === 'OWNER') return 'Owner';
  if (role === 'ADMIN') return 'Admin';
  return 'Agent';
}

function formatGlobalRoleLabel(role: 'USER' | 'MANAGER') {
  if (role === 'MANAGER') return 'Manager';
  return 'User';
}

function globalRolePillClass(role: 'USER' | 'MANAGER') {
  if (role === 'MANAGER') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
  return 'border-zinc-800 bg-zinc-900/60 text-zinc-500';
}

function rolePillClass(role: 'OWNER' | 'ADMIN' | 'AGENT') {
  if (role === 'OWNER') return 'border-zinc-700 bg-zinc-900/70 text-zinc-200';
  if (role === 'ADMIN') return 'border-zinc-700 bg-zinc-900/70 text-zinc-300';
  return 'border-zinc-700 bg-zinc-900/70 text-zinc-400';
}

export default function UsersPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<UserItem[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'OWNER' | 'ADMIN' | 'AGENT'>('ALL');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [roleSavingUserId, setRoleSavingUserId] = useState<string | null>(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await adminApi.listUsers({ limit: 100 });
        if (!mounted) return;
        const nextItems = Array.isArray(res.data?.items) ? (res.data.items as UserItem[]) : [];
        setItems(nextItems);
        setSelectedUserId(nextItems[0]?.id ?? null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items.filter((item) => {
      const matchesQuery = !normalizedQuery
        || (item.name ?? '').toLowerCase().includes(normalizedQuery)
        || item.email.toLowerCase().includes(normalizedQuery)
        || item.memberships.some((membership) => membership.organization.name.toLowerCase().includes(normalizedQuery));

      const matchesRole = roleFilter === 'ALL'
        || item.memberships.some((membership) => membership.role === roleFilter);

      return matchesQuery && matchesRole;
    });
  }, [items, query, roleFilter]);

  const selectedUser = filteredItems.find((item) => item.id === selectedUserId)
    ?? items.find((item) => item.id === selectedUserId)
    ?? filteredItems[0]
    ?? items[0]
    ?? null;

  const stats = {
    total: items.length,
    admins: items.filter((item) => item.memberships.some((membership) => membership.role !== 'AGENT')).length,
    unassigned: items.filter((item) => item.memberships.length === 0).length,
    filtered: filteredItems.length,
  };

  const openUser = (userId: string) => {
    setSelectedUserId(userId);
    setDrawerOpen(true);
  };

  const updateSelectedUserRole = async (nextRole: 'USER' | 'MANAGER') => {
    if (!selectedUser || selectedUser.role === nextRole) return;

    setRoleSavingUserId(selectedUser.id);
    try {
      const res = await adminApi.updateUserRole(selectedUser.id, nextRole);
      const updatedUser = res.data?.item as Partial<UserItem> | undefined;
      if (updatedUser) {
        setItems((current) => current.map((item) => {
          if (item.id !== updatedUser.id) return item;
          return {
            ...item,
            ...updatedUser,
            memberships: Array.isArray(updatedUser.memberships) ? updatedUser.memberships : item.memberships,
          };
        }));
        setSelectedUserId(updatedUser.id ?? selectedUser.id);
      }
    } finally {
      setRoleSavingUserId(null);
    }
  };

  const closeDrawer = () => setDrawerOpen(false);

  const drawerPanel = (
    <>
      <div
        style={{ top: 0, bottom: 0, height: '100dvh' }}
        className={`fixed right-0 z-50 flex w-full max-w-[22rem] transform flex-col border-l border-zinc-900 bg-zinc-950 shadow-2xl transition-transform duration-200 ease-out ${
          drawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between border-b border-zinc-900 px-4 py-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-600">User details</p>
            <h3 className="mt-1 font-brand text-base text-white">Profile</h3>
          </div>
          <button
            type="button"
            onClick={closeDrawer}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            aria-label="Close drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!selectedUser ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-zinc-500">
            Select a user to inspect details.
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            <div className="border-b border-zinc-900 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-sm text-zinc-300">
                    {getInitials(selectedUser)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="truncate text-sm text-white">{selectedUser.name || 'Unnamed user'}</h4>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{selectedUser.email}</p>
                    <div className="mt-2">
                      <span className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] leading-none ${globalRolePillClass(selectedUser.role)}`}>
                        {formatGlobalRoleLabel(selectedUser.role)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-b border-zinc-900 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-zinc-500">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="text-[10px] uppercase tracking-[0.18em]">Platform role</span>
                </div>
                <span className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] leading-none ${globalRolePillClass(selectedUser.role)}`}>
                  {formatGlobalRoleLabel(selectedUser.role)}
                </span>
              </div>
            </div>

            <div className="space-y-0 border-b border-zinc-900 px-4 py-2">
              <div className="flex items-center justify-between gap-3 border-b border-zinc-900/70 py-3">
                <div className="flex items-center gap-2 text-zinc-500">
                  <Mail className="h-3.5 w-3.5" />
                  <span className="text-[10px] uppercase tracking-[0.18em]">Email</span>
                </div>
                <p className="max-w-[11rem] truncate text-xs text-zinc-300">{selectedUser.email}</p>
              </div>
              <div className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-2 text-zinc-500">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span className="text-[10px] uppercase tracking-[0.18em]">Joined</span>
                </div>
                <p className="text-xs text-zinc-300">{formatDate(selectedUser.createdAt)}</p>
              </div>
            </div>

            <div className="flex-1 px-4 py-4">
              <div className="mb-3 flex items-center gap-2 text-zinc-500">
                <ShieldCheck className="h-3.5 w-3.5" />
                <p className="text-[10px] uppercase tracking-[0.18em]">Workspace roles</p>
              </div>

              <div className="space-y-2">
                {selectedUser.memberships.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-4 text-sm text-zinc-500">
                    No workspace membership yet.
                  </div>
                ) : (
                  selectedUser.memberships.map((membership) => (
                    <div key={membership.id} className="rounded-2xl border border-zinc-900 bg-zinc-900/35 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-white">{membership.organization.name}</p>
                          <p className="mt-0.5 truncate text-xs text-zinc-600">/{membership.organization.slug}</p>
                        </div>
                        <span className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] leading-none ${rolePillClass(membership.role)}`}>
                          {formatRoleLabel(membership.role)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-auto border-t border-zinc-900 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-zinc-200">Manager access</p>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {roleSavingUserId === selectedUser.id
                      ? 'Updating role...'
                      : selectedUser.role === 'MANAGER'
                        ? 'User can create workspaces.'
                        : 'User cannot create workspaces.'}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={selectedUser.role === 'MANAGER'}
                  aria-label="Toggle manager access"
                  onClick={() => updateSelectedUserRole(selectedUser.role === 'MANAGER' ? 'USER' : 'MANAGER')}
                  disabled={roleSavingUserId === selectedUser.id}
                  className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
                    selectedUser.role === 'MANAGER'
                      ? 'border-emerald-400/40 bg-emerald-500/25'
                      : 'border-zinc-700 bg-zinc-800'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full transition-transform ${
                      selectedUser.role === 'MANAGER'
                        ? 'translate-x-6 bg-emerald-300'
                        : 'translate-x-1 bg-zinc-300'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {drawerOpen ? (
        <button
          type="button"
          aria-label="Close user details overlay"
          onClick={closeDrawer}
          style={{ top: 0, bottom: 0, height: '100dvh' }}
          className="fixed inset-x-0 z-40 bg-black/50 backdrop-blur-[1px]"
        />
      ) : null}
    </>
  );

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">User management</h1>
        <p className="mt-1 text-sm font-light text-zinc-500">
          Browse accounts across Zuti, inspect access, and open a minimal detail drawer.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="card p-5">
          <p className="text-xs text-zinc-500">All users</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.total}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Admins</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.admins}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Unassigned</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.unassigned}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-zinc-500">Filtered</p>
          <p className="mt-3 font-brand text-3xl font-semibold tracking-tight text-white">{stats.filtered}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-zinc-800 px-5 py-5 md:px-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="font-brand text-xl text-white">
                All users <span className="text-zinc-500">{filteredItems.length}</span>
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Search by name, email, or workspace and open a detail drawer when needed.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative block sm:min-w-[280px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search users"
                  className="input-base h-11 rounded-2xl border-zinc-700/80 bg-zinc-900/80 pl-11"
                />
              </label>

              <div className="inline-flex h-11 items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 text-sm text-zinc-300">
                <Filter className="h-4 w-4 text-zinc-500" />
                <select
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
                  className="bg-transparent text-sm text-zinc-200 outline-none"
                >
                  {ROLE_ORDER.map((role) => (
                    <option key={role} className="bg-zinc-950" value={role}>
                      {role === 'ALL' ? 'All access' : formatRoleLabel(role)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {ROLE_ORDER.map((role) => {
              const active = roleFilter === role;
              const label = role === 'ALL' ? 'All access' : formatRoleLabel(role);

              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoleFilter(role)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-4 md:p-6">
            {[...Array(6)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-zinc-900 animate-pulse" />)}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-zinc-400">No users match the current filter set.</p>
            <p className="mt-1 text-xs text-zinc-600">Try clearing the search or switching the role filter.</p>
          </div>
        ) : (
          <div>
            <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_120px_120px_30px] gap-4 border-b border-zinc-800/80 px-6 py-3 text-[11px] uppercase tracking-[0.22em] text-zinc-600 md:grid">
              <span>User</span>
              <span>Access</span>
              <span>Workspaces</span>
              <span>Joined</span>
              <span />
            </div>

            <div className="divide-y divide-zinc-800/60">
              {filteredItems.map((item) => {
                const accessRoles = Array.from(new Set(item.memberships.map((membership) => membership.role)));

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openUser(item.id)}
                    className="grid w-full gap-4 px-5 py-4 text-left transition-colors hover:bg-zinc-900/40 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_120px_120px_30px] md:px-6"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-sm text-zinc-300">
                          {getInitials(item)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm text-white">{item.name || 'Unnamed user'}</p>
                            <span className={`inline-flex h-5 items-center justify-center rounded-full border px-2 text-[10px] leading-none ${globalRolePillClass(item.role)}`}>
                              {formatGlobalRoleLabel(item.role)}
                            </span>
                          </div>
                          <p className="truncate text-xs text-zinc-500">{item.email}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {accessRoles.length === 0 ? (
                        <span className="inline-flex h-6 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 text-[11px] leading-none text-zinc-500">
                          No access
                        </span>
                      ) : (
                        accessRoles.map((role) => (
                          <span
                            key={role}
                            className={`inline-flex h-6 items-center justify-center rounded-full border px-2.5 text-[11px] leading-none ${rolePillClass(role)}`}
                          >
                            {formatRoleLabel(role)}
                          </span>
                        ))
                      )}
                    </div>

                    <div className="text-xs text-zinc-400">
                      <p>{item.memberships.length}</p>
                      <p className="mt-1 text-zinc-600">{item.memberships.length === 1 ? 'workspace' : 'workspaces'}</p>
                    </div>

                    <div className="text-xs text-zinc-400">{formatDate(item.createdAt)}</div>

                    <div className="hidden items-center justify-end md:flex">
                      <ChevronRight className="h-4 w-4 text-zinc-600" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {portalReady ? createPortal(drawerPanel, document.body) : null}
    </div>
  );
}
