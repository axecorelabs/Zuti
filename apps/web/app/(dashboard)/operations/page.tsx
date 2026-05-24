'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Search, RefreshCw } from 'lucide-react';
import { botsApi, orgsApi } from '@/lib/api';

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

const PAGE_SIZE = 25;

const TABS: Array<{ key: OperationsTab; label: string }> = [
  { key: 'ACTION_TASKS', label: 'Action Tasks' },
  { key: 'LEADS', label: 'Leads' },
  { key: 'BOOKINGS', label: 'Bookings' },
  { key: 'SALES_ORDERS', label: 'Sales Orders' },
  { key: 'TECH_ISSUES', label: 'Technical Issues' },
];

export default function OperationsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [bots, setBots] = useState<BotItem[]>([]);
  const [tab, setTab] = useState<OperationsTab>('ACTION_TASKS');
  const [botId, setBotId] = useState<string>('ALL');
  const [status, setStatus] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

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
    <div className="p-4 md:p-8">
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
                  const summary =
                    row.summary ||
                    row.actionTask?.summary ||
                    row.fullName ||
                    row.customerName ||
                    row.reporterName ||
                    row.preferredDatetime ||
                    row.product ||
                    '-';
                  const rowStatus = row.status || row.actionTask?.status || '-';
                  const details =
                    row.email ||
                    row.customerEmail ||
                    row.reporterEmail ||
                    row.preferredDatetime ||
                    row.destination ||
                    row.issueCategory ||
                    row.interest ||
                    '-';
                  return (
                    <tr key={row.id} className="border-b border-zinc-900/70 text-sm">
                      <td className="px-4 py-3 text-zinc-500">{createdAt}</td>
                      <td className="px-4 py-3 text-zinc-300">{botName}</td>
                      <td className="px-4 py-3 text-zinc-200">{summary}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                          {rowStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{details}</td>
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
    </div>
  );
}
