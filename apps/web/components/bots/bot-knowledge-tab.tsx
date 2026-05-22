'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Trash2, Link as LinkIcon, FileText, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';

type IngestTab = 'url' | 'text' | 'file';

type KnowledgeItem = {
  knowledge_file_id: string;
  name: string;
  source_type: 'url' | 'text' | 'file' | string;
  source_url?: string | null;
  scope?: 'shared' | 'agent' | string;
  chunk_count: number;
  ingested_at: string;
};

type ScopeMode = 'agent' | 'shared';

function sourceTypeLabel(sourceType: string) {
  if (sourceType === 'url') return 'URL';
  if (sourceType === 'text') return 'Text';
  if (sourceType === 'file') return 'File';
  return sourceType;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function BotKnowledgeTab({ orgId, botId, active }: { orgId: string; botId: string; active: boolean }) {
  const fileIngestEnabled = process.env.NEXT_PUBLIC_KNOWLEDGE_FILE_INGEST_ENABLED === 'true';
  const [scopeMode, setScopeMode] = useState<ScopeMode>('agent');
  const [ingestTab, setIngestTab] = useState<IngestTab>('url');
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [url, setUrl] = useState('');
  const [urlName, setUrlName] = useState('');
  const [textName, setTextName] = useState('');
  const [textContent, setTextContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const currentBotId = useMemo(() => (scopeMode === 'agent' ? botId : undefined), [scopeMode, botId]);

  const loadItems = async () => {
    setItemsLoading(true);
    try {
      const params = currentBotId ? { botId: currentBotId } : undefined;
      const res = await api.get(`/organizations/${orgId}/knowledge`, { params });
      setItems(res.data ?? []);
    } catch {
      toast.error('Failed to load knowledge items');
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, orgId, currentBotId]);

  useEffect(() => {
    if (!fileIngestEnabled && ingestTab === 'file') {
      setIngestTab('url');
    }
  }, [fileIngestEnabled, ingestTab]);

  const ingestUrl = async () => {
    if (!url.trim()) {
      toast.error('URL is required');
      return;
    }

    setIngesting(true);
    try {
      await api.post(`/organizations/${orgId}/knowledge/ingest/url`, {
        url,
        name: urlName || url,
        ...(currentBotId ? { botId: currentBotId } : {}),
      });
      setUrl('');
      setUrlName('');
      toast.success('URL ingested');
      loadItems();
    } catch {
      toast.error('Failed to ingest URL');
    } finally {
      setIngesting(false);
    }
  };

  const ingestText = async () => {
    if (!textContent.trim()) {
      toast.error('Text content is required');
      return;
    }

    setIngesting(true);
    try {
      await api.post(`/organizations/${orgId}/knowledge/ingest/text`, {
        name: textName || 'Bot notes',
        text: textContent,
        ...(currentBotId ? { botId: currentBotId } : {}),
      });
      setTextName('');
      setTextContent('');
      toast.success('Text ingested');
      loadItems();
    } catch {
      toast.error('Failed to ingest text');
    } finally {
      setIngesting(false);
    }
  };

  const ingestFile = async () => {
    if (!file) {
      toast.error('Choose a file first');
      return;
    }

    setIngesting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (fileName.trim()) form.append('name', fileName.trim());
      if (currentBotId) form.append('botId', currentBotId);
      await api.post(`/organizations/${orgId}/knowledge/ingest/file`, form);
      setFile(null);
      setFileName('');
      toast.success('File ingested');
      loadItems();
    } catch {
      toast.error('Failed to ingest file');
    } finally {
      setIngesting(false);
    }
  };

  const removeItem = async (knowledgeFileId: string) => {
    if (!confirm('Delete this knowledge source and all its chunks?')) return;

    setDeletingId(knowledgeFileId);
    try {
      await api.delete(`/organizations/${orgId}/knowledge/${knowledgeFileId}`);
      setItems((prev) => prev.filter((item) => item.knowledge_file_id !== knowledgeFileId));
      toast.success('Knowledge source deleted');
    } catch {
      toast.error('Failed to delete knowledge source');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card p-6 border border-zinc-800">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Knowledge Packs</h2>
            <p className="text-xs text-zinc-500">Add sources for this bot only, or switch to shared organization knowledge.</p>
          </div>
          <button
            type="button"
            onClick={loadItems}
            disabled={itemsLoading}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${itemsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1 inline-flex">
          <button
            type="button"
            onClick={() => setScopeMode('agent')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              scopeMode === 'agent' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            This agent pack
          </button>
          <button
            type="button"
            onClick={() => setScopeMode('shared')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              scopeMode === 'shared' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            Shared org pack
          </button>
        </div>

        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[11px] text-zinc-500 mb-2">
            Add source under: <span className="text-zinc-300">{scopeMode === 'agent' ? 'This agent pack' : 'Shared org pack'}</span>
          </p>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-1 inline-flex">
            {([
              { key: 'url', label: 'URL', icon: LinkIcon },
              { key: 'text', label: 'Text', icon: FileText },
              ...(fileIngestEnabled ? ([{ key: 'file', label: 'File', icon: Upload }] as const) : []),
            ] as const).map((tab) => {
              const Icon = tab.icon;
              const activeTab = ingestTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setIngestTab(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                    activeTab ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          {!fileIngestEnabled ? (
            <p className="text-[11px] text-zinc-600 mt-2">File ingest is temporarily disabled. Use URL or Text sources for now.</p>
          ) : null}
        </div>

        {ingestTab === 'url' ? (
          <div className="space-y-3">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.example.com/article"
              className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
            />
            <input
              value={urlName}
              onChange={(e) => setUrlName(e.target.value)}
              placeholder="Optional source name"
              className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
            />
            <button
              type="button"
              onClick={ingestUrl}
              disabled={ingesting}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              {ingesting ? 'Ingesting...' : `Ingest URL to ${scopeMode === 'agent' ? 'agent pack' : 'shared pack'}`}
            </button>
          </div>
        ) : null}

        {ingestTab === 'text' ? (
          <div className="space-y-3">
            <input
              value={textName}
              onChange={(e) => setTextName(e.target.value)}
              placeholder="Source title"
              className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
            />
            <textarea
              rows={5}
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="Paste policies, playbooks, or product knowledge"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-700 resize-y focus:outline-none focus:border-blue-600/50"
            />
            <button
              type="button"
              onClick={ingestText}
              disabled={ingesting}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              {ingesting ? 'Ingesting...' : `Ingest Text to ${scopeMode === 'agent' ? 'agent pack' : 'shared pack'}`}
            </button>
          </div>
        ) : null}

        {fileIngestEnabled && ingestTab === 'file' ? (
          <div className="space-y-3">
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Optional source name"
              className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-blue-600/50"
            />
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-zinc-200 hover:file:bg-zinc-700"
            />
            <button
              type="button"
              onClick={ingestFile}
              disabled={ingesting || !file}
              className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              {ingesting ? 'Uploading...' : `Ingest File to ${scopeMode === 'agent' ? 'agent pack' : 'shared pack'}`}
            </button>
          </div>
        ) : null}
      </div>

      <div className="card p-6 border border-zinc-800">
        <h3 className="text-sm font-semibold text-white mb-4">Sources in selected pack</h3>

        {itemsLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((k) => <div key={k} className="h-16 rounded-xl bg-zinc-900/70 border border-zinc-800 animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-4 text-sm text-zinc-500">No knowledge sources in this scope yet.</div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.knowledge_file_id} className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100 truncate">{item.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded-md border border-zinc-800 text-zinc-400">{sourceTypeLabel(item.source_type)}</span>
                      <span className="px-1.5 py-0.5 rounded-md border border-zinc-800 text-zinc-400">{item.scope === 'agent' ? 'Agent pack' : 'Shared'}</span>
                      <span>{item.chunk_count} chunks</span>
                      <span>•</span>
                      <span>{formatDate(item.ingested_at)}</span>
                    </div>
                    {item.source_url ? (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block mt-1 text-[11px] text-blue-400 hover:text-blue-300 break-all"
                      >
                        {item.source_url}
                      </a>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(item.knowledge_file_id)}
                    disabled={deletingId === item.knowledge_file_id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-500 hover:text-red-300 hover:border-red-800 hover:bg-red-950/30 disabled:opacity-50 text-xs transition-colors shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
