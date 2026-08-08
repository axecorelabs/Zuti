'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/lib/store';
import { authApi, orgsApi } from '@/lib/api';

type OrgDetails = {
  name: string;
  slug: string;
  deletedAt: string | null;
  role: string | null;
};

export default function SettingsPage() {
  const router = useRouter();
  const { user, activeOrgId, setActiveOrgId } = useAuthStore();
  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const loadOrg = () => {
    if (!activeOrgId) return;
    orgsApi.list().then((res) => {
      const found = (res.data as Array<{ id: string; name: string; slug: string; deletedAt: string | null; members?: Array<{ role: string }> }>).find((o) => o.id === activeOrgId);
      if (found) setOrg({ name: found.name, slug: found.slug, deletedAt: found.deletedAt, role: found.members?.[0]?.role ?? null });
    }).catch(() => {});
  };

  useEffect(() => {
    loadOrg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const handleRestore = async () => {
    if (!activeOrgId) return;
    setRestoring(true);
    try {
      await orgsApi.restoreOrg(activeOrgId);
      toast.success('Organization restored');
      loadOrg();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not restore organization');
    } finally { setRestoring(false); }
  };

  const handleDelete = async () => {
    if (!activeOrgId || !org) return;
    setDeleting(true);
    try {
      await orgsApi.deleteOrg(activeOrgId, confirmText);
      toast.success('Organization deleted. It can be restored within 30 days.');
      setShowDeleteModal(false);
      const remaining = (await orgsApi.list()).data as Array<{ id: string; deletedAt: string | null }>;
      const nextOrg = remaining.find((o) => o.id !== activeOrgId && !o.deletedAt);
      if (nextOrg) {
        setActiveOrgId(nextOrg.id);
        router.replace(`/dashboard?org=${nextOrg.id}`);
      } else {
        router.replace('/onboarding');
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not delete organization');
    } finally { setDeleting(false); }
  };

  const changePassword = async () => {
    if (!currentPassword || newPassword.length < 8) {
      toast.error('Enter your current password and a new password of at least 8 characters.');
      return;
    }
    setChanging(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not update password');
    } finally { setChanging(false); }
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Settings</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Your account and organizer details.</p>
      </div>

      {org?.deletedAt && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">This organization was deleted</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
              It will be permanently removed on {new Date(new Date(org.deletedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}.
              Restore it to keep using it.
            </p>
          </div>
          <button
            onClick={handleRestore}
            disabled={restoring}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-medium shrink-0"
          >
            {restoring ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      )}

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-white">Organizer</h2>
        <div className="text-sm text-zinc-700 dark:text-zinc-300">{org?.name ?? '—'}</div>
        <div className="text-xs text-zinc-400 dark:text-zinc-600">tixtron.app/{org?.slug ?? '—'}</div>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-white">Account</h2>
        <div className="text-sm text-zinc-700 dark:text-zinc-300">{user?.name}</div>
        <div className="text-xs text-zinc-400 dark:text-zinc-600">{user?.email}</div>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-medium text-zinc-900 dark:text-white">Change password</h2>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Current password"
          className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min. 8 characters)"
          className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
        />
        <button
          onClick={changePassword}
          disabled={changing}
          className="px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium"
        >
          {changing ? 'Updating…' : 'Update password'}
        </button>
      </div>

      {org && !org.deletedAt && org.role === 'OWNER' && (
        <div className="rounded-xl border border-red-500/30 p-5 space-y-3">
          <h2 className="text-sm font-medium text-red-600 dark:text-red-400">Danger zone</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Deleting removes this organization from your dashboard immediately. It's kept for 30 days
            in case you change your mind, then permanently erased.
          </p>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-4 py-2 rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 text-sm font-medium"
          >
            Delete organization
          </button>
        </div>
      )}

      {showDeleteModal && org && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-white">Delete {org.name}?</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                Type <span className="font-medium text-zinc-700 dark:text-zinc-300">{org.name}</span> to confirm.
              </p>
            </div>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={org.name}
              className="w-full bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-red-400"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDeleteModal(false); setConfirmText(''); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || confirmText !== org.name}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-medium"
              >
                {deleting ? 'Deleting…' : 'Delete organization'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
