'use client';

import { useEffect, useState } from 'react';
import { Bot, Plus, Webhook, Trash2, Copy, Check, Settings, Zap, ZapOff, ExternalLink, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
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
  routeToRoles: string[];
}

export default function BotsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', telegramToken: '' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [settingsBot, setSettingsBot] = useState<BotRecord | null>(null);
  const [editSystemPrompt, setEditSystemPrompt] = useState('');
  const [editRouteToRoles, setEditRouteToRoles] = useState<string[]>(['AGENT']);
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
      // keep settings view in sync
      if (settingsBot?.id === bot.id) setSettingsBot(res.data);
    } catch { toast.error('Failed to update bot'); }
  };

  const handleDelete = async (bot: BotRecord) => {
    if (!orgId || !confirm(`Delete "${bot.name}"? This cannot be undone.`)) return;
    try {
      await botsApi.delete(orgId, bot.id);
      setBots((prev) => prev.filter((b) => b.id !== bot.id));
      if (settingsBot?.id === bot.id) setSettingsBot(null);
      toast.success('Bot deleted');
    } catch { toast.error('Failed to delete bot'); }
  };

  const copyToken = (token: string, id: string) => {
    navigator.clipboard.writeText(token);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openSettings = (bot: BotRecord) => {
    setSettingsBot(bot);
    setEditSystemPrompt(bot.aiConfig?.systemPrompt ?? '');
    setEditRouteToRoles(bot.routeToRoles?.length ? bot.routeToRoles : ['AGENT']);
  };

  const toggleRouteRole = (role: string) => {
    setEditRouteToRoles((prev) =>
      prev.includes(role)
        ? prev.filter((r) => r !== role) // never allow empty — keep at least one
            .length === 0 ? prev : prev.filter((r) => r !== role)
        : [...prev, role],
    );
  };

  const handleSaveSettings = async () => {
    if (!orgId || !settingsBot) return;
    setSaving(true);
    try {
      const res = await botsApi.update(orgId, settingsBot.id, {
        aiConfig: { ...(settingsBot.aiConfig ?? {}), systemPrompt: editSystemPrompt },
        routeToRoles: editRouteToRoles,
      });
      setBots((prev) => prev.map((b) => (b.id === settingsBot.id ? res.data : b)));
      setSettingsBot(res.data);
      toast.success('Settings saved');
    } catch { toast.error('Failed to save settings'); } finally { setSaving(false); }
  };

  const handleSetWebhookInSettings = async (bot: BotRecord) => {
    if (!orgId) return;
    try {
      await botsApi.setWebhook(orgId, bot.id);
      const updated = { ...bot, webhookSet: true };
      setBots((prev) => prev.map((b) => (b.id === bot.id ? updated : b)));
      setSettingsBot(updated);
      toast.success('Webhook set!');
    } catch { toast.error('Failed to set webhook'); }
  };

  const Modal = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );

  // ── Settings step (full-page inline view) ─────────────────────────────────
  if (settingsBot) {
    return (
      <div className="p-4 md:p-8">
        {/* Breadcrumb nav */}
        <div className="flex items-center gap-2 mb-8">
          <button
            onClick={() => setSettingsBot(null)}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Bots
          </button>
          <ChevronRight className="w-3 h-3 text-zinc-700" />
          <span className="text-sm text-white font-medium">{settingsBot.name}</span>
          <ChevronRight className="w-3 h-3 text-zinc-700" />
          <span className="text-sm text-zinc-500">AI Settings</span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          {/* Left: editor sections */}
          <div className="xl:col-span-2 space-y-5">
            {/* System Prompt */}
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">System Prompt</h2>
                  <p className="text-xs text-zinc-500 font-light">Define the bot&apos;s personality, tone, and capabilities.</p>
                </div>
              </div>
              <textarea
                rows={24}
                value={editSystemPrompt}
                onChange={(e) => setEditSystemPrompt(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3.5 text-sm text-zinc-200 placeholder-zinc-700 resize-y focus:outline-none focus:border-blue-600/50 transition-colors font-light leading-relaxed"
                placeholder={`You are ${settingsBot.name}, a helpful and friendly support assistant.\n\nYour role is to:\n- Answer customer questions clearly and professionally\n- Escalate complex issues to a human agent when needed\n- Stay on-topic and avoid discussing unrelated subjects\n\nTone: Professional yet approachable.`}
              />
              <div className="flex items-center justify-between mt-2.5">
                <p className="text-[11px] text-zinc-600 font-light">
                  Leave blank to use the default prompt. Plain text only.
                </p>
                <span className="text-[11px] text-zinc-700 tabular-nums font-light">
                  {editSystemPrompt.length.toLocaleString()} chars
                </span>
              </div>
            </div>

            {/* Routing */}
            <div className="card p-6 border border-zinc-800">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4 text-zinc-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Escalation Routing</h2>
                  <p className="text-xs text-zinc-500 font-light">Which roles the AI may auto-assign conversations to when escalating.</p>
                </div>
              </div>

              <div className="space-y-2">
                {([
                  { role: 'AGENT', label: 'Agents', description: 'Dedicated support staff — recommended' },
                  { role: 'ADMIN', label: 'Admins', description: 'Managers and team leads' },
                  { role: 'OWNER', label: 'Owners', description: 'Organization owners' },
                ] as { role: string; label: string; description: string }[]).map(({ role, label, description }) => {
                  const checked = editRouteToRoles.includes(role);
                  const isLast = editRouteToRoles.length === 1 && checked;
                  return (
                    <label
                      key={role}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-blue-600/8 border-blue-600/25'
                          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                      } ${isLast ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLast}
                        onChange={() => toggleRouteRole(role)}
                        className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 accent-blue-500 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white leading-none mb-0.5">{label}</p>
                        <p className="text-[11px] text-zinc-500 font-light">{description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-zinc-600 mt-3 font-light">
                At least one role must be selected. Availability and capacity limits still apply.
              </p>
            </div>

            {/* Save / back */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSettingsBot(null)}
                className="px-5 py-2.5 rounded-xl border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors text-sm font-medium"
              >
                ← Back to bots
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </div>

          {/* Right: bot info sidebar */}
          <div className="space-y-4">
            {/* Status card */}
            <div className="card p-5 border border-zinc-800">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  settingsBot.isActive ? 'bg-blue-600/15 border border-blue-600/20' : 'bg-zinc-900 border border-zinc-800'
                }`}>
                  <Bot className={`w-5 h-5 ${settingsBot.isActive ? 'text-blue-400' : 'text-zinc-600'}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-white truncate">{settingsBot.name}</h3>
                  {settingsBot.telegramUsername && (
                    <p className="text-xs text-zinc-500 truncate">@{settingsBot.telegramUsername}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Status</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.isActive ? 'bg-blue-500/15 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {settingsBot.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Webhook</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.webhookSet ? 'bg-zinc-800 text-zinc-500' : 'bg-orange-500/15 text-orange-400'
                  }`}>
                    {settingsBot.webhookSet ? 'Ready' : 'Not set'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Prompt</span>
                  <span className={`px-2 py-0.5 rounded-lg font-medium text-[11px] ${
                    settingsBot.aiConfig?.systemPrompt ? 'bg-blue-500/10 text-blue-500' : 'bg-zinc-800 text-zinc-600'
                  }`}>
                    {settingsBot.aiConfig?.systemPrompt ? 'Custom' : 'Default'}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-zinc-500 shrink-0">Routes to</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {(settingsBot.routeToRoles?.length ? settingsBot.routeToRoles : ['AGENT']).map((r) => (
                      <span key={r} className="px-1.5 py-0.5 rounded-md font-medium text-[10px] bg-zinc-800 text-zinc-400">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-zinc-800/60 space-y-1.5">
                <button
                  onClick={() => handleToggle(settingsBot)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors text-xs text-zinc-400 hover:text-white"
                >
                  <span>{settingsBot.isActive ? 'Deactivate bot' : 'Activate bot'}</span>
                  {settingsBot.isActive ? <ZapOff className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                </button>
                {!settingsBot.webhookSet && (
                  <button
                    onClick={() => handleSetWebhookInSettings(settingsBot)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/15 border border-orange-500/20 transition-colors text-xs text-orange-400"
                  >
                    <span>Set webhook</span>
                    <Webhook className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => copyToken(settingsBot.telegramToken, settingsBot.id)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors text-xs text-zinc-400 hover:text-white"
                >
                  <span>Copy token</span>
                  {copiedId === settingsBot.id
                    ? <Check className="w-3.5 h-3.5 text-blue-400" />
                    : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => handleDelete(settingsBot)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors text-xs text-zinc-600 hover:text-red-400"
                >
                  <span>Delete bot</span>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Tips */}
            <div className="card p-4 border border-zinc-800/50 bg-zinc-950/40">
              <p className="text-[11px] font-medium text-zinc-500 mb-2.5">Tips for a good system prompt</p>
              <ul className="space-y-2">
                {[
                  "State the bot's name and purpose in the first line.",
                  'List what topics it should and should not discuss.',
                  'Specify when to escalate to a human agent.',
                  'Set the language and tone for your audience.',
                ].map((tip) => (
                  <li key={tip} className="text-[11px] text-zinc-600 font-light flex gap-1.5 leading-relaxed">
                    <span className="text-zinc-700 shrink-0 mt-px">·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
                  <button onClick={() => openSettings(bot)} title="AI settings" className="p-2 rounded-lg text-zinc-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
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