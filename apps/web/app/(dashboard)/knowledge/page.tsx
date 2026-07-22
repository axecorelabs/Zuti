'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Link as LinkIcon,
  FileText,
  Upload,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, botsApi, knowledgeApi, orgsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type IngestTab = 'url' | 'text' | 'file';
type PageTab = 'sources' | 'suggestions' | 'gaps';
type GapStatus = 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DISMISSED';

type KnowledgeItem = {
  knowledge_file_id: string;
  name: string;
  source_type: 'url' | 'text' | 'file' | string;
  source_url?: string | null;
  bot_id?: string | null;
  scope?: 'shared' | 'agent' | string;
  chunk_count: number;
  ingested_at: string;
};

type BotOption = {
  id: string;
  name: string;
};

type KnowledgeSuggestion = {
  id: string;
  title: string;
  content: string;
  sourceQuestion?: string | null;
  sourceAnswer?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'MERGED';
  createdAt: string;
  thread?: {
    topic?: string | null;
    assignedUser?: { name?: string | null; email: string } | null;
  } | null;
};

type KnowledgeGap = {
  id: string;
  topic?: string | null;
  topicKey: string;
  question: string;
  status: GapStatus;
  seenCount: number;
  lastSeenAt: string;
};

function KnowledgePageContent() {
  const { activeOrgId } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get('tab');
  const pageTab: PageTab = rawTab === 'gaps' ? 'gaps' : 'sources';

  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotOption[]>([]);
  const [knowledgeScopeBotId, setKnowledgeScopeBotId] = useState<string>('shared');
  const [ingestTab, setIngestTab] = useState<IngestTab>('url');

  const [url, setUrl] = useState('');
  const [urlName, setUrlName] = useState('');
  const [textName, setTextName] = useState('');
  const [textContent, setTextContent] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');

  const [loading, setLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [gapsLoading, setGapsLoading] = useState(false);

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [suggestions, setSuggestions] = useState<KnowledgeSuggestion[]>([]);
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);

  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingGapId, setUpdatingGapId] = useState<string | null>(null);

  const setPageTab = (next: PageTab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'sources') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    const q = params.toString();
    router.replace(q ? `/knowledge?${q}` : '/knowledge');
  };

  const loadItems = async (targetOrgId: string, scopeBotId = knowledgeScopeBotId) => {
    setItemsLoading(true);
    try {
      const params = scopeBotId === 'shared' ? undefined : { botId: scopeBotId };
      const res = await api.get(`/organizations/${targetOrgId}/knowledge`, { params });
      setItems(res.data ?? []);
    } catch {
      toast.error('Failed to load knowledge items');
    } finally {
      setItemsLoading(false);
    }
  };

  const loadBots = async (targetOrgId: string) => {
    try {
      const res = await botsApi.list(targetOrgId);
      setBots((res.data ?? []).map((bot: { id: string; name: string }) => ({ id: bot.id, name: bot.name })));
    } catch {
      setBots([]);
    }
  };

  const loadSuggestions = async (targetOrgId: string) => {
    setSuggestionsLoading(true);
    try {
      const res = await knowledgeApi.listSuggestions(targetOrgId, 'PENDING');
      setSuggestions(res.data ?? []);
    } catch {
      toast.error('Failed to load knowledge suggestions');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const loadGaps = async (targetOrgId: string) => {
    setGapsLoading(true);
    try {
      const res = await knowledgeApi.listGaps(targetOrgId);
      setGaps(res.data ?? []);
    } catch {
      toast.error('Failed to load knowledge gaps');
    } finally {
      setGapsLoading(false);
    }
  };

  useEffect(() => {
    orgsApi.list()
      .then((res) => {
        const orgs = res.data as { id: string }[];
        if (orgs.length > 0) {
          const preferred = activeOrgId
            ? (orgs.find((org) => org.id === activeOrgId) ?? orgs[0])
            : orgs[0];
          setOrgId(preferred.id);
          loadItems(preferred.id, 'shared');
          loadBots(preferred.id);
          loadGaps(preferred.id);
        }
      })
      .catch(() => {});
  }, [activeOrgId]);

  useEffect(() => {
    if (!orgId) return;
    loadItems(orgId, knowledgeScopeBotId);
  }, [orgId, knowledgeScopeBotId]);

  const handleIngestUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !url) return;
    setLoading(true);
    try {
      await api.post(`/organizations/${orgId}/knowledge/ingest/url`, {
        url,
        name: urlName || url,
        ...(knowledgeScopeBotId !== 'shared' ? { botId: knowledgeScopeBotId } : {}),
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
        ...(knowledgeScopeBotId !== 'shared' ? { botId: knowledgeScopeBotId } : {}),
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

  const handleIngestFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !selectedFile) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      form.append('name', fileName || selectedFile.name);
      if (knowledgeScopeBotId !== 'shared') form.append('botId', knowledgeScopeBotId);
      await api.post(`/organizations/${orgId}/knowledge/ingest/file`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('File ingested successfully');
      setSelectedFile(null);
      setFileName('');
      await loadItems(orgId);
    } catch {
      toast.error('Failed to ingest file');
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

  const handleApproveSuggestion = async (suggestionId: string) => {
    if (!orgId) return;
    setReviewingId(suggestionId);
    try {
      await knowledgeApi.approveSuggestion(orgId, suggestionId);
      toast.success('Knowledge suggestion approved');
      await Promise.all([loadSuggestions(orgId), loadItems(orgId)]);
    } catch {
      toast.error('Failed to approve suggestion');
    } finally {
      setReviewingId(null);
    }
  };

  const handleRejectSuggestion = async (suggestionId: string) => {
    if (!orgId) return;
    setReviewingId(suggestionId);
    try {
      await knowledgeApi.rejectSuggestion(orgId, suggestionId);
      toast.success('Knowledge suggestion rejected');
      await loadSuggestions(orgId);
    } catch {
      toast.error('Failed to reject suggestion');
    } finally {
      setReviewingId(null);
    }
  };

  const beginEditSuggestion = (suggestion: KnowledgeSuggestion) => {
    setEditingSuggestionId(suggestion.id);
    setEditTitle(suggestion.title);
    setEditContent(suggestion.content);
  };

  const cancelEditSuggestion = () => {
    setEditingSuggestionId(null);
    setEditTitle('');
    setEditContent('');
  };

  const saveEditedSuggestion = async (suggestionId: string) => {
    if (!orgId) return;
    if (!editTitle.trim() || !editContent.trim()) {
      toast.error('Title and content are required');
      return;
    }

    setReviewingId(suggestionId);
    try {
      await knowledgeApi.updateSuggestion(orgId, suggestionId, {
        title: editTitle.trim(),
        content: editContent.trim(),
      });
      setSuggestions((prev) => prev.map((s) => (
        s.id === suggestionId
          ? { ...s, title: editTitle.trim(), content: editContent.trim() }
          : s
      )));
      toast.success('Suggestion updated');
      cancelEditSuggestion();
    } catch {
      toast.error('Failed to update suggestion');
    } finally {
      setReviewingId(null);
    }
  };

  const updateGapStatus = async (gapId: string, status: GapStatus) => {
    if (!orgId || updatingGapId) return;
    setUpdatingGapId(gapId);
    try {
      await knowledgeApi.updateGapStatus(orgId, gapId, status);
      setGaps((prev) => prev.map((gap) => (gap.id === gapId ? { ...gap, status } : gap)));
    } catch {
      toast.error('Failed to update gap status');
    } finally {
      setUpdatingGapId(null);
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
    <div className="knowledge-page p-8">
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Knowledge</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Improve customer answers by maintaining trusted sources, drafts, and recurring gaps.
        </p>
      </div>

      <div className="knowledge-tabs mb-6 card p-2 flex items-center gap-1 w-fit">
        <button
          onClick={() => setPageTab('sources')}
          className={`knowledge-tab-btn px-3 py-1.5 text-xs rounded-lg transition-colors ${
            pageTab === 'sources' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Sources
        </button>
        <Link
          href={orgId ? `/settings/canned-responses?org=${orgId}` : '/settings/canned-responses'}
          className="knowledge-tab-btn px-3 py-1.5 text-xs rounded-lg transition-colors text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1.5"
        >
          <Zap className="w-3.5 h-3.5" />
          Canned Responses
        </Link>
        <button
          onClick={() => setPageTab('gaps')}
          className={`knowledge-tab-btn px-3 py-1.5 text-xs rounded-lg transition-colors ${
            pageTab === 'gaps' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Gaps ({gaps.filter((g) => g.status === 'OPEN').length})
        </button>
      </div>

      {pageTab === 'sources' ? (
        <>
          <div className="mb-4 card p-4">
            <label className="block text-xs text-zinc-500 mb-1.5 font-normal">Knowledge scope</label>
            <select
              value={knowledgeScopeBotId}
              onChange={(e) => setKnowledgeScopeBotId(e.target.value)}
              className="input-base"
            >
              <option value="shared">Shared across all agents</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>Agent pack: {bot.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-600 mt-1.5">
              In this scope, new sources are added to the selected pack. Chat retrieval uses shared knowledge plus each agent's own pack.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card p-6">
              <h2 className="font-brand font-semibold text-base tracking-tight text-white mb-4">Add source</h2>

              <div className="knowledge-ingest-tabs flex gap-1 bg-zinc-900 rounded-lg p-1 mb-6">
                {(['url', 'text', 'file'] as IngestTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setIngestTab(t)}
                    className={`knowledge-ingest-tab-btn flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-md transition-colors font-normal ${
                      ingestTab === t ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:text-zinc-300'
                    }`}
                  >
                    {t === 'url' ? (
                      <><LinkIcon className="w-3.5 h-3.5" /> From URL</>
                    ) : t === 'text' ? (
                      <><FileText className="w-3.5 h-3.5" /> Write text</>
                    ) : (
                      <><Upload className="w-3.5 h-3.5" /> Upload file</>
                    )}
                  </button>
                ))}
              </div>

              {ingestTab === 'url' ? (
                <form onSubmit={handleIngestUrl} className="space-y-4">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5 font-normal">Name (optional)</label>
                    <input
                      type="text"
                      value={urlName}
                      onChange={(e) => setUrlName(e.target.value)}
                      className="input-base"
                      placeholder="e.g. FAQ page"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5 font-normal">URL</label>
                    <input
                      type="url"
                      required
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="input-base"
                      placeholder="https://your-docs.com/page"
                    />
                  </div>
                  <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 text-sm">
                    {loading ? 'Ingesting…' : 'Ingest URL'}
                  </button>
                </form>
              ) : ingestTab === 'text' ? (
                <form onSubmit={handleIngestText} className="space-y-4">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5 font-normal">Name</label>
                    <input
                      type="text"
                      value={textName}
                      onChange={(e) => setTextName(e.target.value)}
                      className="input-base"
                      placeholder="e.g. Company overview"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5 font-normal">Content</label>
                    <textarea
                      required
                      value={textContent}
                      onChange={(e) => setTextContent(e.target.value)}
                      rows={10}
                      className="input-base resize-none"
                      placeholder="Paste key support info your AI should know"
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
              ) : (
                <form onSubmit={handleIngestFile} className="space-y-4">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5 font-normal">Name (optional)</label>
                    <input
                      type="text"
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      className="input-base"
                      placeholder="e.g. Product catalogue"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5 font-normal">File</label>
                    <label className={`flex flex-col items-center justify-center gap-2 w-full rounded-xl border-2 border-dashed px-4 py-8 cursor-pointer transition-colors ${
                      selectedFile ? 'border-blue-500/40 bg-blue-500/5' : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                    }`}>
                      <Upload className={`w-5 h-5 ${selectedFile ? 'text-blue-400' : 'text-zinc-600'}`} />
                      {selectedFile ? (
                        <span className="text-xs text-blue-300 font-medium text-center break-all">{selectedFile.name}</span>
                      ) : (
                        <span className="text-xs text-zinc-500 text-center">Click to choose a file<br /><span className="text-zinc-700">PDF, DOCX, or TXT</span></span>
                      )}
                      <input
                        type="file"
                        accept=".pdf,.docx,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        className="hidden"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !selectedFile}
                    className="btn-primary w-full py-2.5 text-sm"
                  >
                    {loading ? 'Uploading…' : 'Upload & ingest'}
                  </button>
                </form>
              )}

              <div className="mt-5 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Safety: secret-like values and private/local URLs are blocked during ingestion.
                </p>
              </div>
            </div>

            <div className="card p-6">
              <div className="flex items-center justify-between mb-4 gap-3">
                <h2 className="font-brand font-semibold text-base tracking-tight text-white">Sources</h2>
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
                  {[1, 2, 3].map((row) => <div key={row} className="h-16 rounded-xl bg-zinc-900/50 animate-pulse" />)}
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-4 text-sm text-zinc-500">
                  No ingested knowledge yet.
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1">
                  {items.map((item) => (
                    <div key={item.knowledge_file_id} className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-zinc-200 truncate">{item.name}</p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                            <span className="px-1.5 py-0.5 rounded-md border border-zinc-800 text-zinc-400">
                              {sourceTypeLabel(item.source_type)}
                            </span>
                            <span className="px-1.5 py-0.5 rounded-md border border-zinc-800 text-zinc-400">
                              {item.scope === 'agent' ? 'Agent pack' : 'Shared'}
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
        </>
      ) : null}

      {pageTab === 'gaps' ? (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="font-brand font-semibold text-base tracking-tight text-white">Knowledge gaps</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Track repeated unknown topics and close them with better knowledge.</p>
            </div>
            <button
              type="button"
              onClick={() => orgId && loadGaps(orgId)}
              disabled={gapsLoading || !orgId}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${gapsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {gapsLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((k) => <div key={k} className="h-24 rounded-xl bg-zinc-900/70 border border-zinc-800 animate-pulse" />)}</div>
          ) : gaps.length === 0 ? (
            <div className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-5 text-sm text-zinc-500">No knowledge gaps found.</div>
          ) : (
            <div className="space-y-3">
              {gaps.map((gap) => (
                <div key={gap.id} className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-zinc-100">{gap.topic || gap.topicKey}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300">{gap.status}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300">seen {gap.seenCount}x</span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-2 whitespace-pre-wrap">{gap.question}</p>
                      <p className="text-[11px] text-zinc-600 mt-1">Last seen: {new Date(gap.lastSeenAt).toLocaleString()}</p>
                      <div className="knowledge-gap-status-group mt-3 flex flex-wrap items-center gap-1.5">
                        {(['OPEN', 'ANSWERED', 'RESOLVED', 'DISMISSED'] as GapStatus[]).map((status) => (
                          <button
                            key={status}
                            onClick={() => updateGapStatus(gap.id, status)}
                            disabled={updatingGapId === gap.id || gap.status === status}
                            className={`knowledge-gap-status-btn text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                              gap.status === status
                                ? 'is-active border-amber-500/40 text-amber-200 bg-amber-500/10'
                                : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function KnowledgePageFallback() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-500 rounded-full animate-spin" />
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <Suspense fallback={<KnowledgePageFallback />}>
      <KnowledgePageContent />
    </Suspense>
  );
}
