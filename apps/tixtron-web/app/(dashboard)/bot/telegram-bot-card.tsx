'use client';

import { useState } from 'react';
import { Send, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { botsApi } from '@/lib/api';
import { useActiveRole } from '@/lib/use-role';

export interface CommandBot {
  id: string;
  name: string;
  botType: 'AI' | 'COMMAND';
  telegramUsername: string | null;
  webhookSet: boolean;
}

/** Controlled by the parent Bot page — it owns the `bot` state so it can also drive the stats
 * fetch off the same connected bot, without two components independently discovering it. */
export default function TelegramBotCard({ orgId, bot, onChange }: { orgId: string | undefined; bot: CommandBot | null; onChange: () => void }) {
  const isOwner = useActiveRole() === 'OWNER';
  const [name, setName] = useState('Ticket Bot');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [settingWebhook, setSettingWebhook] = useState(false);
  const [removing, setRemoving] = useState(false);

  const connect = async () => {
    if (!orgId || !name.trim() || !token.trim()) { toast.error('Enter a name and the bot token.'); return; }
    setConnecting(true);
    try {
      const res = await botsApi.create(orgId, { name: name.trim(), telegramToken: token.trim(), botType: 'COMMAND' });
      const created = res.data as CommandBot;
      await botsApi.setWebhook(orgId, created.id);
      toast.success('Telegram bot connected');
      setToken('');
      onChange();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not connect bot');
    } finally { setConnecting(false); }
  };

  const registerWebhook = async () => {
    if (!orgId || !bot) return;
    setSettingWebhook(true);
    try { await botsApi.setWebhook(orgId, bot.id); toast.success('Webhook registered'); onChange(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Could not register webhook'); }
    finally { setSettingWebhook(false); }
  };

  const disconnect = async () => {
    if (!orgId || !bot) return;
    if (!confirm('Disconnect this Telegram bot? Customers will no longer be able to use its commands.')) return;
    setRemoving(true);
    try { await botsApi.remove(orgId, bot.id); toast.success('Bot disconnected'); onChange(); }
    catch { toast.error('Could not disconnect bot'); }
    finally { setRemoving(false); }
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-500/20 flex items-center justify-center shrink-0">
          <Send className="w-4 h-4 text-sky-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Telegram bot</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">
            A lightweight bot customers can message for /events and /mytickets — no AI, just fixed commands.
          </p>
        </div>
      </div>

      {bot ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">Connected</span>
          </div>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{bot.name} · @{bot.telegramUsername}</p>
          {!bot.webhookSet && (
            <p className="text-[11px] text-amber-400 mt-2">Webhook not registered yet — commands won&apos;t reach it.</p>
          )}
          {isOwner && (
            <div className="flex items-center gap-2 mt-3">
              {!bot.webhookSet && (
                <button onClick={registerWebhook} disabled={settingWebhook} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium">
                  {settingWebhook ? 'Registering…' : 'Register webhook'}
                </button>
              )}
              <button onClick={disconnect} disabled={removing} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-red-400 hover:border-red-500/30 disabled:opacity-40">
                <Trash2 className="w-3 h-3" /> Disconnect
              </button>
            </div>
          )}
        </div>
      ) : isOwner ? (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">Bot display name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ticket Bot" className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">Telegram bot token</label>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF..." className="w-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-600" />
            <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-1">Create a bot with @BotFather on Telegram, then paste its token here.</p>
          </div>
          <button onClick={connect} disabled={connecting} className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium inline-flex items-center justify-center gap-2">
            {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {connecting ? 'Connecting…' : 'Connect bot'}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs text-amber-300">
          No Telegram bot connected. Ask an owner to connect one.
        </div>
      )}
    </div>
  );
}
