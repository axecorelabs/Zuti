'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/lib/store';
import { authApi, orgsApi } from '@/lib/api';

export default function SettingsPage() {
  const { user, activeOrgId } = useAuthStore();
  const [org, setOrg] = useState<{ name: string; slug: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (!activeOrgId) return;
    orgsApi.list().then((res) => {
      const found = (res.data as Array<{ id: string; name: string; slug: string }>).find((o) => o.id === activeOrgId);
      if (found) setOrg({ name: found.name, slug: found.slug });
    }).catch(() => {});
  }, [activeOrgId]);

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
    </div>
  );
}
