'use client';

import { useEffect, useState } from 'react';
import { Bot, Plus, Webhook, Trash2, ToggleLeft, ToggleRight, Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { botsApi, orgsApi } from '@/lib/api';

interface BotRecord {
  id: string;
  name: string;
  telegramToken: string;
  telegramUsername: string | null;
  isActive: boolean;
  webhookSet: boolean;
  createdAt: string;
}

export default function BotsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', telegramToken: '' });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    orgsApi.list().then((res) => {
      const orgs = res.data;
      if (orgs.length > 0) {
        setOrgId(orgs[0].id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!orgId) return;
    botsApi
      .list(orgId)
      .then((res) => setBots(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    setCreating(true);
    try {
      const res = await botsApi.create(orgId, form.name, form.telegramToken);
      setBots((prev) => [...prev, res.data]);
      setShowCreate(false);
      setForm({ name: '', telegramToken: '' });
      toast.success('Bot created successfully');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to create bot';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setCreating(false);
    }
  };

  const handleSetWebhook = async (bot: BotRecord) => {
    if (!orgId) return;
    try {
      await botsApi.setWebhook(orgId, bot.id);
      setBots((prev) =>
        prev.map((b) => (b.id === bot.id ? { ...b, webhookSet: true } : b)),
      );
      toast.success('Webhook set!');
    } catch {
      toast.error('Failed to set webhook');
    }
  };

  const handleToggle = async (bot: BotRecord) => {
    if (!orgId) return;
    try {
      const res = await botsApi.update(orgId, bot.id, { isActive: !bot.isActive });
      setBots((prev) => prev.map((b) => (b.id === bot.id ? res.data : b)));
    } catch {
      toast.error('Failed to update bot');
    }
  };

  const handleDelete = async (bot: BotRecord) => {
    if (!orgId || !confirm(`Delete "${bot.name}"? This cannot be undone.`)) return;
    try {
      await botsApi.delete(orgId, bot.id);
      setBots((prev) => prev.filter((b) => b.id !== bot.id));
      toast.success('Bot deleted');
    } catch {
      toast.error('Failed to delete bot');
    }
  };

  const copyToken = (token: string, id: string) => {
    navigator.clipboard.writeText(token);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
            Bots
          </h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">
            Manage your Telegram bots and webhooks.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 py-2.5 px-5 text-sm">
          <Plus className="w-4 h-4" />
          Add bot
        </button>
      </div>

      {/* Create bot modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="card p-8 w-full max-w-md mx-4">
            <h2 className="font-brand font-semibold text-xl tracking-tight text-white mb-1">
              Add a bot
            </h2>
            <p className="text-sm text-zinc-500 font-light mb-6">
              Create a bot on{' '}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                @BotFather
              </a>{' '}
              and paste the token below.
            </p>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-normal">
                  Bot name
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="input-base"
                  placeholder="Support Bot"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-normal">
                  Telegram bot token
                </label>
                <input
                  type="text"
                  required
                  value={form.telegramToken}
                  onChange={(e) => setForm((f) => ({ ...f, telegramToken: e.target.value }))}
                  className="input-base font-mono text-xs"
                  placeholder="123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="btn-secondary flex-1 py-2.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn-primary flex-1 py-2.5"
                >
                  {creating ? 'Creating…' : 'Create bot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bot list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-zinc-900 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : bots.length === 0 ? (
        <div className="card p-16 flex flex-col items-center text-center">
          <Bot className="w-10 h-10 text-zinc-700 mb-4" />
          <h3 className="font-brand font-semibold text-lg tracking-tight text-white mb-2">
            No bots yet
          </h3>
          <p className="text-sm text-zinc-600 font-light mb-6">
            Add your first Telegram bot to get started.
          </p>
          <button onClick={() => setShowCreate(true)} className="btn-primary py-2.5 px-6 text-sm">
            Add your first bot
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {bots.map((bot) => (
            <div key={bot.id} className="card p-5">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                  <Bot className="w-5 h-5 text-zinc-500" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-base font-normal text-white truncate">{bot.name}</h3>
                    {bot.telegramUsername && (
                      <span className="text-xs text-zinc-600 font-light">
                        @{bot.telegramUsername}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap mt-1.5">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-md font-normal ${
                        bot.isActive
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {bot.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-md font-normal ${
                        bot.webhookSet
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {bot.webhookSet ? 'Webhook set' : 'No webhook'}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {!bot.webhookSet && (
                    <button
                      onClick={() => handleSetWebhook(bot)}
                      title="Set webhook"
                      className="p-2 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      <Webhook className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => copyToken(bot.telegramToken, bot.id)}
                    title="Copy token"
                    className="p-2 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    {copiedId === bot.id ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleToggle(bot)}
                    title={bot.isActive ? 'Deactivate' : 'Activate'}
                    className="p-2 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    {bot.isActive ? (
                      <ToggleRight className="w-4 h-4 text-green-400" />
                    ) : (
                      <ToggleLeft className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(bot)}
                    title="Delete bot"
                    className="p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
