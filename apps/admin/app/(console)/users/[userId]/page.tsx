'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, CheckCircle2, Home, Mail, ShieldCheck, Users2 } from 'lucide-react';
import { adminApi } from '@/lib/api';

type UserDetail = {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
  memberships: Array<{
    id: string;
    role: 'OWNER' | 'ADMIN' | 'AGENT';
    createdAt: string;
    organization: {
      id: string;
      name: string;
      slug: string;
    };
  }>;
};

function formatRoleLabel(role: UserDetail['memberships'][number]['role']) {
  if (role === 'OWNER') return 'Owner';
  if (role === 'ADMIN') return 'Admin';
  return 'Agent';
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(user: UserDetail) {
  return (user.name || user.email).slice(0, 1).toUpperCase();
}

export default function UserDetailsPage({ params }: { params: { userId: string } }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await adminApi.getUser(params.userId);
        if (!mounted) return;
        setUser((res.data?.item ?? null) as UserDetail | null);
      } catch (err: any) {
        if (!mounted) return;
        const msg = err?.response?.data?.message;
        setError(Array.isArray(msg) ? msg[0] : msg || 'Unable to load user details');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [params.userId]);

  const roleSummary = useMemo(() => {
    if (!user) return [];
    return user.memberships.map((membership) => ({
      ...membership,
      label: formatRoleLabel(membership.role),
    }));
  }, [user]);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
          <Link href="/dashboard" className="inline-flex items-center gap-2 hover:text-zinc-300">
            <Home className="h-3.5 w-3.5" />
            Admin
          </Link>
          <span className="text-zinc-700">/</span>
          <Link href="/users" className="inline-flex items-center gap-2 hover:text-zinc-300">
            <Users2 className="h-3.5 w-3.5" />
            Users
          </Link>
          <span className="text-zinc-700">/</span>
          <span className="text-zinc-400">Profile</span>
        </div>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="font-brand text-2xl font-semibold tracking-tight text-white">User profile</h1>
            <p className="mt-1 text-sm font-light text-zinc-500">
              Review one account in detail and return to the table when you’re done.
            </p>
          </div>

          <Link href="/users" className="btn-secondary h-11 rounded-2xl px-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to users
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_360px]">
          <div className="h-[28rem] rounded-[28px] border border-zinc-800 bg-zinc-950/80 animate-pulse" />
          <div className="h-[28rem] rounded-[28px] border border-zinc-800 bg-zinc-950/80 animate-pulse" />
        </div>
      ) : error ? (
        <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/90 p-8 text-center text-sm text-zinc-400">
          <p>{error}</p>
          <Link href="/users" className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-zinc-800 px-4 py-2 text-white hover:bg-zinc-900">
            <ArrowLeft className="h-4 w-4" />
            Back to users
          </Link>
        </div>
      ) : user ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_360px]">
          <section className="space-y-4">
            <div className="card p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-blue-400/20 bg-blue-500/10 text-xl text-blue-100">
                  {getInitials(user)}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-brand text-2xl text-white">{user.name || 'Unnamed user'}</h2>
                  <p className="mt-1 truncate text-sm text-zinc-400">{user.email}</p>
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Active account
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Workspace access</p>
                  <p className="mt-2 text-lg text-white">{user.memberships.length}</p>
                </div>
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Joined</p>
                  <p className="mt-2 text-lg text-white">{formatDate(user.createdAt)}</p>
                </div>
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">User id</p>
                  <p className="mt-2 truncate text-sm text-white">{user.id}</p>
                </div>
              </div>
            </div>

            <div className="card p-6">
              <div className="mb-4 flex items-center gap-2 text-zinc-400">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.18em]">Workspace roles</p>
              </div>

              <div className="space-y-2.5">
                {roleSummary.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-5 text-sm text-zinc-500">
                    This user does not currently belong to any workspace.
                  </div>
                ) : (
                  roleSummary.map((membership) => (
                    <div key={membership.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-white">{membership.organization.name}</p>
                          <p className="mt-1 text-xs text-zinc-500">/{membership.organization.slug}</p>
                        </div>
                        <span className="inline-flex h-6 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 text-[11px] leading-none text-zinc-300">
                          {membership.label}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-4 xl:sticky xl:top-8 xl:self-start">
            <div className="card p-6">
              <div className="mb-4 flex items-center gap-2 text-zinc-400">
                <Mail className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.18em]">Contact</p>
              </div>
              <p className="break-all text-sm text-zinc-200">{user.email}</p>
            </div>

            <div className="card p-6">
              <div className="mb-4 flex items-center gap-2 text-zinc-400">
                <CalendarDays className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-[0.18em]">Lifecycle</p>
              </div>
              <p className="text-sm text-zinc-200">Joined {formatDate(user.createdAt)}</p>
              <p className="mt-2 text-xs text-zinc-500">This detail page is intentionally separate from the table view.</p>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
