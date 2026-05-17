'use client';

import { useEffect, useState } from 'react';
import { Bot, Plus, Webhook, Trash2, Copy, Check, Settings, Zap, ZapOff, ExternalLink, ChevronRight } from 'lucide-react';
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
  aiConfig: Record<string, string> | null;
}

export default function BotsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', telegramToken: '' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editBot, setEditBot] = useState<BotRecord | null>(null);
  const [editSystemPrompt, setEditSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    orgsApi.list().then((res) => {
      const orgs = res.data;
      if (orgs.length > 0) setOrgId(orgs[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!orgId) return;
    botsApi.list(orgId).then((res) => setBots(res.data)).catch(() => {}).finally(() => setLoading(false));
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
      toast.success('Bot created');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create bot';
      toast.error(Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setCreating(false);
    }
  };

  const handleSetWebhook = async (bot: BotRecord) => {
    if (!orgId) return;
    try {
      await botsApi.setWebhook(orgId, bot.id);
      setBots((prev) => prev.map((b) => (b.id === bot.id ? { ...b, webhookSet: true } : b)));
      toast.success('Webhook set!');
    } catch { toast.error('Failed to set webhook'); }
  };

  const handleToggle = async (bot: BotRecord) => {
    if (!orgId) return;
    try {
      const res = await botsApi.update(orgId, bot.id, { isActive: !bot.isActive });
      setBots((prev) => prev.map((b) => (b.id === bot.id ? res.data : b)));
    } catch { toast.error('Failed to update bot'); }
  };

  const handleDelete = async (bot: BotRecord) => {
    if (!orgId || !confirm(`Delete "${bot.name}"? This cannot be undone.`)) return;
    try {
      await botsApi.delete(orgId, bot.id);
      setBots((prev) => prev.filter((b) => b.id !== bot.id));
      toast.success('Bot deleted');
    } catch { toast.error('Failed to delete bot'); }
  };

  const copyToken = (token: string, id: string) => {
    navigator.clipboard.writeText(token);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openEdit = (bot: BotRecord) => {
    setEditBot(bot);
    setEditSystemPrompt(bot.aiConfig?.systemPrompt ?? '');
  };

  const handleSaveEdit = async () => {
    if (!orgId || !editBot) return;
    setSaving(true);
    try {
      const res = await botsApi.update(orgId, editBot.id, {
        aiConfig: { ...(editBot.aiConfig ?? {}), systemPrompt: editSystemPrompt },
      });
      setBots((prev) => prev.map((b) => (b.id === editBot.id ? res.data : b)));
      setEditBot(null);
      toast.success('Bot settings saved');
    } catch { toast.error('Failed to save settings'); } finally { setSaving(false); }
  };

  const Modal = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Bots</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">Manage your Telegram bots and AI settings.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          Add bot
        </button>
      </div>

      {/* Edit modal */}
      {editBot && (
        <Modal onClose={() => setEditBot(null)}>
          <div className="card p-8 w-full max-w-3xl mx-4 border border-zinc-800 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center">
                <Settings className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="font-semibold text-lg text-white tracking-tight">AI Settings</h2>
                <p className="text-sm text-zinc-500 font-light">{editBot.name}</p>
              </div>
            </div>
            <div className="space-y-5">
              <div>
                <label className="block text-xs text-zinc-400 mb-2 font-medium">System prompt</label>
                <textarea
                  rows={14}
                  value={editSystemPrompt}
                  onChange={(e) => setEditSystemPrompt(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-700 resize-none focus:outline-none focus:border-blue-600/50 transition-colors font-light leading-relaxed"
                  placeholder={`You are ${editBot.name}, a helpful assistant. Answer questions clearly and professionally.`}
                />
                <p className="text-[11px] text-zinc-600 mt-1.5 font-light">
                  Leave blank to use the default prompt. Use plain text — avoid markdown.
                </p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setEditBot(null)} className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors text-sm font-medium">
                  Cancel
                </button>
                <button onClick={handleSaveEdit} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <div className="card p-8 w-full max-w-md mx-4 border border-zinc-800">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center">
                <Bot className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="font-semibold text-lg text-white tracking-tight">Add a bot</h2>
                <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-blue-400 transition-colors">
                  Get token from @BotFather <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Bot name</label>
                <input type="text" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 transition-colors" placeholder="Support Bot" />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5 font-medium">Telegram bot token</label>
                <input type="text" required value={form.telegramToken} onChange={(e) => setForm((f) => ({ ...f, telegramToken: e.target.value }))} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 font-mono placeholder-zinc-700 focus:outline-none focus:border-blue-600/50 transition-colors" placeholder="123456789:AAFxxxxxx…" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors text-sm font-medium">
                  Cancel
                </button>
                <button type="submit" disabled={creating} className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                  {creating ? 'Creating…' : 'Create bot'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {/* Bot list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-zinc-900 animate-pulse rounded-2xl" />)}
        </div>
      ) : bots.length === 0 ? (
        <div className="card p-16 flex flex-col items-center text-center border border-dashed border-zinc-800">
          <div className="w-14 h-14 rounded-2xl bg-zinc-900 flex items-center justify-center mb-4">
            <Bot className="w-7 h-7 text-zinc-700" />
          </div>
          <h3 className="font-semibold text-lg text-white mb-2">No bots yet</h3>
          <p className="text-sm text-zinc-600 font-light mb-6 max-w-xs">
            Add your first Telegram bot to start handling customer conversations with AI.
          </p>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Add your first bot
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {bots.map((bot) => (
            <div key={bot.id} className="card p-5 hover:border-zinc-700 transition-colors group">
              <div className="flex items-center gap-4">
                {/* Icon */}
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  bot.isActive ? 'bg-blue-600/15 border border-blue-600/20' : 'bg-zinc-900 border border-zinc-800'
                }`}>
                  <Bot className={`w-5 h-5 ${bot.isActive ? 'text-blue-400' : 'text-zinc-600'}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-medium text-white">{bot.name}</h3>
                    {bot.telegramUsername && (
                      <span className="text-xs text-zinc-600">@{bot.telegramUsername}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium ${
                      bot.isActive ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {bot.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium ${
                      bot.webhookSet
                        ? 'bg-zinc-800 text-zinc-500'
                        : 'bg-orange-500/15 text-orange-400'
                    }`}>
                      {bot.webhookSet ? 'Webhook ready' : '⚠ No webhook'}
                    </span>
                    {bot.aiConfig?.systemPrompt && (
                      <span className="text-[10px] px-2 py-0.5 rounded-lg font-medium bg-blue-500/10 text-blue-500">
                        Custom prompt
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                  {!bot.webhookSet && (
                    <button onClick={() => handleSetWebhook(bot)} title="Set webhook" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 text-xs font-medium transition-colors border border-orange-500/20">
                      <Webhook className="w-3.5 h-3.5" /> Set webhook
                    </button>
                  )}
                  <button onClick={() => openEdit(bot)} title="AI settings" className="p-2 rounded-lg text-zinc-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
                    <Settings className="w-4 h-4" />
                  </button>
                  <button onClick={() => copyToken(bot.telegramToken, bot.id)} title="Copy token" className="p-2 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                    {copiedId === bot.id ? <Check className="w-4 h-4 text-blue-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleToggle(bot)}
                    title={bot.isActive ? 'Deactivate bot' : 'Activate bot'}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                      bot.isActive ? 'bg-blue-600' : 'bg-zinc-700'
                    }`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      bot.isActive ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`} />
                  </button>
                  <button onClick={() => handleDelete(bot)} title="Delete" className="p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Webhook CTA banner */}
              {!bot.webhookSet && (
                <div className="mt-4 flex items-center justify-between px-4 py-3 rounded-xl bg-orange-500/8 border border-orange-500/15">
                  <div className="flex items-center gap-2">
                    <Webhook className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <p className="text-xs text-orange-400/80 font-light">
                      Webhook not set — this bot won't receive Telegram messages until it's configured.
                    </p>
                  </div>
                  <button onClick={() => handleSetWebhook(bot)} className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 font-medium shrink-0 ml-3 transition-colors">
                    Fix now <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}