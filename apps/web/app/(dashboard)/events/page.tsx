'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, Users, ChevronRight, Download,
  CalendarDays, DollarSign, Tag, CheckCircle, XCircle,
  Clock, RefreshCw, X, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { registrationsApi, botsApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'number' | 'select';
  required: boolean;
  options?: string[];
}

interface RegistrationProduct {
  id: string;
  name: string;
  description: string | null;
  eventDate: string | null;
  capacity: number | null;
  isFree: boolean;
  priceMinor: number | null;
  currency: string;
  requiresApproval: boolean;
  confirmationMessage: string | null;
  fields: ProductField[];
  isActive: boolean;
  botId: string | null;
  _count: { entries: number };
  createdAt: string;
}

interface RegistrationEntry {
  id: string;
  productId: string;
  customerName: string | null;
  customerEmail: string | null;
  collectedFields: Record<string, string>;
  status: 'PENDING_PAYMENT' | 'AWAITING_APPROVAL' | 'CONFIRMED' | 'CANCELLED';
  paystackReference: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface BotOption { id: string; name: string }

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Pending payment',
  AWAITING_APPROVAL: 'Awaiting approval',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

const STATUS_CLASS: Record<string, string> = {
  PENDING_PAYMENT: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  AWAITING_APPROVAL: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  CONFIRMED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  CANCELLED: 'bg-zinc-800 text-zinc-500 border-zinc-700',
};

// ── CSV helper ────────────────────────────────────────────────────────────────

function exportCsv(product: RegistrationProduct, entries: RegistrationEntry[]) {
  const fieldKeys = product.fields.map((f) => f.key);
  const headers = ['Name', 'Email', 'Status', 'Registered at', ...product.fields.map((f) => f.label)];
  const rows = entries.map((e) => [
    e.customerName ?? '',
    e.customerEmail ?? '',
    STATUS_LABEL[e.status] ?? e.status,
    new Date(e.createdAt).toLocaleString(),
    ...fieldKeys.map((k) => e.collectedFields?.[k] ?? ''),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${product.name.replace(/\s+/g, '_')}_registrants.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Field editor sub-component ────────────────────────────────────────────────

function FieldEditor({ fields, onChange }: { fields: ProductField[]; onChange: (f: ProductField[]) => void }) {
  const add = () => onChange([...fields, { key: '', label: '', type: 'text', required: false }]);
  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<ProductField>) =>
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const inputCls = 'w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700 transition-colors';

  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Label (e.g. Company)"
              value={f.label}
              onChange={(e) => {
                const label = e.target.value;
                const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                update(i, { label, key });
              }}
              className={inputCls}
            />
            <select
              value={f.type}
              onChange={(e) => update(i, { type: e.target.value as ProductField['type'] })}
              className={inputCls}
            >
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="number">Number</option>
              <option value="select">Select</option>
            </select>
          </div>
          {f.type === 'select' && (
            <input
              placeholder="Comma-separated options: one, two, three"
              value={(f.options ?? []).join(', ')}
              onChange={(e) => update(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
              className={inputCls}
            />
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
              <button
                type="button"
                onClick={() => update(i, { required: !f.required })}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${f.required ? 'bg-blue-600' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition-transform ${f.required ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
              </button>
              Required
            </label>
            <button
              type="button"
              onClick={() => remove(i)}
              className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Add field
      </button>
    </div>
  );
}

// ── Product modal ─────────────────────────────────────────────────────────────

interface ProductModalProps {
  orgId: string;
  bots: BotOption[];
  existing?: RegistrationProduct;
  onSaved: () => void;
  onClose: () => void;
}

function ProductModal({ orgId, bots, existing, onSaved, onClose }: ProductModalProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [eventDate, setEventDate] = useState(
    existing?.eventDate ? existing.eventDate.split('T')[0] : '',
  );
  const [capacity, setCapacity] = useState(existing?.capacity?.toString() ?? '');
  const [isFree, setIsFree] = useState(existing?.isFree ?? true);
  const [priceMinor, setPriceMinor] = useState(
    existing?.priceMinor != null ? (existing.priceMinor / 100).toFixed(2) : '',
  );
  const currency = 'NGN'; // Only Naira is supported for now
  const [requiresApproval, setRequiresApproval] = useState(existing?.requiresApproval ?? false);
  const [confirmationMessage, setConfirmationMessage] = useState(existing?.confirmationMessage ?? '');
  const [fields, setFields] = useState<ProductField[]>(existing?.fields ?? []);
  const [botId, setBotId] = useState(existing?.botId ?? '');
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        eventDate: eventDate || null,
        capacity: capacity ? parseInt(capacity, 10) : null,
        isFree,
        priceMinor: !isFree && priceMinor ? Math.round(parseFloat(priceMinor) * 100) : null,
        currency,
        requiresApproval,
        confirmationMessage: confirmationMessage.trim() || null,
        fields: fields.filter((f) => f.key && f.label),
        botId: botId || null,
        isActive,
      };
      if (existing) {
        await registrationsApi.updateProduct(orgId, existing.id, payload);
        toast.success('Event updated');
      } else {
        await registrationsApi.createProduct(orgId, payload);
        toast.success('Event created');
      }
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : (Array.isArray(msg) ? msg[0] : 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-700 transition-colors';
  const labelCls = 'block text-xs text-zinc-400 mb-1.5 font-medium';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center shrink-0">
              <CalendarDays className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{existing ? 'Edit event' : 'Create event'}</h2>
              <p className="text-xs text-zinc-500">{existing ? 'Update event details and registration fields' : 'Set up a new registration event for your bot'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">

          {/* Name */}
          <div>
            <label className={labelCls}>Event name <span className="text-zinc-600">(required)</span></label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Annual Conference 2026" className={inputCls} />
          </div>

          {/* Description */}
          <div>
            <label className={labelCls}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Brief description shown to registrants…" className={`${inputCls} resize-none`} />
          </div>

          {/* Date + Capacity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Event date</label>
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Capacity <span className="text-zinc-600">(blank = unlimited)</span></label>
              <input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 100" className={inputCls} />
            </div>
          </div>

          {/* Pricing */}
          <div>
            <label className={labelCls}>Pricing</label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setIsFree(true)}
                className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${isFree ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-700'}`}
              >
                Free
              </button>
              <button
                type="button"
                onClick={() => setIsFree(false)}
                className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${!isFree ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:border-zinc-700'}`}
              >
                Paid
              </button>
            </div>
            {!isFree && (
              <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden focus-within:border-zinc-600 focus-within:ring-1 focus-within:ring-zinc-700 transition-colors">
                <span className="px-4 py-2.5 text-sm text-zinc-500 font-medium bg-zinc-950/60 border-r border-zinc-800 shrink-0">₦</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceMinor}
                  onChange={(e) => setPriceMinor(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 min-w-0 bg-transparent px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Toggles */}
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
              <div>
                <p className="text-sm text-zinc-300 font-medium">Requires approval</p>
                <p className="text-xs text-zinc-500 mt-0.5">Entries must be manually reviewed before being confirmed</p>
              </div>
              <button
                type="button"
                onClick={() => setRequiresApproval((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-4 ${requiresApproval ? 'bg-blue-600' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${requiresApproval ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
              <div>
                <p className="text-sm text-zinc-300 font-medium">Active</p>
                <p className="text-xs text-zinc-500 mt-0.5">Inactive events won&apos;t be offered by bots or accept new registrations</p>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ml-4 ${isActive ? 'bg-blue-600' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>

          {/* Bot link */}
          {bots.length > 0 && (
            <div>
              <label className={labelCls}>Link to bot <span className="text-zinc-600">(optional)</span></label>
              <select value={botId} onChange={(e) => setBotId(e.target.value)} className={inputCls}>
                <option value="">— Any bot —</option>
                {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}

          {/* Confirmation message */}
          <div>
            <label className={labelCls}>Custom confirmation message</label>
            <textarea value={confirmationMessage} onChange={(e) => setConfirmationMessage(e.target.value)} rows={2} placeholder="You're confirmed! See you there." className={`${inputCls} resize-none`} />
          </div>

          {/* Custom fields */}
          <div>
            <label className={`${labelCls} mb-2`}>Custom fields</label>
            <p className="text-xs text-zinc-600 mb-3">Additional info the bot will collect from the customer before registering them.</p>
            <FieldEditor fields={fields} onChange={setFields} />
          </div>

          {/* Footer */}
          <div className="flex gap-2 pt-2 border-t border-zinc-800">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary text-sm py-2.5">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Create event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const { activeOrgId } = useAuthStore();
  const [products, setProducts] = useState<RegistrationProduct[]>([]);
  const [bots, setBots] = useState<BotOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<RegistrationProduct | null>(null);
  const [entries, setEntries] = useState<RegistrationEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<RegistrationProduct | undefined>(undefined);
  const [updatingEntry, setUpdatingEntry] = useState<string | null>(null);

  const orgId = activeOrgId ?? '';

  const loadProducts = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const res = await registrationsApi.listProducts(orgId);
      setProducts(res.data);
    } catch {
      toast.error('Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const loadBots = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await botsApi.list(orgId);
      setBots((res.data as BotOption[]).map((b: BotOption) => ({ id: b.id, name: b.name })));
    } catch { /* ignore */ }
  }, [orgId]);

  const loadEntries = useCallback(async (product: RegistrationProduct) => {
    if (!orgId) return;
    setEntriesLoading(true);
    try {
      const res = await registrationsApi.listEntries(orgId, product.id);
      setEntries(res.data);
    } catch {
      toast.error('Failed to load registrants');
    } finally {
      setEntriesLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadProducts();
    loadBots();
  }, [loadProducts, loadBots]);

  const selectProduct = (p: RegistrationProduct) => {
    setSelectedProduct(p);
    loadEntries(p);
  };

  const handleDelete = async (productId: string) => {
    if (!confirm('Delete this event? All registrations will also be deleted.')) return;
    try {
      await registrationsApi.deleteProduct(orgId, productId);
      toast.success('Event deleted');
      if (selectedProduct?.id === productId) setSelectedProduct(null);
      loadProducts();
    } catch {
      toast.error('Failed to delete event');
    }
  };

  const handleEntryStatus = async (entryId: string, status: string) => {
    if (!orgId || !selectedProduct) return;
    setUpdatingEntry(entryId);
    try {
      await registrationsApi.updateEntryStatus(orgId, entryId, status);
      toast.success('Status updated');
      loadEntries(selectedProduct);
    } catch {
      toast.error('Failed to update status');
    } finally {
      setUpdatingEntry(null);
    }
  };

  const onModalSaved = () => {
    setShowModal(false);
    setEditingProduct(undefined);
    loadProducts();
  };

  const formatPrice = (p: RegistrationProduct) =>
    p.isFree ? 'Free' : `${p.currency} ${((p.priceMinor ?? 0) / 100).toFixed(2)}`;

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className="flex h-full">
      {/* Product list */}
      <div className={`flex flex-col ${selectedProduct ? 'hidden md:flex md:w-80 md:border-r md:border-zinc-800/60' : 'flex-1'}`}>
        {/* Header */}
        <div className="p-6 border-b border-zinc-800/60">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-semibold text-white">Events</h1>
            <div className="flex items-center gap-1">
              <button onClick={loadProducts} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setEditingProduct(undefined); setShowModal(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New event
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-500">Manage registration events and view sign-ups</p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="space-y-1.5">
                      <div className="h-4 w-36 rounded bg-zinc-800 animate-pulse" />
                      <div className="h-3 w-24 rounded bg-zinc-800 animate-pulse" />
                    </div>
                    <div className="h-4 w-4 rounded bg-zinc-800 animate-pulse shrink-0" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-3 w-16 rounded bg-zinc-800 animate-pulse" />
                    <div className="h-3 w-12 rounded bg-zinc-800 animate-pulse" />
                    <div className="h-3 w-14 rounded bg-zinc-800 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <CalendarDays className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm font-medium text-zinc-400">No events yet</p>
              <p className="text-xs text-zinc-600 mt-1">Create your first event to start taking registrations</p>
              <button
                onClick={() => { setEditingProduct(undefined); setShowModal(true); }}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Create event
              </button>
            </div>
          ) : (
            products.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProduct(p)}
                className={`w-full text-left rounded-xl border p-4 transition-colors group ${
                  selectedProduct?.id === p.id
                    ? 'border-blue-500/40 bg-blue-500/5'
                    : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/40 hover:bg-zinc-900'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{p.name}</span>
                      {!p.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">Inactive</span>
                      )}
                    </div>
                    {p.eventDate && (
                      <p className="text-xs text-zinc-500 mt-0.5">{formatDate(p.eventDate)}</p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0 mt-0.5" />
                </div>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {p._count.entries} registrant{p._count.entries !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    {formatPrice(p)}
                  </span>
                  {p.capacity && (
                    <span className="flex items-center gap-1">
                      <Tag className="w-3 h-3" />
                      {p.capacity - p._count.entries} left
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Entry detail panel */}
      {selectedProduct && (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Detail header */}
          <div className="p-5 border-b border-zinc-800/60 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedProduct(null)}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors md:hidden"
              >
                <X className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-sm font-semibold text-white">{selectedProduct.name}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {selectedProduct._count.entries} registrant{selectedProduct._count.entries !== 1 ? 's' : ''}
                  {selectedProduct.capacity ? ` · ${selectedProduct.capacity} capacity` : ''}
                  {selectedProduct.eventDate ? ` · ${formatDate(selectedProduct.eventDate)}` : ''}
                  {' · '}{formatPrice(selectedProduct)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => { loadEntries(selectedProduct); }}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => exportCsv(selectedProduct, entries)}
                disabled={entries.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={() => { setEditingProduct(selectedProduct); setShowModal(true); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              <button
                onClick={() => handleDelete(selectedProduct.id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>

          {/* Entry table */}
          <div className="flex-1 overflow-auto p-5">
            {entriesLoading ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Name</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Email</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Status</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Registered</th>
                      <th className="py-2 px-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {[...Array(6)].map((_, i) => (
                      <tr key={i}>
                        <td className="py-3 px-3"><div className="h-3.5 w-24 rounded bg-zinc-800 animate-pulse" /></td>
                        <td className="py-3 px-3"><div className="h-3.5 w-32 rounded bg-zinc-800 animate-pulse" /></td>
                        <td className="py-3 px-3"><div className="h-5 w-20 rounded-lg bg-zinc-800 animate-pulse" /></td>
                        <td className="py-3 px-3"><div className="h-3.5 w-16 rounded bg-zinc-800 animate-pulse" /></td>
                        <td className="py-3 px-3"><div className="h-4 w-4 rounded bg-zinc-800 animate-pulse ml-auto" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Users className="w-10 h-10 text-zinc-700 mb-3" />
                <p className="text-sm font-medium text-zinc-400">No registrants yet</p>
                <p className="text-xs text-zinc-600 mt-1">When customers register via a bot they&apos;ll appear here</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Name</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Email</th>
                      {selectedProduct.fields.filter((f) => f.required).map((f) => (
                        <th key={f.key} className="text-left py-2 px-3 text-xs font-medium text-zinc-500">{f.label}</th>
                      ))}
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Status</th>
                      <th className="text-left py-2 px-3 text-xs font-medium text-zinc-500">Registered</th>
                      <th className="py-2 px-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-zinc-900/40 transition-colors">
                        <td className="py-3 px-3 text-zinc-300 font-medium">{entry.customerName ?? '—'}</td>
                        <td className="py-3 px-3 text-zinc-400">{entry.customerEmail ?? '—'}</td>
                        {selectedProduct.fields.filter((f) => f.required).map((f) => (
                          <td key={f.key} className="py-3 px-3 text-zinc-400">
                            {entry.collectedFields?.[f.key] ?? '—'}
                          </td>
                        ))}
                        <td className="py-3 px-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-lg font-medium border ${STATUS_CLASS[entry.status] ?? 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                            {STATUS_LABEL[entry.status] ?? entry.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-zinc-500 text-xs whitespace-nowrap">
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1 justify-end">
                            {entry.status === 'AWAITING_APPROVAL' && (
                              <>
                                <button
                                  disabled={updatingEntry === entry.id}
                                  onClick={() => handleEntryStatus(entry.id, 'CONFIRMED')}
                                  title="Confirm"
                                  className="p-1 rounded text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button
                                  disabled={updatingEntry === entry.id}
                                  onClick={() => handleEntryStatus(entry.id, 'CANCELLED')}
                                  title="Reject"
                                  className="p-1 rounded text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {entry.status === 'CONFIRMED' && (
                              <button
                                disabled={updatingEntry === entry.id}
                                onClick={() => handleEntryStatus(entry.id, 'CANCELLED')}
                                title="Cancel registration"
                                className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            )}
                            {entry.status === 'PENDING_PAYMENT' && (
                              <span className="flex items-center gap-1 text-[10px] text-amber-400">
                                <Clock className="w-3 h-3" /> Awaiting payment
                              </span>
                            )}
                            {entry.status === 'CANCELLED' && (
                              <button
                                disabled={updatingEntry === entry.id}
                                onClick={() => handleEntryStatus(entry.id, 'CONFIRMED')}
                                title="Reinstate"
                                className="p-1 rounded text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                              >
                                <AlertCircle className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create/edit modal */}
      {showModal && (
        <ProductModal
          orgId={orgId}
          bots={bots}
          existing={editingProduct}
          onSaved={onModalSaved}
          onClose={() => { setShowModal(false); setEditingProduct(undefined); }}
        />
      )}
    </div>
  );
}
