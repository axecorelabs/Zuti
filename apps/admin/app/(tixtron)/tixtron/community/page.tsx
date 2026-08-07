'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users2, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { tixtronOpsApi } from '@/lib/api';
import { useTixtronContext } from '@/lib/use-tixtron-context';

interface CommandBot { id: string; name: string; botType: 'AI' | 'COMMAND'; telegramUsername: string | null; webhookSet: boolean }
interface Community { id: string; name: string; telegramChatId: string; telegramChatUsername: string | null; isActive: boolean; memberCount: number }

export default function TixtronCommunityPage() {
  const { organizationId, loading: contextLoading, error: contextError } = useTixtronContext();
  const [bot, setBot] = useState<CommandBot | null>(null);
  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('Tixtron Community');
  const [chatId, setChatId] = useState('');
  const [chatUsername, setChatUsername] = useState('');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const botsRes = await tixtronOpsApi.listBots(organizationId);
      setBot((botsRes.data as CommandBot[]).find((b) => b.botType === 'COMMAND') ?? null);
      const communityRes = await tixtronOpsApi.getCommunity(organizationId);
      setCommunity(communityRes.data ?? null);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!organizationId || !bot || !name.trim() || !chatId.trim()) { setError('Enter a name and the channel ID.'); return; }
    setError(null);
    setCreating(true);
    try {
      await tixtronOpsApi.createCommunity(organizationId, {
        botId: bot.id, telegramChatId: chatId.trim(), telegramChatUsername: chatUsername.trim() || undefined, name: name.trim(),
      });
      setChatId(''); setChatUsername('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not set up the community');
    } finally { setCreating(false); }
  };

  const remove = async () => {
    if (!organizationId || !community) return;
    if (!confirm('Remove this community?')) return;
    setRemoving(true);
    try { await tixtronOpsApi.removeCommunity(organizationId, community.id); await load(); }
    catch { setError('Could not remove the community'); }
    finally { setRemoving(false); }
  };

  if (contextLoading) return <div className="p-4 md:p-8"><div className="h-40 rounded-2xl bg-zinc-900 animate-pulse" /></div>;
  if (contextError) return <div className="p-4 md:p-8"><div className="card p-6 text-sm text-red-400">{contextError}</div></div>;

  return (
    <div className="space-y-6 p-4 md:p-8 max-w-2xl">
      <div>
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Community</h1>
        <p className="text-sm text-zinc-500 mt-1">The platform-wide Tixtron community — every ticket buyer, across every organizer, can opt into this one.</p>
      </div>

      {error && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="h-40 rounded-2xl bg-zinc-900 animate-pulse" />
      ) : !bot?.webhookSet ? (
        <div className="card p-6 text-sm text-amber-400">Connect and register the Tixtron bot first, on the Bot page, before setting up the community.</div>
      ) : (
        <div className="card p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-600/[0.14] border border-orange-600/20 flex items-center justify-center shrink-0">
              <Users2 className="w-4 h-4 text-orange-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Telegram community</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Confirmed ticket buyers from any organizer get a link to join — opt-in, never automatic.</p>
            </div>
          </div>

          {community ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">Connected</span>
              </div>
              <p className="text-sm text-zinc-300">{community.name}</p>
              <p className="text-[11px] text-zinc-500 mt-1">{community.memberCount.toLocaleString()} joined so far</p>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={remove} disabled={removing} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/30 disabled:opacity-40">
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Community name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Telegram channel ID</label>
                <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" className="input-base" />
                <p className="text-[11px] text-zinc-600 mt-1">Add {bot.name} as an admin of the channel first, then paste the channel&apos;s ID here.</p>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Channel username (optional)</label>
                <input value={chatUsername} onChange={(e) => setChatUsername(e.target.value)} placeholder="tixtronevents" className="input-base" />
              </div>
              <button onClick={create} disabled={creating} className="btn-primary w-full">
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
                {creating ? 'Setting up…' : 'Set up community'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
