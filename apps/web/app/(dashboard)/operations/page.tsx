'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { botsApi, conversationsApi, orgsApi } from '@/lib/api';

type OperationsTab = 'ACTION_TASKS' | 'LEADS' | 'BOOKINGS' | 'SALES_ORDERS' | 'TECH_ISSUES';

interface Org { id: string }
interface BotItem { id: string; name: string }

interface PaginatedRecordsResponse {
  items: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface RowPresentation {
  summary: string;
  status: string;
  detailLines: string[];
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SINGLE_EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const PAGE_SIZE = 25;

const TABS: Array<{ key: OperationsTab; label: string }> = [
  { key: 'ACTION_TASKS', label: 'Action Tasks' },
  { key: 'LEADS', label: 'Leads' },
  { key: 'BOOKINGS', label: 'Bookings' },
  { key: 'SALES_ORDERS', label: 'Sales Orders' },
  { key: 'TECH_ISSUES', label: 'Technical Issues' },
];

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getCustomFieldLines(metadata: unknown): string[] {
  const meta = asObject(metadata);
  const custom = asObject(meta?.customFields);
  if (!custom) return [];

  return Object.entries(custom)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value).trim()}`);
}

function buildRowPresentation(tab: OperationsTab, row: any): RowPresentation {
  const summary =
    tab === 'BOOKINGS'
      ? (row.customerName || row.customerEmail || row.actionTask?.summary || '-')
      : tab === 'SALES_ORDERS'
        ? ([row.customerName, row.product].filter(Boolean).join(' - ') || row.actionTask?.summary || '-')
        : tab === 'TECH_ISSUES'
          ? (row.summary || row.actionTask?.summary || row.reporterName || '-')
          : tab === 'LEADS'
            ? (row.fullName || row.email || row.interest || '-')
            : (
              row.summary ||
              row.actionTask?.summary ||
              row.fullName ||
              row.customerName ||
              row.reporterName ||
              row.preferredDatetime ||
              row.product ||
              '-'
            );

  const rowStatus = row.status || row.actionTask?.status || '-';
  const customFieldLines = getCustomFieldLines(row.metadata);
  const detailLines =
    tab === 'BOOKINGS'
      ? [
          row.customerEmail ? `email: ${row.customerEmail}` : null,
          row.preferredDatetime ? `preferred time: ${row.preferredDatetime}` : null,
          typeof row.metadata?.bookingReason === 'string' && row.metadata.bookingReason
            ? `reason: ${row.metadata.bookingReason}`
            : null,
          row.notes ? `notes: ${row.notes}` : null,
          ...customFieldLines,
        ].filter(Boolean)
      : tab === 'SALES_ORDERS'
        ? [
            row.customerEmail ? `email: ${row.customerEmail}` : null,
            row.product ? `product: ${row.product}` : null,
            row.quantity ? `quantity: ${row.quantity}` : null,
            row.notes ? `notes: ${row.notes}` : null,
            ...customFieldLines,
          ].filter(Boolean)
        : tab === 'TECH_ISSUES'
          ? [
              row.reporterEmail ? `email: ${row.reporterEmail}` : null,
              row.issueCategory ? `category: ${row.issueCategory}` : null,
              row.severity ? `severity: ${row.severity}` : null,
              row.details ? `details: ${row.details}` : null,
              ...customFieldLines,
            ].filter(Boolean)
          : tab === 'LEADS'
            ? [
                row.email ? `email: ${row.email}` : null,
                row.phone ? `phone: ${row.phone}` : null,
                row.interest ? `interest: ${row.interest}` : null,
                row.budget ? `budget: ${row.budget}` : null,
                row.notes ? `notes: ${row.notes}` : null,
              ].filter(Boolean)
            : [
                row.conversation?.customerEmail ? `email: ${row.conversation.customerEmail}` : null,
                row.assignedEndpoint?.destination ? `endpoint: ${row.assignedEndpoint.destination}` : null,
                row.actionType ? `action: ${row.actionType}` : null,
                row.dedupeKey ? `dedupe: ${row.dedupeKey}` : null,
              ].filter(Boolean);

  return { summary, status: rowStatus, detailLines: detailLines as string[] };
}

function renderLineWithEmailLinks(line: string, keyPrefix: string) {
  const matches = Array.from(line.matchAll(EMAIL_PATTERN));
  if (matches.length === 0) return line;

  const parts: JSX.Element[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const email = match[0];
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push(<span key={`${keyPrefix}-txt-${index}`}>{line.slice(cursor, start)}</span>);
    }
    parts.push(
      <a
        key={`${keyPrefix}-mail-${index}`}
        href={`mailto:${email}`}
        className="text-blue-300 underline decoration-blue-400/60 underline-offset-2 hover:text-blue-200"
      >
        {email}
      </a>,
    );
    cursor = start + email.length;
  });

  if (cursor < line.length) {
    parts.push(<span key={`${keyPrefix}-tail`}>{line.slice(cursor)}</span>);
  }

  return parts;
}

function getSourceConversationId(tab: OperationsTab, row: any): string | null {
  if (tab === 'ACTION_TASKS') return row.conversation?.id ?? null;
  return row.actionTask?.conversationId ?? null;
}

function getFollowUpEmail(tab: OperationsTab, row: any, detailLines: string[]): string | null {
  const knownEmail =
    tab === 'ACTION_TASKS'
      ? (row.conversation?.customerEmail ?? null)
      : tab === 'LEADS'
        ? (row.email ?? null)
        : tab === 'BOOKINGS'
          ? (row.customerEmail ?? null)
          : tab === 'SALES_ORDERS'
            ? (row.customerEmail ?? null)
            : tab === 'TECH_ISSUES'
              ? (row.reporterEmail ?? null)
              : null;

  if (typeof knownEmail === 'string' && knownEmail.trim().length > 0) return knownEmail.trim();

  for (const line of detailLines) {
    const match = line.match(SINGLE_EMAIL_PATTERN);
    if (match?.[0]) return match[0];
  }

  return null;
}

function getFollowUpCustomerName(tab: OperationsTab, row: any): string | null {
  const name =
    tab === 'ACTION_TASKS'
      ? (row.conversation?.customerName ?? null)
      : tab === 'LEADS'
        ? (row.fullName ?? null)
        : tab === 'BOOKINGS'
          ? (row.customerName ?? null)
          : tab === 'SALES_ORDERS'
            ? (row.customerName ?? null)
            : tab === 'TECH_ISSUES'
              ? (row.reporterName ?? null)
              : null;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null;
}

export default function OperationsPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotItem[]>([]);
  const [tab, setTab] = useState<OperationsTab>('ACTION_TASKS');
  const [botId, setBotId] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [selectedRow, setSelectedRow] = useState<any | null>(null);
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);
  const [startingFollowUp, setStartingFollowUp] = useState(false);
  const [allowExternalDelivery, setAllowExternalDelivery] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const openDetailsPanel = (row: any) => {
    setSelectedRow(row);
    requestAnimationFrame(() => setIsDetailsPanelOpen(true));
  };

  const closeDetailsPanel = () => {
    setIsDetailsPanelOpen(false);
    setTimeout(() => setSelectedRow(null), 220);
    setAllowExternalDelivery(true);
  };

  const openSourceConversation = (conversationId: string) => {
    closeDetailsPanel();
    router.push(`/inbox?conversationId=${encodeURIComponent(conversationId)}`);
  };

  const startFollowUpConversation = async (row: any, view: RowPresentation) => {
    if (!orgId) return;
    const email = getFollowUpEmail(tab, row, view.detailLines);
    if (!email) {
      toast.error('No customer email found in this record');
      return;
    }
    const botIdValue = row.bot?.id;
    if (!botIdValue) {
      toast.error('No bot found for this record');
      return;
    }

    try {
      setStartingFollowUp(true);
      const sourceConversationId = getSourceConversationId(tab, row);
      const response = await conversationsApi.startInternal(orgId, {
        botId: botIdValue,
        customerEmail: email,
        customerName: getFollowUpCustomerName(tab, row) ?? undefined,
        subject: `Follow-up: ${view.summary}`,
        sourceRecordType: tab,
        sourceRecordId: String(row.id ?? ''),
        sourceActionTaskId: row.actionTask?.id ?? (tab === 'ACTION_TASKS' ? row.id : undefined),
        sourceConversationId: sourceConversationId ?? undefined,
        allowExternalDelivery,
      });

      const conversationId = response.data?.id as string | undefined;
      const reused = response.data?.reused === true;
      if (!conversationId) {
        toast.error('Unable to open inbox conversation');
        return;
      }

      closeDetailsPanel();
      router.push(`/inbox?conversationId=${encodeURIComponent(conversationId)}`);
      toast.success(reused ? 'Existing internal follow-up opened' : 'Internal follow-up conversation started');
    } catch {
      toast.error('Failed to start internal follow-up conversation');
    } finally {
      setStartingFollowUp(false);
    }
  };

  useEffect(() => {
    orgsApi.list().then(async (res) => {
      const first = (res.data ?? [])[0] as Org | undefined;
      if (!first) {
        setLoading(false);
        return;
      }
      setOrgId(first.id);
      const botsRes = await botsApi.list(first.id).catch(() => ({ data: [] }));
      setBots((botsRes.data ?? []).map((b: BotItem) => ({ id: b.id, name: b.name })));
    }).catch(() => setLoading(false));
  }, []);

  const getBaseParams = (overrides?: { page?: number; limit?: number }) => ({
      botId: botId !== 'ALL' ? botId : undefined,
      status: status !== 'ALL' ? status : undefined,
      q: q.trim() || undefined,
      limit: overrides?.limit ?? PAGE_SIZE,
      page: overrides?.page ?? page,
    });

  const fetchByTab = async (params: Record<string, string | number | undefined>): Promise<PaginatedRecordsResponse> => {
    if (!orgId) return { items: [], total: 0, page: 1, limit: PAGE_SIZE, totalPages: 1 };
    if (tab === 'ACTION_TASKS') {
      const res = await orgsApi.listActionTasks(orgId, params as any);
      return res.data as PaginatedRecordsResponse;
    }
    if (tab === 'LEADS') {
      const res = await orgsApi.listLeads(orgId, params as any);
      return res.data as PaginatedRecordsResponse;
    }
    if (tab === 'BOOKINGS') {
      const res = await orgsApi.listBookings(orgId, params as any);
      return res.data as PaginatedRecordsResponse;
    }
    if (tab === 'SALES_ORDERS') {
      const res = await orgsApi.listSalesOrders(orgId, params as any);
      return res.data as PaginatedRecordsResponse;
    }
    const res = await orgsApi.listTechnicalIssues(orgId, params as any);
    return res.data as PaginatedRecordsResponse;
  };

  const loadRows = async () => {
    if (!orgId) return;
    setLoading(true);

    try {
      const data = await fetchByTab(getBaseParams());
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!orgId) return;
    loadRows();
  }, [orgId, tab, botId, status, page]);

  useEffect(() => {
    setSelectedRow(null);
    setIsDetailsPanelOpen(false);
    setAllowExternalDelivery(true);
  }, [tab, page, botId, status]);

  const statusOptions = useMemo(() => {
    if (tab === 'ACTION_TASKS') return ['DETECTED', 'QUEUED', 'ROUTED', 'SENT', 'DELIVERED', 'FAILED', 'COMPLETED'];
    if (tab === 'BOOKINGS') return ['REQUESTED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED'];
    if (tab === 'SALES_ORDERS') return ['NEW', 'PROCESSING', 'COMPLETED', 'CANCELLED'];
    if (tab === 'TECH_ISSUES') return ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    return [] as string[];
  }, [tab]);

  const handleExportCsv = async () => {
    if (!orgId) return;
    setExporting(true);
    try {
      let currentPage = 1;
      const allItems: any[] = [];
      while (true) {
        const data = await fetchByTab(getBaseParams({ page: currentPage, limit: 200 }));
        allItems.push(...(data.items ?? []));
        if (currentPage >= (data.totalPages ?? 1)) break;
        currentPage += 1;
      }

      const csvEscape = (value: unknown): string => {
        const text = String(value ?? '');
        if (text.includes(',') || text.includes('"') || text.includes('\n')) {
          return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
      };

      const buildRows = (): { headers: string[]; records: string[][] } => {
        if (tab === 'ACTION_TASKS') {
          const headers = ['id', 'createdAt', 'bot', 'actionType', 'status', 'summary', 'customerName', 'customerEmail', 'endpoint', 'dedupeKey'];
          const records = allItems.map((row) => [
            row.id,
            row.createdAt,
            row.bot?.name,
            row.actionType,
            row.status,
            row.summary,
            row.conversation?.customerName,
            row.conversation?.customerEmail,
            row.assignedEndpoint?.destination,
            row.dedupeKey,
          ].map(csvEscape));
          return { headers, records };
        }
        if (tab === 'LEADS') {
          const headers = ['id', 'createdAt', 'bot', 'fullName', 'email', 'phone', 'interest', 'budget', 'notes', 'actionStatus'];
          const records = allItems.map((row) => [
            row.id,
            row.createdAt,
            row.bot?.name,
            row.fullName,
            row.email,
            row.phone,
            row.interest,
            row.budget,
            row.notes,
            row.actionTask?.status,
          ].map(csvEscape));
          return { headers, records };
        }
        if (tab === 'BOOKINGS') {
          const headers = ['id', 'createdAt', 'bot', 'customerName', 'customerEmail', 'preferredDatetime', 'status', 'notes', 'actionStatus'];
          const records = allItems.map((row) => [
            row.id,
            row.createdAt,
            row.bot?.name,
            row.customerName,
            row.customerEmail,
            row.preferredDatetime,
            row.status,
            row.notes,
            row.actionTask?.status,
          ].map(csvEscape));
          return { headers, records };
        }
        if (tab === 'SALES_ORDERS') {
          const headers = ['id', 'createdAt', 'bot', 'customerName', 'customerEmail', 'product', 'quantity', 'status', 'notes', 'actionStatus'];
          const records = allItems.map((row) => [
            row.id,
            row.createdAt,
            row.bot?.name,
            row.customerName,
            row.customerEmail,
            row.product,
            row.quantity,
            row.status,
            row.notes,
            row.actionTask?.status,
          ].map(csvEscape));
          return { headers, records };
        }
        const headers = ['id', 'createdAt', 'bot', 'reporterName', 'reporterEmail', 'issueCategory', 'severity', 'summary', 'status', 'actionStatus'];
        const records = allItems.map((row) => [
          row.id,
          row.createdAt,
          row.bot?.name,
          row.reporterName,
          row.reporterEmail,
          row.issueCategory,
          row.severity,
          row.summary,
          row.status,
          row.actionTask?.status,
        ].map(csvEscape));
        return { headers, records };
      };

      const { headers, records } = buildRows();
      const csv = [headers.join(','), ...records.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const fileBase = tab.toLowerCase();
      a.href = url;
      a.download = `${fileBase}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="operations-page p-4 md:p-8">
      <div className="mb-6">
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Operations</h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">
          Search and review action tasks, bookings, and collected records from forwarding workflows.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setTab(item.key);
                setStatus('ALL');
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs rounded-md ${
                tab === item.key ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-2 md:grid-cols-4">
        <div className="md:col-span-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <Search className="w-4 h-4 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (page === 1) {
                  loadRows();
                } else {
                  setPage(1);
                }
              }
            }}
            placeholder="Search by name, email, summary, product..."
            className="w-full bg-transparent text-sm text-zinc-200 outline-none"
          />
        </div>

        <select
          value={botId}
          onChange={(e) => {
            setBotId(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
        >
          <option value="ALL">All bots</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>{bot.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
          >
            <option value="ALL">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={loadRows}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 hover:bg-zinc-900"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleExportCsv}
            disabled={exporting || loading}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
            title="Export CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead className="bg-zinc-900/80 border-b border-zinc-800">
              <tr className="text-left text-xs text-zinc-500">
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Bot</th>
                <th className="px-4 py-3">Summary</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">Loading...</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-zinc-500">No records found.</td>
                </tr>
              ) : (
                rows.map((row) => {
                  const createdAt = row.createdAt ? new Date(row.createdAt).toLocaleString() : '-';
                  const botName = row.bot?.name || '-';
                  const view = buildRowPresentation(tab, row);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-zinc-900/70 text-sm cursor-pointer hover:bg-zinc-900/40 focus-within:bg-zinc-900/40"
                      onClick={() => openDetailsPanel(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openDetailsPanel(row);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <td className="px-4 py-3 text-zinc-500">{createdAt}</td>
                      <td className="px-4 py-3 text-zinc-300">{botName}</td>
                      <td className="px-4 py-3 text-zinc-200">{view.summary}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                          {view.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 w-[320px] max-w-[320px] align-top">
                        {view.detailLines.length === 0 ? (
                          '-'
                        ) : (
                          <div className="space-y-1">
                            {view.detailLines.slice(0, 3).map((line: string, index: number) => (
                              <div key={`${row.id}-detail-${index}`} className="text-xs leading-relaxed text-zinc-400 truncate">
                                {line}
                              </div>
                            ))}
                            {view.detailLines.length > 3 && (
                              <div className="text-xs text-blue-400">+ {view.detailLines.length - 3} more</div>
                            )}
                            <div className="text-[11px] text-zinc-500 pt-1">View details</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>
          Showing page {page} of {totalPages} · {total} total records
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {selectedRow && (
        <div
          className={`fixed inset-0 z-50 transition-opacity duration-200 ${isDetailsPanelOpen ? 'bg-black/60 opacity-100' : 'bg-black/0 opacity-0'}`}
          onClick={closeDetailsPanel}
        >
          <aside
            className={`absolute right-0 top-0 h-full w-full max-w-[560px] border-l border-zinc-800 bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 shadow-2xl transition-transform duration-200 ease-out ${isDetailsPanelOpen ? 'translate-x-0' : 'translate-x-full'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 px-5 py-4 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Operations Record</p>
                    <h3 className="text-base font-semibold text-white mt-1">Record details</h3>
                    <p className="text-xs text-zinc-500 mt-1 break-all">{selectedRow.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeDetailsPanel}
                    className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-white hover:border-zinc-600"
                  >
                    Close
                  </button>
                </div>
              </div>

              {(() => {
                const view = buildRowPresentation(tab, selectedRow);
                const selectedCreatedAt = selectedRow.createdAt ? new Date(selectedRow.createdAt).toLocaleString() : '-';
                const selectedBotName = selectedRow.bot?.name || '-';
                const sourceConversationId = getSourceConversationId(tab, selectedRow);
                const followUpEmail = getFollowUpEmail(tab, selectedRow, view.detailLines);
                return (
                  <div className="space-y-3 px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[11px] text-zinc-300">
                        {TABS.find((item) => item.key === tab)?.label}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[11px] text-zinc-300">
                        {view.status}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                        <p className="text-[11px] text-zinc-500">Bot</p>
                        <p className="text-sm text-zinc-200 mt-1 break-words max-w-[24ch]">{selectedBotName}</p>
                      </div>
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                        <p className="text-[11px] text-zinc-500">Created</p>
                        <p className="text-sm text-zinc-200 mt-1 break-words max-w-[24ch]">{selectedCreatedAt}</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                      <p className="text-[11px] text-zinc-500 mb-1">Summary</p>
                      <p className="text-sm leading-6 text-zinc-200 break-words max-w-[52ch]">{view.summary}</p>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                      <p className="text-[11px] text-zinc-500 mb-2">Conversation actions</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => sourceConversationId && openSourceConversation(sourceConversationId)}
                          disabled={!sourceConversationId}
                          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:text-white hover:border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Open source conversation
                        </button>
                        <button
                          type="button"
                          onClick={() => startFollowUpConversation(selectedRow, view)}
                          disabled={!followUpEmail || startingFollowUp}
                          className="rounded-lg border border-blue-600/50 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-600/10 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {startingFollowUp ? 'Starting follow-up...' : 'Start internal follow-up'}
                        </button>
                      </div>
                      <label className="mt-3 inline-flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={allowExternalDelivery}
                          onChange={(e) => setAllowExternalDelivery(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500/40"
                        />
                        Allow external email delivery for this follow-up
                      </label>
                      <p className="text-[11px] text-zinc-500 mt-2">
                        {followUpEmail ? `Follow-up target: ${followUpEmail}` : 'No email found for follow-up in this record'}
                      </p>
                    </div>

                    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                      <p className="text-[11px] text-zinc-500 mb-2">Captured details</p>
                      {view.detailLines.length === 0 ? (
                        <p className="text-sm text-zinc-400">No additional details available.</p>
                      ) : (
                        <div className="space-y-2 max-w-[52ch]">
                          {view.detailLines.map((line, index) => (
                            <div
                              key={`selected-${selectedRow.id}-${index}`}
                              className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 px-2.5 py-2 text-sm text-zinc-300 break-words leading-6"
                            >
                              {renderLineWithEmailLinks(line, `selected-${selectedRow.id}-${index}`)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
