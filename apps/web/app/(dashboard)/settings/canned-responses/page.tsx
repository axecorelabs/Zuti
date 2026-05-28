'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Check, X, Zap } from 'lucide-react';
import { orgsApi, cannedResponsesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
}

interface Org { id: string; name: string; }

const empty = { shortcut: '', title: '', content: '' };

export default function CannedResponsesPage() {
  const { activeOrgId } = useAuthStore();
  const [org, setOrg] = useState<Org | null>(null);
  const [items, setItems] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    orgsApi.list().then(async (res) => {
      const orgs: Org[] = res.data;
      if (!orgs.length) return;
      const preferred = activeOrgId
        ? (orgs.find((currentOrg) => currentOrg.id === activeOrgId) ?? orgs[0])
        : orgs[0];
      setOrg(preferred);
      const r = await cannedResponsesApi.list(preferred.id);
      setItems(r.data ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [activeOrgId]);

  const handleCreate = async () => {
    if (!org || !form.shortcut.trim() || !form.title.trim() || !form.content.trim()) return;
    setSaving(true); setError(null);
    try {
      const r = await cannedResponsesApi.create(org.id, form);
      setItems((p) => [...p, r.data]);
      setForm(empty);
      setCreating(false);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleUpdate = async (id: string) => {
    if (!org) return;
    setSaving(true); setError(null);
    try {
      const r = await cannedResponsesApi.update(org.id, id, editForm);
      setItems((p) => p.map((x) => (x.id === id ? r.data : x)));
      setEditId(null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!org) return;
    await cannedResponsesApi.remove(org.id, id).catch(() => {});
    setItems((p) => p.filter((x) => x.id !== id));
  };

  const startEdit = (item: CannedResponse) => {
    setEditId(item.id);
    setEditForm({ shortcut: item.shortcut, title: item.title, content: item.content });
    setCreating(false);
    setError(null);
  };

  return (
    <div className="settings-page settings-canned-page w-full px-4 py-4 md:px-8 md:py-8">
    <div className="mx-auto w-full max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Canned Responses</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">
            Pre-written replies agents can insert with <span className="text-zinc-400 font-mono text-xs">/shortcut</span>. The AI uses them automatically when topics match.
          </p>
        </div>
        <button
          onClick={() => { setCreating(true); setEditId(null); setError(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" /> New response
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">{error}</div>
      )}

      {/* Create form */}
      {creating && (
        <div className="card p-5 mb-4 border-blue-600/30">
          <p className="text-xs text-zinc-500 mb-4 font-normal">New canned response</p>
          <div className="grid sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Shortcut</label>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500 text-sm">/</span>
                <input
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-600"
                  placeholder="refund"
                  value={form.shortcut}
                  onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Title</label>
              <input
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-600"
                placeholder="Refund policy"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-zinc-500 mb-1">Response content</label>
            <textarea
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-600 resize-none"
              rows={4}
              placeholder="Our refund policy allows returns within 30 days of purchase..."
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setCreating(false); setForm(empty); setError(null); }}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >Cancel</button>
            <button
              onClick={handleCreate}
              disabled={saving || !form.shortcut.trim() || !form.title.trim() || !form.content.trim()}
              className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors"
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="card h-20 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-12 flex flex-col items-center text-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
            <Zap className="w-5 h-5 text-zinc-500" />
          </div>
          <p className="text-sm text-zinc-400">No canned responses yet</p>
          <p className="text-xs text-zinc-600 max-w-xs">Create your first response to speed up agent replies and improve AI consistency.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="card p-4">
              {editId === item.id ? (
                <>
                  <div className="grid sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Shortcut</label>
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-500 text-sm">/</span>
                        <input
                          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          value={editForm.shortcut}
                          onChange={(e) => setEditForm((f) => ({ ...f, shortcut: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Title</label>
                      <input
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-600"
                        value={editForm.title}
                        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                      />
                    </div>
                  </div>
                  <textarea
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-600 resize-none mb-3"
                    rows={3}
                    value={editForm.content}
                    onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditId(null)} className="p-1.5 text-zinc-500 hover:text-zinc-300">
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleUpdate(item.id)}
                      disabled={saving}
                      className="p-1.5 text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    <span className="px-2 py-0.5 bg-blue-600/15 border border-blue-600/20 text-blue-400 text-xs font-mono rounded-md">
                      /{item.shortcut}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 font-normal">{item.title}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{item.content}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(item)}
                      className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors rounded-lg hover:bg-zinc-800"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors rounded-lg hover:bg-zinc-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
