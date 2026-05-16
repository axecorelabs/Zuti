'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { orgsApi } from '@/lib/api';

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNameChange = (v: string) => {
    setName(v);
    setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await orgsApi.create(name, slug);
      toast.success('Workspace created!');
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to create workspace';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <span className="font-brand font-semibold text-3xl tracking-tight text-white">
            Zuti
          </span>
          <p className="mt-2 text-sm text-zinc-500 font-light">
            Let's set up your workspace
          </p>
        </div>

        <div className="card p-8">
          <h1 className="font-brand font-semibold text-xl tracking-tight text-white mb-2">
            Name your workspace
          </h1>
          <p className="text-sm text-zinc-500 font-light mb-6">
            This is where your team and bots will live.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 font-normal">
                Workspace name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="input-base"
                placeholder="Acme Support"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1.5 font-normal">
                URL slug
              </label>
              <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden focus-within:border-zinc-600 transition-colors">
                <span className="pl-4 text-zinc-600 text-sm font-light select-none">
                  zuti.app/
                </span>
                <input
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="flex-1 bg-transparent px-1 py-3 text-white text-sm font-light focus:outline-none"
                  placeholder="acme-support"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full mt-2"
            >
              {loading ? 'Creating…' : 'Create workspace'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
