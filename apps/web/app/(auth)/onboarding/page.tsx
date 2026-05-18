'use client';

import { useState } from 'react';
import { Leaf } from 'lucide-react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { orgsApi } from '@/lib/api';

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(toSlug(v));
  };

  const handleSlugChange = (v: string) => {
    setSlugTouched(true);
    setSlug(toSlug(v));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    setLoading(true);
    try {
      await orgsApi.create(name.trim(), slug.trim());
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not create workspace';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="w-full max-w-[460px]">
        {/* Brand */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/25">
            <Leaf className="w-4 h-4 text-white" />
          </div>
          <span className="font-brand font-semibold text-lg tracking-tight text-white">Zuti</span>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-7">
          <h1 className="font-brand font-semibold text-xl tracking-tight text-white">
            Create your workspace
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500 leading-relaxed">
            This is where your team handles support conversations.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Workspace name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme Corp"
                required
                autoFocus
                className="w-full px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Workspace URL
              </label>
              <div className="flex items-center rounded-lg bg-zinc-900 border border-zinc-800 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/30 transition-colors overflow-hidden">
                <span className="pl-3 pr-1 text-sm text-zinc-600 select-none whitespace-nowrap">zuti.app/</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="acme-corp"
                  required
                  className="flex-1 pr-3 py-2.5 bg-transparent text-white text-sm placeholder-zinc-600 focus:outline-none"
                />
              </div>
              <p className="mt-1.5 text-xs text-zinc-600">Lowercase letters, numbers, and hyphens only.</p>
            </div>

            <button
              type="submit"
              disabled={loading || !name.trim() || !slug.trim()}
              className="w-full mt-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {loading ? 'Creating…' : 'Create workspace'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
