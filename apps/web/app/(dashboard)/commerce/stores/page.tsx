'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { commerceApi, orgApi, resolveOrgId } from '@/lib/api';
import { useCanManage } from '@/lib/use-role';
import CustomSelect from '@/components/custom-select';
import SearchableSelect from '@/components/searchable-select';
import {
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Loader2,
  MapPin,
  Plus,
  Store as StoreIcon,
  Trash2,
  X,
} from 'lucide-react';

type Currency = 'NGN' | 'USD';
type Bank = { name: string; code: string };

function toLocationCode(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

export default function StoresPage() {
  const canManage = useCanManage(); // AGENTs view stores/locations/payout status; managing is OWNER/ADMIN
  const [orgId, setOrgId] = useState<string | null>(null);
  const [stores, setStores] = useState<any[]>([]);
  const [loadingStores, setLoadingStores] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  // Modal + steps
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Step 1: store basics
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('NGN');

  // Step 2: first location
  const [firstLocName, setFirstLocName] = useState('');
  const [firstLocCode, setFirstLocCode] = useState('');
  const [firstLocCodeTouched, setFirstLocCodeTouched] = useState(false);

  // Step 3: payouts (optional but enabled by default)
  const [setupPayouts, setSetupPayouts] = useState(true);
  const [businessName, setBusinessName] = useState('');
  const [businessNameTouched, setBusinessNameTouched] = useState(false);
  const [settlementBank, setSettlementBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [resolvingAccount, setResolvingAccount] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [primaryContactPhone, setPrimaryContactPhone] = useState('');

  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [creatingStore, setCreatingStore] = useState(false);

  // Expanded rows
  const [expandedStoreId, setExpandedStoreId] = useState<string | null>(null);

  // Add location per existing store
  const [addLocStoreId, setAddLocStoreId] = useState<string | null>(null);
  const [addLocName, setAddLocName] = useState('');
  const [addLocCode, setAddLocCode] = useState('');
  const [addLocCodeTouched, setAddLocCodeTouched] = useState(false);
  const [addingLoc, setAddingLoc] = useState(false);

  // Delete confirmation
  const [deleteConfirmStoreId, setDeleteConfirmStoreId] = useState<string | null>(null);
  const [deletingStoreId, setDeletingStoreId] = useState<string | null>(null);

  useEffect(() => {
    if (!firstLocCodeTouched) setFirstLocCode(toLocationCode(firstLocName));
  }, [firstLocName, firstLocCodeTouched]);

  useEffect(() => {
    if (!addLocCodeTouched) setAddLocCode(toLocationCode(addLocName));
  }, [addLocName, addLocCodeTouched]);

  useEffect(() => {
    if (!businessNameTouched) setBusinessName(name.trim());
  }, [name, businessNameTouched]);

  const loadStores = async (targetOrgId: string) => {
    const res = await commerceApi.listStores(targetOrgId);
    setStores(Array.isArray(res.data) ? res.data : []);
  };

  const loadBanks = async (targetOrgId: string) => {
    if (banks.length > 0 || banksLoading) return;
    setBanksLoading(true);
    try {
      const res = await commerceApi.listBanks(targetOrgId);
      setBanks(Array.isArray(res.data) ? res.data : []);
    } finally {
      setBanksLoading(false);
    }
  };

  const resolveAccountName = async (targetOrgId: string, acctNum: string, bankCode: string) => {
    if (acctNum.length !== 10 || !bankCode) return;
    setResolvingAccount(true);
    setResolveError(null);
    try {
      const res = await commerceApi.resolveAccount(targetOrgId, acctNum, bankCode);
      setAccountName(String(res.data?.accountName ?? ''));
    } catch (err: any) {
      setAccountName('');
      setResolveError(err?.response?.data?.message ?? 'Could not resolve account name.');
    } finally {
      setResolvingAccount(false);
    }
  };

  useEffect(() => {
    async function setup() {
      const orgs = (await orgApi.listSummary()).data as Array<{ id: string }>;
      const resolved = resolveOrgId(orgs as any);
      if (!resolved) return;
      setOrgId(resolved);
      try {
        await loadStores(resolved);
      } finally {
        setLoadingStores(false);
      }
    }
    setup();
  }, []);

  useEffect(() => {
    if (!modalOpen || !orgId || !setupPayouts) return;
    if (accountNumber.length !== 10 || !settlementBank) {
      setAccountName('');
      setResolveError(null);
      return;
    }

    const timer = setTimeout(() => {
      resolveAccountName(orgId, accountNumber, settlementBank);
    }, 500);

    return () => clearTimeout(timer);
  }, [modalOpen, orgId, setupPayouts, accountNumber, settlementBank]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  const resetCreateForm = () => {
    setStep(1);
    setName('');
    setCurrency('NGN');
    setFirstLocName('');
    setFirstLocCode('');
    setFirstLocCodeTouched(false);

    setSetupPayouts(true);
    setBusinessName('');
    setBusinessNameTouched(false);
    setSettlementBank('');
    setAccountNumber('');
    setAccountName('');
    setResolveError(null);
    setPrimaryContactEmail('');
    setPrimaryContactName('');
    setPrimaryContactPhone('');
  };

  const openCreateModal = () => {
    if (orgId) loadBanks(orgId);
    resetCreateForm();
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    resetCreateForm();
  };

  const submitCreateStore = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || creatingStore || !name.trim()) return;

    setCreatingStore(true);
    setMessage(null);
    try {
      const storeName = name.trim();
      const created = await commerceApi.createStore(orgId, { name: storeName, currency });
      const storeId = String(created.data?.id ?? '');

      if (storeId && firstLocName.trim()) {
        await commerceApi.createLocation(orgId, {
          storeId,
          name: firstLocName.trim(),
          code: firstLocCode || toLocationCode(firstLocName.trim()),
          priority: 100,
        });
      }

      if (storeId && setupPayouts && businessName.trim() && settlementBank && accountNumber.length === 10) {
        await commerceApi.setupSubaccount(orgId, storeId, {
          businessName: businessName.trim(),
          settlementBank,
          accountNumber,
          primaryContactEmail: primaryContactEmail || undefined,
          primaryContactName: primaryContactName || undefined,
          primaryContactPhone: primaryContactPhone || undefined,
        });
      }

      await loadStores(orgId);
      closeModal();
      setExpandedStoreId(storeId || null);
      setMessage('Store created successfully.');
    } catch (err: any) {
      setMessage(err?.response?.data?.message ?? 'Failed to create store.');
    } finally {
      setCreatingStore(false);
    }
  };

  const addLocation = async (e: FormEvent, storeId: string) => {
    e.preventDefault();
    if (!orgId || addingLoc) return;
    setAddingLoc(true);
    try {
      await commerceApi.createLocation(orgId, {
        storeId,
        name: addLocName.trim(),
        code: addLocCode || toLocationCode(addLocName.trim()),
        priority: 100,
      });
      setAddLocName('');
      setAddLocCode('');
      setAddLocCodeTouched(false);
      setAddLocStoreId(null);
      await loadStores(orgId);
      setMessage('Location added.');
    } finally {
      setAddingLoc(false);
    }
  };

  const deleteStore = async (storeId: string) => {
    if (!orgId) return;
    setDeletingStoreId(storeId);
    try {
      await commerceApi.deleteStore(orgId, storeId);
      setDeleteConfirmStoreId(null);
      if (expandedStoreId === storeId) setExpandedStoreId(null);
      await loadStores(orgId);
      setMessage('Store deactivated.');
    } finally {
      setDeletingStoreId(null);
    }
  };

  const stepTitle = useMemo(() => {
    if (step === 1) return 'Store details';
    if (step === 2) return 'Location setup';
    return 'Payout setup';
  }, [step]);

  return (
    <div className="p-4 md:p-8">
      {modalOpen && (
        <div
          ref={backdropRef}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-12 overflow-y-auto"
          onClick={(e) => {
            if (e.target === backdropRef.current) closeModal();
          }}
        >
          <div className="relative w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden mb-8">
            <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-900">
              <div>
                <h2 className="font-brand font-semibold text-base text-white tracking-tight">Create store</h2>
                <p className="text-xs text-zinc-500 font-light mt-0.5">Step {step} of 3 · {stepTitle}</p>
              </div>
              <button type="button" onClick={closeModal} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={submitCreateStore} className="px-6 py-5 space-y-4 max-h-[74vh] overflow-y-auto">
              {step === 1 && (
                <div className="space-y-3">
                  <input
                    className="input-base"
                    placeholder="Store name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                  <CustomSelect
                    options={[
                      { value: 'NGN', label: 'NGN - Nigerian Naira' },
                      { value: 'USD', label: 'USD - US Dollar' },
                    ]}
                    value={currency}
                    onChange={(v) => setCurrency(v as Currency)}
                  />
                  <button
                    type="button"
                    className="btn-primary w-full"
                    disabled={!name.trim()}
                    onClick={() => setStep(2)}
                  >
                    Continue to location
                  </button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-500">Optional: create the first location now.</p>
                  <input
                    className="input-base"
                    placeholder="Location name (e.g. Lagos Warehouse)"
                    value={firstLocName}
                    onChange={(e) => setFirstLocName(e.target.value)}
                  />
                  {firstLocName.trim() && (
                    <div>
                      <input
                        className="input-base font-mono text-xs"
                        placeholder="Location code"
                        value={firstLocCode}
                        onChange={(e) => {
                          setFirstLocCode(e.target.value.toUpperCase());
                          setFirstLocCodeTouched(true);
                        }}
                      />
                      <p className="text-[11px] text-zinc-600 mt-1 font-light">Auto-generated. Edit if needed.</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Back</button>
                    <button type="button" className="btn-primary" onClick={() => setStep(3)}>Continue to payouts</button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={setupPayouts}
                      onChange={(e) => setSetupPayouts(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-900"
                    />
                    Set up Paystack subaccount now
                  </label>

                  {setupPayouts && (
                    <div className="space-y-3 rounded-xl border border-zinc-800 p-3">
                      <input
                        className="input-base"
                        placeholder="Business name"
                        value={businessName}
                        onChange={(e) => {
                          setBusinessName(e.target.value);
                          setBusinessNameTouched(true);
                        }}
                        required={setupPayouts}
                      />

                      <SearchableSelect
                        options={banks.map((b) => ({ value: b.code, label: b.name }))}
                        value={settlementBank}
                        onChange={setSettlementBank}
                        placeholder="Search bank..."
                        loading={banksLoading}
                      />

                      <input
                        className="input-base font-mono"
                        placeholder="Account number (10 digits)"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        maxLength={10}
                        required={setupPayouts}
                      />

                      <div className="min-h-8 rounded-lg border border-zinc-800 px-3 py-2 bg-zinc-900/40">
                        {resolvingAccount ? (
                          <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" /> Resolving account name...
                          </p>
                        ) : accountName ? (
                          <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3 h-3" /> {accountName}
                          </p>
                        ) : resolveError ? (
                          <p className="text-xs text-red-400">{resolveError}</p>
                        ) : (
                          <p className="text-xs text-zinc-600">Account name will appear here for confirmation.</p>
                        )}
                      </div>

                      <details className="text-[11px] text-zinc-600">
                        <summary className="cursor-pointer select-none">Optional contact details</summary>
                        <div className="space-y-2 mt-2">
                          <input className="input-base text-xs" placeholder="Contact name" value={primaryContactName} onChange={(e) => setPrimaryContactName(e.target.value)} />
                          <input className="input-base text-xs" placeholder="Contact email" type="email" value={primaryContactEmail} onChange={(e) => setPrimaryContactEmail(e.target.value)} />
                          <input className="input-base text-xs" placeholder="Contact phone" value={primaryContactPhone} onChange={(e) => setPrimaryContactPhone(e.target.value)} />
                        </div>
                      </details>

                      <p className="text-[11px] text-zinc-600 font-light">Platform fee is fixed at 5%. Merchant subaccount receives 95% of each transaction.</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn-ghost" onClick={() => setStep(2)}>Back</button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={creatingStore || !name.trim() || (setupPayouts && (!businessName.trim() || !settlementBank || accountNumber.length !== 10 || !accountName))}
                    >
                      {creatingStore ? 'Creating...' : 'Create store'}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Stores</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">Manage stores, locations, and payment routing.</p>
        </div>
        {canManage && (
        <button type="button" className="btn-primary flex items-center gap-2" onClick={openCreateModal}>
          <Plus className="w-4 h-4" />
          New store
        </button>
        )}
      </div>

      <section className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-normal text-white">Your stores</h2>
          {!loadingStores && (
            <span className="text-xs text-zinc-600">{stores.length} store{stores.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loadingStores ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-zinc-900 animate-pulse rounded-xl" />)}
          </div>
        ) : stores.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <StoreIcon className="w-9 h-9 text-zinc-700" />
            <p className="text-sm text-zinc-500 font-light">No stores yet. Create your first store to start routing orders and payments.</p>
            <button type="button" className="btn-secondary text-xs flex items-center gap-1.5" onClick={openCreateModal}>
              <Plus className="w-3.5 h-3.5" /> Create first store
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {stores.map((store) => {
              const isExpanded = expandedStoreId === store.id;
              const meta = store.metadata && typeof store.metadata === 'object' ? (store.metadata as Record<string, unknown>) : {};
              const savedSubaccount = typeof meta.paystackSubaccountCode === 'string' ? meta.paystackSubaccountCode : '';
              const savedBizName = typeof meta.paystackBusinessName === 'string' ? meta.paystackBusinessName : '';
              const isDeleteConfirm = deleteConfirmStoreId === store.id;

              return (
                <div key={store.id} className={`rounded-xl border transition-colors ${isExpanded ? 'border-zinc-700' : 'border-zinc-800'} bg-zinc-900`}>
                  <button
                    type="button"
                    className="w-full text-left px-4 py-3"
                    onClick={() => setExpandedStoreId((p) => (p === store.id ? null : store.id))}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                          <StoreIcon className="w-3.5 h-3.5 text-zinc-500" />
                        </div>
                        <p className="text-sm text-white font-light truncate">{store.name}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {savedSubaccount && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" /> Payments on
                          </span>
                        )}
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">{store.currency}</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-600 pl-9">
                      {store._count?.locations ?? 0} location{store._count?.locations !== 1 ? 's' : ''} · {store._count?.products ?? 0} product{store._count?.products !== 1 ? 's' : ''}
                    </p>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-zinc-800 px-4 py-4 space-y-4">
                      {store.locations?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {store.locations.map((loc: any) => (
                            <span key={loc.id} className="flex items-center gap-1 text-[11px] text-zinc-500 bg-zinc-800 rounded-md px-2 py-0.5">
                              <MapPin className="w-2.5 h-2.5" /> {loc.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {canManage && (addLocStoreId === store.id ? (
                        <form onSubmit={(e) => addLocation(e, store.id)} className="space-y-2">
                          <p className="text-xs text-zinc-400">New location</p>
                          <input className="input-base" placeholder="Location name (e.g. Abuja Hub)" value={addLocName} onChange={(e) => setAddLocName(e.target.value)} required />
                          <div>
                            <input className="input-base font-mono text-xs" placeholder="Code (auto-generated)" value={addLocCode} onChange={(e) => { setAddLocCode(e.target.value.toUpperCase()); setAddLocCodeTouched(true); }} required />
                            <p className="text-[11px] text-zinc-600 mt-1 font-light">Auto-generated. Edit if needed.</p>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" className="btn-ghost text-xs px-3 py-1.5" onClick={() => { setAddLocStoreId(null); setAddLocName(''); setAddLocCode(''); setAddLocCodeTouched(false); }}>Cancel</button>
                            <button className="btn-primary text-xs flex-1 py-2" type="submit" disabled={addingLoc}>{addingLoc ? 'Adding...' : 'Add location'}</button>
                          </div>
                        </form>
                      ) : (
                        <button type="button" className="btn-ghost text-xs flex items-center gap-1.5 px-2 py-1" onClick={() => setAddLocStoreId(store.id)}>
                          <Plus className="w-3 h-3" /> Add location
                        </button>
                      ))}

                      <div className="rounded-xl border border-zinc-800 p-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-3.5 h-3.5 text-zinc-500" />
                          <p className="text-xs text-zinc-400">Paystack payouts</p>
                        </div>
                        {savedSubaccount ? (
                          <>
                            <p className="text-xs text-emerald-400 pl-5">Subaccount active</p>
                            {savedBizName && <p className="text-[11px] text-zinc-500 font-light pl-5">{savedBizName}</p>}
                            <p className="text-[11px] text-zinc-700 font-mono pl-5">{savedSubaccount}</p>
                          </>
                        ) : (
                          <p className="text-[11px] text-zinc-600 pl-5">No subaccount linked. Edit this store later to set payout routing.</p>
                        )}
                      </div>

                      {canManage && (
                      <div className="border-t border-zinc-800 pt-3">
                        {isDeleteConfirm ? (
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-zinc-400">Deactivate this store?</p>
                            <div className="flex gap-2">
                              <button type="button" className="btn-ghost text-xs px-3 py-1.5" onClick={() => setDeleteConfirmStoreId(null)}>Cancel</button>
                              <button
                                type="button"
                                className="text-xs px-3 py-1.5 rounded-lg bg-red-950 text-red-400 border border-red-900 hover:bg-red-900 transition-colors disabled:opacity-50"
                                disabled={deletingStoreId === store.id}
                                onClick={() => deleteStore(store.id)}
                              >
                                {deletingStoreId === store.id ? 'Deactivating...' : 'Yes, deactivate'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="btn-ghost text-xs flex items-center gap-1.5 px-2 py-1 text-zinc-600 hover:text-red-400" onClick={() => setDeleteConfirmStoreId(store.id)}>
                            <Trash2 className="w-3 h-3" /> Deactivate store
                          </button>
                        )}
                      </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {message && <p className="text-xs text-emerald-500 font-light mt-4">{message}</p>}
    </div>
  );
}
