'use client';

import { useState } from 'react';
import { Users2, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { communitiesApi } from '@/lib/api';
import { useActiveRole } from '@/lib/use-role';
import type { CommandBot } from './telegram-bot-card';

export interface Community {
  id: string;
  name: string;
  telegramChatId: string;
  telegramChatUsername: string | null;
  isActive: boolean;
  memberCount: number;
}

/** Controlled by the parent Bot page, same pattern as TelegramBotCard — a community can only be
 * attached to a bot that's already connected and has its webhook registered. */
export default function CommunityCard({ orgId, bot, community, onChange }: { orgId: string | undefined; bot: CommandBot | null; community: Community | null; onChange: () => void }) {
  const isOwner = useActiveRole() === 'OWNER';
  const [name, setName] = useState('Ticket Holders');
  const [chatId, setChatId] = useState('');
  const [chatUsername, setChatUsername] = useState('');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!bot?.webhookSet) return null; // nothing to attach a community to yet

  const create = async () => {
    if (!orgId || !name.trim() || !chatId.trim()) { toast.error('Enter a name and the channel ID.'); return; }
    setCreating(true);
    try {
      await communitiesApi.create(orgId, {
        botId: bot.id,
        telegramChatId: chatId.trim(),
        telegramChatUsername: chatUsername.trim() || undefined,
        name: name.trim(),
      });
      toast.success('Community set up');
      setChatId('');
      setChatUsername('');
      onChange();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not set up the community');
    } finally { setCreating(false); }
  };

  const remove = async () => {
    if (!orgId || !community) return;
    if (!confirm('Remove this community? Ticket buyers will no longer be offered an invite.')) return;
    setRemoving(true);
    try { await communitiesApi.remove(orgId, community.id); toast.success('Community removed'); onChange(); }
    catch { toast.error('Could not remove the community'); }
    finally { setRemoving(false); }
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-brand-600/[0.14] border border-brand-600/20 flex items-center justify-center shrink-0">
          <Users2 className="w-4 h-4 text-brand-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Community</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">
            Confirmed ticket buyers get a link to join your Telegram channel — opt-in, never automatic.
          </p>
        </div>
      </div>

      {community ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">Connected</span>
          </div>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{community.name}</p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-1">{community.memberCount.toLocaleString()} joined so far</p>
          {isOwner && (
            <div className="flex items-center gap-2 mt-3">
              <button onClick={remove} disabled={removing} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-red-400 hover:border-red-500/30 disabled:opacity-40">
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          )}
        </div>
      ) : isOwner ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">Community name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ticket Holders" className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">Telegram channel ID</label>
            <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600" />
            <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-1">Add {bot.name} as an admin of your channel first, then paste the channel&apos;s ID here.</p>
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">Channel username (optional)</label>
            <input value={chatUsername} onChange={(e) => setChatUsername(e.target.value)} placeholder="tidesandtribes" className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600" />
          </div>
          <button onClick={create} disabled={creating} className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium inline-flex items-center justify-center gap-2">
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {creating ? 'Setting up…' : 'Set up community'}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs text-amber-300">
          No community set up yet. Ask an owner to set one up.
        </div>
      )}
    </div>
  );
}
