'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { tixtronOpsApi } from '@/lib/api';
import { useTixtronContext } from '@/lib/use-tixtron-context';

interface CommandBot {
  id: string;
  name: string;
  botType: 'AI' | 'COMMAND';
  telegramUsername: string | null;
  webhookSet: boolean;
}

export default function TixtronBotPage() {
  const { organizationId, organizationName, loading: contextLoading, error: contextError } = useTixtronContext();
  const [bot, setBot] = useState<CommandBot | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('Tixtron Bot');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [settingWebhook, setSettingWebhook] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const res = await tixtronOpsApi.listBots(organizationId);
      const found = (res.data as CommandBot[]).find((b) => b.botType === 'COMMAND') ?? null;
      setBot(found);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);

  const connect = async () => {
    if (!organizationId || !name.trim() || !token.trim()) { setError('Enter a name and the bot token.'); return; }
    setError(null);
    setConnecting(true);
    try {
      const res = await tixtronOpsApi.createBot(organizationId, { name: name.trim(), telegramToken: token.trim(), botType: 'COMMAND' });
      const created = res.data as CommandBot;
      await tixtronOpsApi.setBotWebhook(organizationId, created.id);
      setToken('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not connect bot');
    } finally { setConnecting(false); }
  };

  const registerWebhook = async () => {
    if (!organizationId || !bot) return;
    setSettingWebhook(true);
    try { await tixtronOpsApi.setBotWebhook(organizationId, bot.id); await load(); }
    catch (e: any) { setError(e?.response?.data?.message ?? 'Could not register webhook'); }
    finally { setSettingWebhook(false); }
  };

  const disconnect = async () => {
    if (!organizationId || !bot) return;
    if (!confirm('Disconnect this Telegram bot? Anyone using it will no longer be able to use its commands.')) return;
    setRemoving(true);
    try { await tixtronOpsApi.removeBot(organizationId, bot.id); await load(); }
    catch { setError('Could not disconnect bot'); }
    finally { setRemoving(false); }
  };

  if (contextLoading) return <div className="p-4 md:p-8"><div className="h-40 rounded-2xl bg-zinc-900 animate-pulse" /></div>;
  if (contextError) return <div className="p-4 md:p-8"><div className="card p-6 text-sm text-red-400">{contextError}</div></div>;

  return (
    <div className="space-y-6 p-4 md:p-8 max-w-2xl">
      <div>
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Bot</h1>
        <p className="text-sm text-zinc-500 mt-1">Tixtron HQ&apos;s own Telegram bot — {organizationName}.</p>
      </div>

      {error && <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="h-40 rounded-2xl bg-zinc-900 animate-pulse" />
      ) : (
        <div className="card p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-500/20 flex items-center justify-center shrink-0">
              <Send className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Telegram bot</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Powers Tixtron&apos;s own community deep-links and any events hosted directly by Tixtron.</p>
            </div>
          </div>

          {bot ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">Connected</span>
              </div>
              <p className="text-sm text-zinc-300">{bot.name} · @{bot.telegramUsername}</p>
              {!bot.webhookSet && <p className="text-[11px] text-amber-400 mt-2">Webhook not registered yet — commands won&apos;t reach it.</p>}
              <div className="flex items-center gap-2 mt-3">
                {!bot.webhookSet && (
                  <button onClick={registerWebhook} disabled={settingWebhook} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium">
                    {settingWebhook ? 'Registering…' : 'Register webhook'}
                  </button>
                )}
                <button onClick={disconnect} disabled={removing} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/30 disabled:opacity-40">
                  <Trash2 className="w-3 h-3" /> Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Bot display name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tixtron Bot" className="input-base" />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Telegram bot token</label>
                <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC-DEF..." className="input-base" />
                <p className="text-[11px] text-zinc-600 mt-1">Create a bot with @BotFather on Telegram, then paste its token here.</p>
              </div>
              <button onClick={connect} disabled={connecting} className="btn-primary w-full">
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
                {connecting ? 'Connecting…' : 'Connect bot'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
