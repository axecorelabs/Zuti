'use client';

import { useEffect, useState } from 'react';
import { Link as LinkIcon, FileText, Trash2, RefreshCw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, orgsApi } from '@/lib/api';

type TabType = 'url' | 'text';

type KnowledgeItem = {
  knowledge_file_id: string;
  name: string;
  source_type: 'url' | 'text' | 'file' | string;
  source_url?: string | null;
  chunk_count: number;
  ingested_at: string;
};

export default function KnowledgePage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabType>('url');
  const [url, setUrl] = useState('');
  const [urlName, setUrlName] = useState('');
  const [textName, setTextName] = useState('');
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadItems = async (targetOrgId: string) => {
    setItemsLoading(true);
    try {
      const res = await api.get(`/organizations/${targetOrgId}/knowledge`);
      setItems(res.data ?? []);
    } catch {
      toast.error('Failed to load knowledge items');
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    orgsApi.list()
      .then((res) => {
        if (res.data.length > 0) {
          const firstOrgId = res.data[0].id;
          setOrgId(firstOrgId);
          loadItems(firstOrgId);
        }
      })
      .catch(() => {});
  }, []);

  const handleIngestUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !url) return;
    setLoading(true);
    try {
      await api.post(`/organizations/${orgId}/knowledge/ingest/url`, {
        url,
        name: urlName || url,
      });
      toast.success('URL ingested successfully');
      setUrl('');
      setUrlName('');
      await loadItems(orgId);
    } catch {
      toast.error('Failed to ingest URL');
    } finally {
      setLoading(false);
    }
  };

  const handleIngestText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !textContent.trim()) return;
    setLoading(true);
    try {
      await api.post(`/organizations/${orgId}/knowledge/ingest/text`, {
        name: textName || 'Company writeup',
        text: textContent,
      });
      toast.success('Text ingested successfully');
      setTextName('');
      setTextContent('');
      await loadItems(orgId);
    } catch {
      toast.error('Failed to ingest text');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteItem = async (knowledgeFileId: string) => {
    if (!orgId) return;
    const ok = window.confirm('Delete this ingested content? This cannot be undone.');
    if (!ok) return;

    setDeletingId(knowledgeFileId);
    try {
      await api.delete(`/organizations/${orgId}/knowledge/${knowledgeFileId}`);
      toast.success('Knowledge item deleted');
      await loadItems(orgId);
    } catch {
      toast.error('Failed to delete knowledge item');
    } finally {
      setDeletingId(null);
    }
  };

  const sourceTypeLabel = (sourceType: string) => {
    if (sourceType === 'url') return 'URL';
    if (sourceType === 'text') return 'Text';
    if (sourceType === 'file') return 'File';
    return sourceType;
  };

  const formatDate = (value: string) => {
    if (!value) return 'Unknown time';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'Unknown time';
    return dt.toLocaleString();
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
          Knowledge Base
        </h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Train your AI using only safe URLs and business text writeups.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Ingest panel */}
        <div className="card p-6">
          <h2 className="font-brand font-semibold text-base tracking-tight text-white mb-4">
            Add knowledge
          </h2>

          {/* Tabs */}
          <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 mb-6">
            {(['url', 'text'] as TabType[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-md transition-colors font-normal ${
                  tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:text-zinc-300'
                }`}
              >
                {t === 'url' ? (
                  <><LinkIcon className="w-3.5 h-3.5" /> From URL</>
                ) : (
                  <><FileText className="w-3.5 h-3.5" /> Write text</>
                )}
              </button>
            ))}
          </div>

          {tab === 'url' ? (
            <form onSubmit={handleIngestUrl} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-normal">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={urlName}
                  onChange={(e) => setUrlName(e.target.value)}
                  className="input-base"
                  placeholder="e.g. FAQ page"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-normal">
                  URL to scrape
                </label>
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="input-base"
                  placeholder="https://your-docs.com/page"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-2.5 text-sm"
              >
                {loading ? 'Ingesting…' : 'Ingest URL'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleIngestText} className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-normal">
                  Name
                </label>
                <input
                  type="text"
                  value={textName}
                  onChange={(e) => setTextName(e.target.value)}
                  className="input-base"
                  placeholder="e.g. Company overview"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-normal">
                  Content
                </label>
                <textarea
                  required
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  rows={10}
                  className="input-base resize-none"
                  placeholder="Paste your company writeup, FAQ, product info, or any text you want the AI to know about…"
                />
                <p className="text-xs text-zinc-700 mt-1">{textContent.length} characters</p>
              </div>
              <button
                type="submit"
                disabled={loading || !textContent.trim()}
                className="btn-primary w-full py-2.5 text-sm"
              >
                {loading ? 'Processing…' : 'Save & ingest'}
              </button>
            </form>
          )}

          <div className="mt-5 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-xs text-emerald-200/90 leading-relaxed">
              Security policy: code/config-like content, local/private URLs, and secret-like patterns are blocked during ingestion.
            </p>
          </div>
        </div>

        {/* Existing knowledge panel */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="font-brand font-semibold text-base tracking-tight text-white">
              Existing knowledge
            </h2>
            <button
              type="button"
              onClick={() => orgId && loadItems(orgId)}
              disabled={itemsLoading || !orgId}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${itemsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {itemsLoading ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map((row) => (
                <div key={row} className="h-16 rounded-xl bg-zinc-900/50 animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-4 text-sm text-zinc-500">
              No ingested knowledge yet.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.knowledge_file_id}
                  className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{item.name}</p>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                        <span className="px-1.5 py-0.5 rounded-md border border-zinc-800 text-zinc-400">
                          {sourceTypeLabel(item.source_type)}
                        </span>
                        <span>{item.chunk_count} chunks</span>
                        <span>•</span>
                        <span>{formatDate(item.ingested_at)}</span>
                      </div>
                      {item.source_url ? (
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 block text-xs text-blue-400 hover:text-blue-300 truncate"
                        >
                          {item.source_url}
                        </a>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.knowledge_file_id)}
                      disabled={deletingId === item.knowledge_file_id}
                      aria-label={`Delete ${item.name}`}
                      title="Delete"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-800 text-zinc-500 hover:text-red-300 hover:border-red-800 hover:bg-red-950/30 transition-colors disabled:opacity-50 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
