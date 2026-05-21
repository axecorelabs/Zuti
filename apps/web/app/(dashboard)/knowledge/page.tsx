'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Link as LinkIcon,
  FileText,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Zap,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api, knowledgeApi, orgsApi } from '@/lib/api';

type IngestTab = 'url' | 'text';
type PageTab = 'sources' | 'suggestions' | 'gaps';
type GapStatus = 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DISMISSED';

type KnowledgeItem = {
  knowledge_file_id: string;
  name: string;
  source_type: 'url' | 'text' | 'file' | string;
  source_url?: string | null;
  chunk_count: number;
  ingested_at: string;
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

export default function KnowledgePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get('tab');
  const pageTab: PageTab = rawTab === 'suggestions' || rawTab === 'gaps' ? rawTab : 'sources';

  const [orgId, setOrgId] = useState<string | null>(null);
  const [ingestTab, setIngestTab] = useState<IngestTab>('url');

  const [url, setUrl] = useState('');
  const [urlName, setUrlName] = useState('');
  const [textName, setTextName] = useState('');
  const [textContent, setTextContent] = useState('');

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
        if (res.data.length > 0) {
          const firstOrgId = res.data[0].id;
          setOrgId(firstOrgId);
          loadItems(firstOrgId);
          loadSuggestions(firstOrgId);
          loadGaps(firstOrgId);
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
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Knowledge</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Improve customer answers by maintaining trusted sources, drafts, and recurring gaps.
        </p>
      </div>

      <div className="mb-6 card p-2 flex items-center gap-1 w-fit">
        <button
          onClick={() => setPageTab('sources')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            pageTab === 'sources' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Sources
        </button>
        <button
          onClick={() => setPageTab('suggestions')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            pageTab === 'suggestions' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Suggestions ({suggestions.length})
        </button>
        <button
          onClick={() => setPageTab('gaps')}
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            pageTab === 'gaps' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Gaps ({gaps.filter((g) => g.status === 'OPEN').length})
        </button>
      </div>

      {pageTab === 'sources' ? (
        <>
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="card p-6">
              <h2 className="font-brand font-semibold text-base tracking-tight text-white mb-4">Add source</h2>

              <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 mb-6">
                {(['url', 'text'] as IngestTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setIngestTab(t)}
                    className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-md transition-colors font-normal ${
                      ingestTab === t ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:text-zinc-300'
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
              ) : (
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
              )}

              <div className="mt-5 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <p className="text-xs text-emerald-200/90 leading-relaxed">
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

          <div className="mt-6 card p-5">
            <p className="text-xs text-zinc-500 mb-3 font-normal">Response templates</p>
            <Link
              href="/settings/canned-responses"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-zinc-800/60 transition-colors group"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-600/20 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-zinc-200">Canned Responses</p>
                <p className="text-xs text-zinc-600">Pre-written reply templates for agents and AI.</p>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
            </Link>
          </div>
        </>
      ) : null}

      {pageTab === 'suggestions' ? (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="font-brand font-semibold text-base tracking-tight text-white">Pending suggestions</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Review specialist drafts before they become knowledge.</p>
            </div>
            <button
              type="button"
              onClick={() => orgId && loadSuggestions(orgId)}
              disabled={suggestionsLoading || !orgId}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${suggestionsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {suggestionsLoading ? (
            <div className="space-y-2.5">{[1, 2].map((row) => <div key={row} className="h-20 rounded-xl bg-zinc-900/50 animate-pulse" />)}</div>
          ) : suggestions.length === 0 ? (
            <div className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-4 text-sm text-zinc-500">
              No pending knowledge suggestions.
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-3">
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {editingSuggestionId === suggestion.id ? (
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600"
                          placeholder="Suggestion title"
                        />
                      ) : (
                        <p className="text-sm text-zinc-100">{suggestion.title}</p>
                      )}
                      <p className="text-[11px] text-zinc-600 mt-1">
                        {suggestion.thread?.topic ? `Topic: ${suggestion.thread.topic}` : 'Specialist answer'}
                        {suggestion.thread?.assignedUser ? ` • ${suggestion.thread.assignedUser.name || suggestion.thread.assignedUser.email}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300">{suggestion.status}</span>
                  </div>

                  <div className="mt-3 rounded-lg border border-zinc-900 bg-zinc-950 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-1">Draft content</p>
                    {editingSuggestionId === suggestion.id ? (
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={6}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-xs text-zinc-200 resize-none focus:outline-none focus:border-zinc-600"
                        placeholder="Editable knowledge content"
                      />
                    ) : (
                      <p className="text-xs text-zinc-300 whitespace-pre-wrap line-clamp-5">{suggestion.content}</p>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {editingSuggestionId === suggestion.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveEditedSuggestion(suggestion.id)}
                          disabled={reviewingId === suggestion.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs text-white transition-colors"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditSuggestion}
                          disabled={reviewingId === suggestion.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 disabled:opacity-50 text-xs transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => beginEditSuggestion(suggestion)}
                        disabled={reviewingId === suggestion.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 disabled:opacity-50 text-xs transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleApproveSuggestion(suggestion.id)}
                      disabled={reviewingId === suggestion.id || editingSuggestionId === suggestion.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs text-white transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRejectSuggestion(suggestion.id)}
                      disabled={reviewingId === suggestion.id || editingSuggestionId === suggestion.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-red-300 hover:border-red-800 hover:bg-red-950/30 disabled:opacity-50 text-xs transition-colors"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {(['OPEN', 'ANSWERED', 'RESOLVED', 'DISMISSED'] as GapStatus[]).map((status) => (
                          <button
                            key={status}
                            onClick={() => updateGapStatus(gap.id, status)}
                            disabled={updatingGapId === gap.id || gap.status === status}
                            className={`text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                              gap.status === status
                                ? 'border-amber-500/40 text-amber-200 bg-amber-500/10'
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
