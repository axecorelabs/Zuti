'use client';

import { useRef, useState } from 'react';
import { Upload, Link as LinkIcon, BookOpen, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, orgsApi } from '@/lib/api';

type TabType = 'file' | 'url';

export default function KnowledgePage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabType>('file');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load org on mount
  useState(() => {
    orgsApi.list().then((res) => {
      if (res.data.length > 0) setOrgId(res.data[0].id);
    }).catch(() => {});
  });

  const handleIngestUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !url) return;
    setLoading(true);
    try {
      await api.post('/knowledge/ingest/url', {
        url,
        organization_id: orgId,
      });
      toast.success('URL ingested successfully');
      setUrl('');
    } catch {
      toast.error('Failed to ingest URL');
    } finally {
      setLoading(false);
    }
  };

  const handleIngestFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('organization_id', orgId);
    try {
      await api.post('/knowledge/ingest/file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('File ingested successfully');
      setFile(null);
    } catch {
      toast.error('Failed to ingest file');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
          Knowledge Base
        </h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Train your AI with documents and URLs.
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
            {(['file', 'url'] as TabType[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-md transition-colors font-normal ${
                  tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:text-zinc-300'
                }`}
              >
                {t === 'file' ? (
                  <><Upload className="w-3.5 h-3.5" /> Upload file</>
                ) : (
                  <><LinkIcon className="w-3.5 h-3.5" /> From URL</>
                )}
              </button>
            ))}
          </div>

          {tab === 'url' ? (
            <form onSubmit={handleIngestUrl} className="space-y-4">
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
            <form onSubmit={handleIngestFile} className="space-y-4">
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full border border-dashed border-zinc-800 rounded-xl p-8 flex flex-col items-center gap-2 hover:border-zinc-700 hover:bg-zinc-900/30 transition-all"
                >
                  {file ? (
                    <>
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-zinc-400" />
                        <span className="text-sm text-zinc-300 font-normal">{file.name}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setFile(null); }}
                          className="text-zinc-600 hover:text-zinc-300"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="text-xs text-zinc-600 font-light">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-zinc-700" />
                      <p className="text-sm text-zinc-500 font-light">
                        Click to upload PDF, DOCX, or TXT
                      </p>
                      <p className="text-xs text-zinc-700">Max 10 MB</p>
                    </>
                  )}
                </button>
              </div>
              <button
                type="submit"
                disabled={loading || !file}
                className="btn-primary w-full py-2.5 text-sm"
              >
                {loading ? 'Processing…' : 'Upload & ingest'}
              </button>
            </form>
          )}
        </div>

        {/* Info panel */}
        <div className="card p-6">
          <h2 className="font-brand font-semibold text-base tracking-tight text-white mb-4">
            How it works
          </h2>
          <ol className="space-y-4">
            {[
              {
                n: '01',
                title: 'Upload your content',
                desc: 'Add PDF documents, DOCX files, or URLs with product info, FAQs, or support docs.',
              },
              {
                n: '02',
                title: 'AI processes it',
                desc: 'Zuti chunks and embeds your content into a vector database for semantic search.',
              },
              {
                n: '03',
                title: 'Bots answer intelligently',
                desc: 'When a customer asks a question, your bot finds the most relevant content and generates a helpful response.',
              },
            ].map(({ n, title, desc }) => (
              <li key={n} className="flex gap-4">
                <span className="font-brand font-semibold text-zinc-800 text-sm shrink-0 pt-0.5">
                  {n}
                </span>
                <div>
                  <p className="text-sm text-zinc-300 font-normal">{title}</p>
                  <p className="text-xs text-zinc-600 font-light mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
