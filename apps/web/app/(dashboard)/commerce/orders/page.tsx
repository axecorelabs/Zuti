'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { commerceApi, orgApi, resolveOrgId } from '@/lib/api';
import CustomSelect from '@/components/custom-select';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Package2,
  PackageCheck,
  Plus,
  ShoppingBag,
  Truck,
  X,
} from 'lucide-react';

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'text-zinc-500 bg-zinc-800 border-zinc-700',
  PENDING_PAYMENT: 'text-amber-400 bg-amber-600/10 border-amber-600/20',
  PAID: 'text-emerald-400 bg-emerald-600/10 border-emerald-600/20',
  CANCELLED: 'text-red-400 bg-red-600/10 border-red-600/20',
  FAILED: 'text-red-400 bg-red-600/10 border-red-600/20',
};

// Fulfillment pipeline for a paid order. Sub-status lives on order.metadata.fulfillment (backend).
const FULFILLMENT_STAGES = ['PREPARING', 'SHIPPED', 'DELIVERED'] as const;
type FulfillmentStatus = 'UNFULFILLED' | (typeof FULFILLMENT_STAGES)[number];

const FULFILLMENT_STYLE: Record<string, string> = {
  UNFULFILLED: 'text-zinc-400 bg-zinc-800 border-zinc-700',
  PREPARING: 'text-amber-400 bg-amber-600/10 border-amber-600/20',
  SHIPPED: 'text-blue-400 bg-blue-600/10 border-blue-600/20',
  DELIVERED: 'text-emerald-400 bg-emerald-600/10 border-emerald-600/20',
};

const FULFILLMENT_LABEL: Record<string, string> = {
  UNFULFILLED: 'Unfulfilled',
  PREPARING: 'Preparing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
};

function getFulfillment(order: any): FulfillmentStatus {
  const s = order?.metadata?.fulfillment?.status;
  return (typeof s === 'string' && s in FULFILLMENT_LABEL ? s : 'UNFULFILLED') as FulfillmentStatus;
}

type PaymentState = {
  reference: string;
  authorizationUrl: string;
  message: string | null;
  loading: boolean;
};

const defaultPaymentState = (): PaymentState => ({
  reference: '',
  authorizationUrl: '',
  message: null,
  loading: false,
});

export default function OrdersPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [paymentStates, setPaymentStates] = useState<Record<string, PaymentState>>({});
  const [fulfilling, setFulfilling] = useState<string | null>(null);

  // Create order form
  const [storeId, setStoreId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const backdropRef = useRef<HTMLDivElement>(null);

  const getPs = (orderId: string): PaymentState =>
    paymentStates[orderId] ?? defaultPaymentState();

  const patchPs = (orderId: string, patch: Partial<PaymentState>) =>
    setPaymentStates((prev) => ({
      ...prev,
      [orderId]: { ...(prev[orderId] ?? defaultPaymentState()), ...patch },
    }));

  const loadData = async (targetOrgId: string) => {
    const [storesRes, productsRes, ordersRes] = await Promise.all([
      commerceApi.listStores(targetOrgId),
      commerceApi.searchProducts(targetOrgId),
      commerceApi.listOrders(targetOrgId),
    ]);

    const nextStores = Array.isArray(storesRes.data) ? storesRes.data : [];
    const nextProducts = Array.isArray(productsRes.data?.items) ? productsRes.data.items : [];
    const nextOrders = Array.isArray(ordersRes.data) ? ordersRes.data : [];

    setStores(nextStores);
    setProducts(nextProducts);
    setOrders(nextOrders);
    setLoadingOrders(false);

    if (nextStores[0] && !storeId) setStoreId(nextStores[0].id);
    const firstVariant = nextProducts.flatMap((p: any) => p.variants || [])[0];
    if (firstVariant && !variantId) setVariantId(firstVariant.id);
  };

  useEffect(() => {
    async function setup() {
      const orgs = (await orgApi.listSummary()).data as Array<{ id: string }>;
      const resolved = resolveOrgId(orgs as any);
      if (!resolved) return;
      setOrgId(resolved);
      await loadData(resolved);
    }
    setup();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModalOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closeModal = () => setModalOpen(false);

  const createOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !storeId || !variantId) return;
    setCreating(true);
    try {
      const res = await commerceApi.createOrder(orgId, {
        storeId,
        customerName: customerName || undefined,
        customerEmail: customerEmail || undefined,
        customerPhone: customerPhone || undefined,
        deliveryAddress: deliveryAddress || undefined,
        notes: notes || undefined,
        items: [{ variantId, quantity: Number(quantity) }],
      });
      const newOrderId = String(res.data?.id ?? '');
      if (newOrderId) {
        setCustomerName(''); setCustomerEmail(''); setCustomerPhone('');
        setDeliveryAddress(''); setNotes(''); setQuantity('1');
        closeModal();
        await loadData(orgId);
        setExpandedOrderId(newOrderId);
      }
    } finally {
      setCreating(false);
    }
  };

  const initializePayment = async (order: any) => {
    if (!orgId) return;
    patchPs(order.id, { loading: true, message: null });
    try {
      const res = await commerceApi.initializePayment(orgId, order.id, {
        customerEmail: (order.customerEmail as string) || undefined,
      });
      patchPs(order.id, {
        reference: String(res.data?.reference ?? ''),
        authorizationUrl: String(res.data?.authorizationUrl ?? ''),
        message: 'Payment initialized. Share the checkout link with your customer.',
        loading: false,
      });
      await loadData(orgId);
    } catch {
      patchPs(order.id, { message: 'Failed to initialize payment.', loading: false });
    }
  };

  const verifyPayment = async (order: any) => {
    if (!orgId) return;
    const ps = getPs(order.id);
    patchPs(order.id, { loading: true, message: null });
    try {
      const res = await commerceApi.verifyPayment(
        orgId,
        order.id,
        ps.reference ? { reference: ps.reference } : undefined,
      );
      patchPs(order.id, {
        message: (res.data as any)?.paid
          ? 'Payment verified — order marked as paid.'
          : 'Payment not settled yet.',
        loading: false,
      });
      await loadData(orgId);
    } catch {
      patchPs(order.id, { message: 'Verification failed.', loading: false });
    }
  };

  const setFulfillment = async (
    order: any,
    status: 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED',
  ) => {
    if (!orgId) return;
    setFulfilling(order.id);
    try {
      await commerceApi.updateFulfillment(orgId, order.id, status);
      await loadData(orgId);
    } catch {
      patchPs(order.id, { message: 'Could not update fulfillment status.' });
    } finally {
      setFulfilling(null);
    }
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  const toggleExpand = (orderId: string) =>
    setExpandedOrderId((prev) => (prev === orderId ? null : orderId));

  return (
    <div className="p-4 md:p-8 space-y-6">
      {/* Create order modal */}
      {modalOpen && (
        <div
          ref={backdropRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === backdropRef.current) closeModal(); }}
        >
          <div className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-900">
              <div>
                <h2 className="font-brand font-semibold text-base text-white tracking-tight">New order draft</h2>
                <p className="text-xs text-zinc-500 font-light mt-0.5">Fill in customer and product details.</p>
              </div>
              <button type="button" onClick={closeModal} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={createOrder} className="px-6 py-5 space-y-3 max-h-[70vh] overflow-y-auto">
              <CustomSelect
                options={stores.map((s) => ({ value: s.id, label: s.name }))}
                value={storeId}
                onChange={setStoreId}
                placeholder="Select store…"
                disabled={stores.length === 0}
              />
              <CustomSelect
                options={products.flatMap((p: any) =>
                  (p.variants || []).map((v: any) => ({
                    value: v.id,
                    label: `${p.title} · ${v.sku}`,
                    sub: `${(v.priceMinor / 100).toLocaleString()} ${v.currency}`,
                  }))
                )}
                value={variantId}
                onChange={setVariantId}
                placeholder="Select variant…"
              />
              <input
                className="input-base"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Quantity"
                required
                type="number"
                min="1"
              />
              <div className="border-t border-zinc-900 pt-3">
                <p className="text-xs text-zinc-600 font-light mb-2">Customer details (optional)</p>
                <div className="space-y-2">
                  <input className="input-base" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Full name" />
                  <input className="input-base" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="Email address" type="email" />
                  <input className="input-base" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone number" />
                  <input className="input-base" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Delivery address" />
                  <input className="input-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Order notes" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-ghost flex-1">Cancel</button>
                <button type="submit" className="btn-primary flex-1" disabled={creating || !storeId || !variantId}>
                  {creating ? 'Creating…' : 'Create draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Orders</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">Manage orders and process Paystack payments.</p>
        </div>
        <button type="button" onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New order
        </button>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-normal text-white">Order history</h2>
          {!loadingOrders && (
            <span className="text-xs text-zinc-600">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loadingOrders ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-zinc-900 animate-pulse rounded-xl" />)}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShoppingBag className="w-8 h-8 text-zinc-700" />
            <p className="text-sm text-zinc-600 font-light">No orders yet.</p>
            <button type="button" onClick={() => setModalOpen(true)} className="btn-secondary text-xs flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Create first order
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => {
              const isExpanded = expandedOrderId === order.id;
              const ps = getPs(order.id as string);
              const isPaid = order.status === 'PAID' || order.paymentStatus === 'SUCCESS';
              const isCancelled = order.status === 'CANCELLED';
              // Prefer the persisted payment record (survives refresh; carries bot-order links) over
              // transient local state from a manual "Initialize payment" click this session.
              const payment = order.payments?.[0];
              const persistedLink = payment && payment.status === 'PENDING' ? (payment.authorizationUrl as string) || '' : '';
              const link = ps.authorizationUrl || persistedLink;
              const reference = ps.reference || (payment?.reference as string) || '';
              const hasLink = !!link;
              const fulfillment = getFulfillment(order);
              const money = (minor: number) => `${((minor ?? 0) / 100).toLocaleString()} ${order.currency}`;

              return (
                <div
                  key={order.id}
                  className={`rounded-xl border transition-colors ${
                    isExpanded ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-zinc-900'
                  }`}
                >
                  {/* Row header */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(order.id as string)}
                    className="w-full text-left px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Package2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <p className="text-sm text-white font-light truncate">
                          {order.customerName || order.customerEmail || 'Anonymous'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center text-[10px] font-normal border rounded-full px-2 py-0.5 ${STATUS_STYLE[order.status] ?? STATUS_STYLE.DRAFT}`}>
                          {order.status}
                        </span>
                        {isPaid ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" /> PAID
                          </span>
                        ) : !isCancelled ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
                            <Clock className="w-3 h-3" /> {order.paymentStatus}
                          </span>
                        ) : null}
                        {isPaid && !isCancelled && (
                          <span className={`inline-flex items-center text-[10px] font-normal border rounded-full px-2 py-0.5 ${FULFILLMENT_STYLE[fulfillment]}`}>
                            {FULFILLMENT_LABEL[fulfillment]}
                          </span>
                        )}
                        <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-zinc-600">
                      <span>{order.store?.name}</span>
                      <span>{(order.totalMinor / 100).toLocaleString()} {order.currency}</span>
                      <span>{order.items?.length ?? 0} item{(order.items?.length ?? 0) !== 1 ? 's' : ''}</span>
                      <span className="ml-auto font-mono text-[10px] text-zinc-700">{(order.id as string).slice(-8)}</span>
                    </div>
                  </button>

                  {/* Expanded: what to fulfill — items, customer, payment, fulfillment */}
                  {isExpanded && (
                    <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
                      {/* Line items — the heart of fulfillment */}
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">Items</p>
                        <div className="space-y-1.5">
                          {(order.items ?? []).map((item: any) => {
                            const title = item.variant?.product?.title || item.lineDescription || 'Item';
                            const variantBits = [item.variant?.title, item.variant?.sku].filter(Boolean).join(' · ');
                            return (
                              <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                                <div className="min-w-0">
                                  <p className="text-zinc-200 font-light truncate">
                                    <span className="text-zinc-500">{item.quantity}×</span> {title}
                                  </p>
                                  {variantBits && <p className="text-[11px] text-zinc-600 font-mono truncate">{variantBits}</p>}
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-zinc-300 font-light">{money(item.lineTotalMinor)}</p>
                                  {item.quantity > 1 && <p className="text-[10px] text-zinc-600">{money(item.unitPriceMinor)} ea</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between text-sm">
                          <span className="text-zinc-500">Total</span>
                          <span className="text-white font-normal">{money(order.totalMinor)}</span>
                        </div>
                      </div>

                      {/* Customer + order meta */}
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        {order.customerEmail && (
                          <div className="min-w-0"><span className="text-zinc-600">Email </span><span className="text-zinc-400 break-all">{order.customerEmail}</span></div>
                        )}
                        {order.customerPhone && (
                          <div><span className="text-zinc-600">Phone </span><span className="text-zinc-400">{order.customerPhone}</span></div>
                        )}
                        {order.deliveryAddress && (
                          <div className="col-span-2"><span className="text-zinc-600">Ship to </span><span className="text-zinc-300">{order.deliveryAddress}</span></div>
                        )}
                        {order.notes && (
                          <div className="col-span-2"><span className="text-zinc-600">Notes </span><span className="text-zinc-400">{order.notes}</span></div>
                        )}
                        <div className="col-span-2 text-zinc-600">
                          Placed {new Date(order.createdAt).toLocaleString()}
                        </div>
                      </div>

                      {/* Fulfillment pipeline — only for a paid order */}
                      {isPaid && !isCancelled && (
                        <div className="border-t border-zinc-800 pt-3">
                          <p className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">Fulfillment</p>
                          <div className="flex flex-wrap gap-2">
                            {FULFILLMENT_STAGES.map((stage) => {
                              const active = fulfillment === stage;
                              const Icon = stage === 'PREPARING' ? Package2 : stage === 'SHIPPED' ? Truck : PackageCheck;
                              return (
                                <button
                                  key={stage}
                                  type="button"
                                  disabled={fulfilling === order.id || active}
                                  onClick={() => setFulfillment(order, stage)}
                                  className={`inline-flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 border transition-colors disabled:opacity-100 ${
                                    active
                                      ? FULFILLMENT_STYLE[stage]
                                      : 'text-zinc-400 border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:text-white'
                                  }`}
                                >
                                  <Icon className="w-3.5 h-3.5" />
                                  {active ? FULFILLMENT_LABEL[stage] : `Mark ${FULFILLMENT_LABEL[stage].toLowerCase()}`}
                                </button>
                              );
                            })}
                          </div>
                          {fulfillment === 'DELIVERED' && (
                            <p className="mt-2 text-xs text-emerald-400 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Order fulfilled.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Payment — status-driven */}
                      <div className="border-t border-zinc-800 pt-3">
                        <p className="text-[11px] uppercase tracking-wide text-zinc-600 mb-2">Payment</p>
                        {isCancelled ? (
                          <p className="text-xs text-zinc-600">This order was cancelled.</p>
                        ) : isPaid ? (
                          <div className="flex items-center gap-2 text-sm text-emerald-400">
                            <CheckCircle2 className="w-4 h-4" /> Payment confirmed
                          </div>
                        ) : !hasLink ? (
                          <button
                            type="button"
                            className="btn-primary flex items-center gap-2 text-sm"
                            onClick={() => initializePayment(order)}
                            disabled={ps.loading}
                          >
                            {ps.loading ? 'Initializing…' : 'Initialize payment'}
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <a
                                href={link}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-primary flex items-center gap-2 text-sm flex-1 justify-center"
                              >
                                Open checkout <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                              <button
                                type="button"
                                className="btn-secondary flex items-center gap-1.5 text-sm px-3"
                                onClick={() => copyToClipboard(link)}
                                title="Copy checkout link"
                              >
                                <Copy className="w-3.5 h-3.5" /> Copy
                              </button>
                              <button
                                type="button"
                                className="btn-secondary text-sm px-3"
                                onClick={() => verifyPayment(order)}
                                disabled={ps.loading}
                              >
                                {ps.loading ? '…' : 'Verify'}
                              </button>
                            </div>
                          </div>
                        )}
                        {reference && (
                          <p className="mt-2 text-[10px] text-zinc-700 font-mono break-all">ref: {reference}</p>
                        )}
                      </div>

                      {/* Cancel — only while unpaid (paid orders need a Paystack refund first) */}
                      {!isPaid && !isCancelled && (
                        <button
                          type="button"
                          onClick={() => setFulfillment(order, 'CANCELLED')}
                          disabled={fulfilling === order.id}
                          className="inline-flex items-center gap-1.5 text-xs text-red-400/80 hover:text-red-400 transition-colors"
                        >
                          <Ban className="w-3.5 h-3.5" /> Cancel order
                        </button>
                      )}

                      {ps.message && <p className="text-xs text-zinc-400">{ps.message}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
