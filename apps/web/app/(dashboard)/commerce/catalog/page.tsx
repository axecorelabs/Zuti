'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { commerceApi, orgApi, resolveOrgId } from '@/lib/api';
import { useCanManage } from '@/lib/use-role';
import CustomSelect from '@/components/custom-select';
import SearchableSelect from '@/components/searchable-select';
import {
  AlertTriangle,
  ImagePlus,
  Loader2,
  Package,
  Pencil,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';

type Currency = 'NGN' | 'USD';

type SpecRow = { key: string; value: string };
type VariantDraft = {
  id?: string;
  title: string;
  sku: string;
  skuTouched: boolean;
  price: string;
  currency: Currency;
  imageUrl: string;
  stockOnHand: string;
  stockLocationId: string;
};

function toSku(productTitle: string, variantTitle: string): string {
  const clean = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return [clean(productTitle), clean(variantTitle)].filter(Boolean).join('-').slice(0, 40);
}

const defaultVariant = (currency: Currency = 'NGN'): VariantDraft => ({
  title: '',
  sku: '',
  skuTouched: false,
  price: '',
  currency,
  imageUrl: '',
  stockOnHand: '',
  stockLocationId: '',
});

function PriceHint({ price, currency }: { price: string; currency: string }) {
  const n = Number(price);
  if (!price || Number.isNaN(n) || n === 0) return null;
  return (
    <p className="text-[11px] text-zinc-600 mt-1 font-light">
      = {n.toLocaleString()} {currency}
    </p>
  );
}

function toMinorUnits(value: string) {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (Number.isNaN(amount)) return 0;
  return Math.round(amount * 100);
}

const TAG_OPTIONS = [
  'new',
  'best seller',
  'sale',
  'featured',
  'limited stock',
  'men',
  'women',
  'unisex',
  'kids',
  'summer',
  'winter',
  'eco friendly',
  'premium',
  'gift',
  'bundle',
  'clearance',
  'popular',
  'trending',
];

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].join(', ');
}

export default function CatalogPage() {
  const canManage = useCanManage(); // AGENTs browse the catalog; create/edit is OWNER/ADMIN
  const [orgId, setOrgId] = useState<string | null>(null);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editProduct, setEditProduct] = useState<any>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — Basics
  const [title, setTitle] = useState('');
  const [storeId, setStoreId] = useState('');
  const [category, setCategory] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // Step 2 — Description & AI context
  const [description, setDescription] = useState('');
  const [specs, setSpecs] = useState<SpecRow[]>([{ key: '', value: '' }]);
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [editHydrating, setEditHydrating] = useState(false);
  const [formError, setFormError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const variantImageFiles = useRef<Record<number, File | null>>({});
  const [variantSelectedFileNames, setVariantSelectedFileNames] = useState<Record<number, string>>({});

  // Step 3 — Variants
  const defaultCurrency = useCallback((): Currency => {
    const store = stores.find((s) => s.id === storeId);
    return (store?.currency as Currency) ?? 'NGN';
  }, [stores, storeId]);

  const selectedStoreLocations = stores.find((store) => store.id === storeId)?.locations ?? [];

  const [variants, setVariants] = useState<VariantDraft[]>([defaultVariant()]);

  const backdropRef = useRef<HTMLDivElement>(null);

  const resetModal = () => {
    setStep(1);
    setTitle(''); setStoreId(stores[0]?.id ?? ''); setCategory(''); setTagsInput('');
    setDescription(''); setSpecs([{ key: '', value: '' }]);
    setImageUrl(''); setImagePreview(null);
    setImageFile(null);
    setVariants([defaultVariant()]);
    setEditProduct(null);
    setGeneratingDescription(false);
    setEditHydrating(false);
    setFormError('');
    variantImageFiles.current = {};
    setVariantSelectedFileNames({});
  };

  const openCreate = () => {
    resetModal();
    setStoreId(stores[0]?.id ?? '');
    setVariants([defaultVariant(defaultCurrency())]);
    setModalMode('create');
  };

  const openEdit = async (product: any) => {
    const nextStoreId = product.storeId ?? stores[0]?.id ?? '';
    const nextCurrency = (stores.find((store) => store.id === nextStoreId)?.currency as Currency) ?? 'NGN';
    const nextStoreLocations = stores.find((store) => store.id === nextStoreId)?.locations ?? [];
    const meta = product.metadata && typeof product.metadata === 'object' ? (product.metadata as Record<string, unknown>) : {};
    const existingSpecs: SpecRow[] = Array.isArray(meta.specs)
      ? (meta.specs as Array<{ key: string; value: string }>).map((s) => ({ key: s.key ?? '', value: s.value ?? '' }))
      : [{ key: '', value: '' }];

    setEditHydrating(true);
    setFormError('');
    setTitle(product.title ?? '');
    setStoreId(nextStoreId);
    setCategory(product.category ?? '');
    setTagsInput((product.tags ?? []).join(', '));
    setDescription(product.description ?? '');
    setSpecs(existingSpecs.length ? existingSpecs : [{ key: '', value: '' }]);
    setImageUrl(product.imageUrl ?? '');
    setImagePreview(product.imageUrl ?? null);
    setImageFile(null);
    setEditProduct(product);
    setStep(1);
    setModalMode('edit');
    variantImageFiles.current = {};
    setVariants(Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants.map((variant: any) => ({
        id: variant.id,
        title: variant.title ?? '',
        sku: variant.sku ?? '',
        skuTouched: true,
        price: typeof variant.priceMinor === 'number' ? String(variant.priceMinor / 100) : '',
        currency: variant.currency ?? nextCurrency,
        imageUrl: variant.imageUrl ?? '',
        stockOnHand: Array.isArray(variant.inventoryByLocation) && variant.inventoryByLocation[0]
          ? String(variant.inventoryByLocation[0].onHand ?? '')
          : '',
        stockLocationId: Array.isArray(variant.inventoryByLocation) && variant.inventoryByLocation[0]
          ? variant.inventoryByLocation[0].locationId ?? nextStoreLocations[0]?.id ?? ''
          : nextStoreLocations[0]?.id ?? '',
      }))
      : [defaultVariant(nextCurrency)]);

    try {
      const contextRes = await commerceApi.getProductContext(orgId as string, product.id);
      const context = contextRes.data as any;
      const nextTitle = context?.title ?? product.title ?? '';
      const nextCategory = context?.category ?? product.category ?? '';
      const nextTags = Array.isArray(context?.tags) ? context.tags : product.tags ?? [];
      const nextDescription = context?.description ?? product.description ?? '';
      const nextSpecs: SpecRow[] = Array.isArray(context?.metadata?.specs)
        ? context.metadata.specs.map((s: any) => ({ key: s.key ?? '', value: s.value ?? '' }))
        : existingSpecs;
      const nextVariants = Array.isArray(context?.variants)
        ? context.variants.map((variant: any) => {
          const inventoryByLocation = Array.isArray(variant.inventoryByLocation) ? variant.inventoryByLocation : [];
          const primaryInventory = inventoryByLocation[0];
          return {
            id: variant.id,
            title: variant.title ?? '',
            sku: variant.sku ?? '',
            skuTouched: true,
            price: typeof variant.priceMinor === 'number' ? String(variant.priceMinor / 100) : '',
            currency: variant.currency ?? nextCurrency,
            imageUrl: variant.imageUrl ?? '',
            stockOnHand: primaryInventory ? String(primaryInventory.onHand ?? '') : '',
            stockLocationId: primaryInventory?.locationId ?? nextStoreLocations[0]?.id ?? '',
          };
        })
        : [];

      setTitle(nextTitle);
      setCategory(nextCategory);
      setTagsInput(formatTags(nextTags));
      setDescription(nextDescription);
      setSpecs(nextSpecs.length ? nextSpecs : [{ key: '', value: '' }]);
      setVariants(nextVariants.length ? nextVariants : [defaultVariant(nextCurrency)]);
    } catch {
      setFormError('Loaded product basics, but could not fetch existing variant stock.');
    } finally {
      setEditHydrating(false);
    }
  };

  const closeModal = () => {
    setModalMode(null);
    resetModal();
  };

  const load = async (targetOrgId: string, q?: string) => {
    const [storesRes, productsRes] = await Promise.all([
      commerceApi.listStores(targetOrgId),
      commerceApi.searchProducts(targetOrgId, q),
    ]);
    const nextStores = Array.isArray(storesRes.data) ? storesRes.data : [];
    const nextProducts = Array.isArray(productsRes.data?.items) ? productsRes.data.items : [];
    setStores(nextStores);
    setProducts(nextProducts);
    if (nextStores[0] && !storeId) setStoreId(nextStores[0].id);
  };

  useEffect(() => {
    async function setup() {
      try {
        const orgs = (await orgApi.listSummary()).data as Array<{ id: string }>;
        const resolved = resolveOrgId(orgs as any);
        if (!resolved) return;
        setOrgId(resolved);
        await load(resolved);
      } finally {
        setLoading(false);
      }
    }
    setup();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-regenerate SKUs when title changes (for untouched variants)
  useEffect(() => {
    setVariants((prev) =>
      prev.map((v) => v.skuTouched ? v : { ...v, sku: toSku(title, v.title) }),
    );
  }, [title]);

  const handleImageFile = async (file: File) => {
    if (!orgId) return;
    setImagePreview(URL.createObjectURL(file));
    setImageFile(file);
    setImageUrl('');
  };

  const handleVariantImageFile = async (index: number, file: File) => {
    if (!orgId) return;
    variantImageFiles.current[index] = file;
    setVariantSelectedFileNames((prev) => ({ ...prev, [index]: file.name }));
    setVariants((prev) => prev.map((variant, variantIndex) => (
      variantIndex === index ? { ...variant, imageUrl: URL.createObjectURL(file) } : variant
    )));
  };

  const uploadImageOrKeep = async (file: File | null | undefined, existingUrl?: string) => {
    if (!file) return existingUrl || undefined;
    const uploaded = await commerceApi.uploadImage(orgId as string, file);
    const resolved = String(uploaded.data?.url ?? '');
    if (!resolved) {
      throw new Error('Image upload did not return a valid URL');
    }
    return resolved;
  };

  const clearImage = () => {
    setImageUrl(''); setImagePreview(null); setImageFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const addSpec = () => setSpecs((p) => [...p, { key: '', value: '' }]);
  const removeSpec = (i: number) => setSpecs((p) => p.filter((_, idx) => idx !== i));
  const patchSpec = (i: number, field: 'key' | 'value', val: string) =>
    setSpecs((p) => p.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)));

  const selectedTags = parseTags(tagsInput);

  const toggleTag = (tag: string) => {
    const normalized = tag.trim();
    if (!normalized) return;
    const current = parseTags(tagsInput);
    const exists = current.some((item) => item.toLowerCase() === normalized.toLowerCase());
    const next = exists
      ? current.filter((item) => item.toLowerCase() !== normalized.toLowerCase())
      : [...current, normalized];
    setTagsInput(formatTags(next));
  };

  const removeSelectedTag = (tag: string) => toggleTag(tag);

  const addVariant = () => setVariants((p) => [...p, defaultVariant(defaultCurrency())]);
  const removeVariant = (i: number) => setVariants((p) => p.filter((_, idx) => idx !== i));
  const patchVariant = (i: number, field: keyof VariantDraft, val: string | boolean) =>
    setVariants((p) =>
      p.map((v, idx) => {
        if (idx !== i) return v;
        const updated = { ...v, [field]: val };
        if (field === 'title' && !v.skuTouched) updated.sku = toSku(title, val as string);
        if (field === 'sku') { updated.sku = (val as string).toUpperCase(); updated.skuTouched = true; }
        return updated;
      }),
    );

  const generateDescription = async () => {
    if (!orgId || !title.trim()) return;
    setGeneratingDescription(true);
    try {
      const res = await commerceApi.generateProductDescription(orgId, {
        title: title.trim(),
        category: category.trim() || undefined,
        tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
        specs: specs.filter((spec) => spec.key.trim() && spec.value.trim()).map((spec) => ({ key: spec.key.trim(), value: spec.value.trim() })),
        currentDescription: description.trim() || undefined,
        mode: description.trim() ? 'improve' : 'generate',
      });
      setDescription(res.data.description ?? '');
      if (step === 1) setStep(2);
    } finally {
      setGeneratingDescription(false);
    }
  };

  const buildMetadata = () => {
    const filledSpecs = specs.filter((s) => s.key.trim() && s.value.trim());
    return filledSpecs.length ? { specs: filledSpecs } : {};
  };

  const submitCreate = async () => {
    if (!orgId || !storeId || !title.trim()) return;
    setSubmitting(true);
    setFormError('');
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      const finalImageUrl = await uploadImageOrKeep(imageFile, imageUrl || undefined);
      const res = await commerceApi.createProduct(orgId, {
        storeId,
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        tags,
        imageUrl: finalImageUrl,
        metadata: buildMetadata(),
      });
          const productId = res.data?.id;
      if (productId) {
        for (const [variantIndex, v] of variants.entries()) {
          const variantImageFile = variantImageFiles.current[variantIndex];
          if (variantImageFile && !v.price.trim()) {
            throw new Error(`Variant ${variantIndex + 1} needs a price before its image can be uploaded.`);
          }
          if (!v.price.trim()) continue;
          const finalVariantImageUrl = await uploadImageOrKeep(variantImageFile, v.imageUrl || undefined);
          const variantRes = await commerceApi.createVariant(orgId, {
            productId,
            sku: v.sku || toSku(title, v.title),
            title: v.title || undefined,
            imageUrl: finalVariantImageUrl,
            priceMinor: toMinorUnits(v.price),
            currency: v.currency,
          });
          const variantId = variantRes.data?.id;
          const locationId = v.stockLocationId || selectedStoreLocations[0]?.id;
          const onHand = Number(v.stockOnHand);
          if (variantId && locationId && v.stockOnHand.trim() && !Number.isNaN(onHand)) {
            await commerceApi.upsertInventory(orgId, {
              variantId,
              locationId,
              onHand: Math.max(0, Math.round(onHand)),
            });
          }
        }
      }
      closeModal();
      await load(orgId, query || undefined);
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.response?.data?.detail || error?.message || 'Could not save this product.';
      setFormError(String(message));
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!orgId || !editProduct) return;
    setSubmitting(true);
    setFormError('');
    try {
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
      const finalImageUrl = await uploadImageOrKeep(imageFile, imageUrl || undefined);
      await commerceApi.updateProduct(orgId, editProduct.id, {
        title: title.trim(),
        description: description.trim() || undefined,
        category: category.trim() || undefined,
        tags,
        imageUrl: finalImageUrl,
        metadata: buildMetadata(),
      });
        for (const [variantIndex, v] of variants.entries()) {
        const variantImageFile = variantImageFiles.current[variantIndex];
        if (variantImageFile && !v.price.trim()) {
          throw new Error(`Variant ${variantIndex + 1} needs a price before its image can be uploaded.`);
        }
          if (!v.price.trim()) {
            if (v.id) {
              throw new Error(`Variant ${variantIndex + 1} needs a price to be saved.`);
            }
            continue;
          }
        const finalVariantImageUrl = await uploadImageOrKeep(variantImageFile, v.imageUrl || undefined);
          const variantRes = v.id
            ? await commerceApi.updateVariant(orgId, v.id, {
              sku: v.sku || toSku(title, v.title),
              title: v.title || undefined,
              imageUrl: finalVariantImageUrl,
              priceMinor: toMinorUnits(v.price),
              currency: v.currency,
            })
            : await commerceApi.createVariant(orgId, {
              productId: editProduct.id,
              sku: v.sku || toSku(title, v.title),
              title: v.title || undefined,
              imageUrl: finalVariantImageUrl,
              priceMinor: toMinorUnits(v.price),
              currency: v.currency,
            });
          const variantId = variantRes.data?.id;
        const locationId = v.stockLocationId || selectedStoreLocations[0]?.id;
        const onHand = Number(v.stockOnHand);
        if (variantId && locationId && v.stockOnHand.trim() && !Number.isNaN(onHand)) {
          await commerceApi.upsertInventory(orgId, {
            variantId,
            locationId,
            onHand: Math.max(0, Math.round(onHand)),
          });
        }
      }
      closeModal();
      await load(orgId, query || undefined);
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.response?.data?.detail || error?.message || 'Could not save changes.';
      setFormError(String(message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStep3Submit = async (e: FormEvent) => {
    e.preventDefault();
    if (modalMode === 'create') await submitCreate();
    else await submitEdit();
  };

  const runSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;
    await load(orgId, query || undefined);
  };

  const STEPS = ['Basics', 'Description', 'Variants'];

  return (
    <div className="p-4 md:p-8">
      {/* Multi-step product editor */}
      {modalMode && (
        <div ref={backdropRef} className="card mb-6 min-h-[90vh] overflow-hidden">
          <div className="relative w-full">
            {/* Header */}
            <div className="border-b border-zinc-900 bg-gradient-to-b from-zinc-950 to-zinc-950/80 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
                    <button type="button" onClick={closeModal} className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-white">
                      <X className="w-3 h-3" />
                      Catalog
                    </button>
                    <span className="text-zinc-700">/</span>
                    <span className="text-zinc-400">
                      {modalMode === 'create' ? 'Create product' : 'Edit product'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300">
                      <Package className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate font-brand text-lg font-semibold tracking-tight text-white">
                        {modalMode === 'create' ? 'New product' : `Edit: ${editProduct?.title}`}
                      </h2>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {step === 1 && 'Set the product basics before moving to the content step.'}
                        {step === 2 && 'Add AI-ready description content, specifications, and the main image.'}
                        {step === 3 && 'Create variants, attach images, and set inventory for launch.'}
                      </p>
                    </div>
                  </div>
                </div>
                <button type="button" onClick={closeModal} className="rounded-full border border-zinc-800 bg-zinc-900 p-2 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {STEPS.map((s, i) => {
                  const active = step === i + 1;
                  const completed = step > i + 1;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStep((i + 1) as 1 | 2 | 3)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        active
                          ? 'border-blue-500/40 bg-blue-500/10 text-white'
                          : completed
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${active ? 'bg-blue-500 text-white' : completed ? 'bg-emerald-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                        {i + 1}
                      </span>
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {formError && (
              <div className="border-b border-zinc-900 px-6 py-3">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {formError}
                </div>
              </div>
            )}

            <div className="px-6 py-5 min-h-[calc(80vh-5.5rem)] overflow-y-auto">
              {/* ---- STEP 1: Basics ---- */}
              {step === 1 && (
                <div className="space-y-3">
                  <input className="input-base" placeholder="Product title *" value={title} onChange={(e) => setTitle(e.target.value)} required />
                  <CustomSelect
                    options={stores.map((s) => ({ value: s.id, label: s.name }))}
                    value={storeId}
                    onChange={setStoreId}
                    placeholder="Select store…"
                    disabled={stores.length === 0 || modalMode === 'edit'}
                  />
                  <SearchableSelect
                    freeform
                    options={[
                      { value: 'Electronics', label: 'Electronics' },
                      { value: 'Clothing & Apparel', label: 'Clothing & Apparel' },
                      { value: 'Footwear', label: 'Footwear' },
                      { value: 'Bags & Accessories', label: 'Bags & Accessories' },
                      { value: 'Beauty & Personal Care', label: 'Beauty & Personal Care' },
                      { value: 'Home & Living', label: 'Home & Living' },
                      { value: 'Food & Beverages', label: 'Food & Beverages' },
                      { value: 'Health & Wellness', label: 'Health & Wellness' },
                      { value: 'Sports & Outdoors', label: 'Sports & Outdoors' },
                      { value: 'Books & Stationery', label: 'Books & Stationery' },
                      { value: 'Toys & Games', label: 'Toys & Games' },
                      { value: 'Jewelry & Watches', label: 'Jewelry & Watches' },
                      { value: 'Art & Crafts', label: 'Art & Crafts' },
                      { value: 'Automotive', label: 'Automotive' },
                      { value: 'Office Supplies', label: 'Office Supplies' },
                    ]}
                    value={category}
                    onChange={setCategory}
                    placeholder="Category (search or type custom…)"
                  />
                  <div>
                    <input
                      className="input-base"
                      placeholder="Tags (comma-separated, e.g. men, running, sale)"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                    />
                    {selectedTags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {selectedTags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => removeSelectedTag(tag)}
                            className="inline-flex items-center gap-1 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[11px] text-blue-200 transition-colors hover:border-blue-400/30 hover:bg-blue-500/15 hover:text-white"
                          >
                            <Tag className="h-2.5 w-2.5" />
                            {tag}
                            <X className="h-2.5 w-2.5 opacity-70" />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-3">
                      <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-600">Quick tags</p>
                      <div className="flex flex-wrap gap-2">
                        {TAG_OPTIONS.map((tag) => {
                          const active = selectedTags.some((item) => item.toLowerCase() === tag.toLowerCase());
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleTag(tag)}
                              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                                active
                                  ? 'border-blue-500/40 bg-blue-500/15 text-white'
                                  : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
                              }`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-blue-400' : 'bg-zinc-700'}`} />
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-primary w-full mt-2"
                    disabled={!title.trim() || !storeId}
                    onClick={() => setStep(2)}
                  >
                    Next: Description →
                  </button>
                </div>
              )}

              {/* ---- STEP 2: Description & AI context ---- */}
              {step === 2 && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
                        <p className="text-xs text-zinc-400">AI product knowledge base</p>
                      </div>
                      <button
                        type="button"
                        className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1"
                        onClick={generateDescription}
                        disabled={generatingDescription || !title.trim()}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {generatingDescription ? 'Working…' : description.trim() ? 'Improve' : 'Generate'}
                      </button>
                    </div>
                    <textarea
                      className="input-base w-full resize-none font-light text-sm leading-relaxed"
                      rows={10}
                      placeholder={`Write everything a customer might ask about this product.\n\nInclude:\n• Materials & composition\n• Sizes, dimensions & weight\n• Care & maintenance instructions\n• Who it's best suited for\n• Compatibility & technical notes\n• Shipping restrictions\n• Warranty & return policy\n• Frequently asked questions\n\nThe more detail you add here, the better an AI agent can hold a full conversation with customers about this product.`}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <p className="text-[11px] text-zinc-700 mt-1 font-light">{description.length} characters</p>
                  </div>

                  {/* Specifications (key-value) */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-zinc-500">Specifications</p>
                      <button type="button" className="btn-ghost text-xs flex items-center gap-1 px-2 py-1" onClick={addSpec}>
                        <Plus className="w-3 h-3" /> Add row
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {specs.map((spec, i) => (
                        <div key={i} className="flex gap-1.5 items-center">
                          <input className="input-base flex-1 text-xs" placeholder="e.g. Material" value={spec.key} onChange={(e) => patchSpec(i, 'key', e.target.value)} />
                          <input className="input-base flex-1 text-xs" placeholder="e.g. 100% Cotton" value={spec.value} onChange={(e) => patchSpec(i, 'value', e.target.value)} />
                          {specs.length > 1 && (
                            <button type="button" className="text-zinc-700 hover:text-red-400 shrink-0" onClick={() => removeSpec(i)}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Image */}
                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs text-zinc-400">Product image</p>
                        <p className="mt-0.5 text-[11px] text-zinc-600">This becomes the main catalog image and the default for variants.</p>
                      </div>
                      {imagePreview && !uploading && (
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          className="btn-ghost px-2.5 py-1.5 text-[11px]"
                        >
                          Replace image
                        </button>
                      )}
                    </div>
                    {imagePreview ? (
                      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                        <div className="relative aspect-[16/9] w-full overflow-hidden bg-[radial-gradient(circle_at_top,#27272a,transparent_65%)]">
                          <img src={imagePreview} alt="Preview" className="h-full w-full object-cover" />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
                        {uploading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                          </div>
                        )}
                        {!uploading && (
                            <div className="absolute right-3 top-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => fileRef.current?.click()}
                                className="rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                              >
                                Change
                              </button>
                              <button type="button" onClick={clearImage} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                        )}
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t border-zinc-800 bg-zinc-900/70 px-4 py-3">
                          <div>
                            <p className="text-xs text-white">Main product media</p>
                            <p className="mt-0.5 text-[11px] text-zinc-500">Shown on the catalog card and used as the variant fallback.</p>
                          </div>
                          <div className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
                            16:9 preview
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="group w-full overflow-hidden rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 text-left transition-colors hover:border-zinc-700"
                      >
                        <div className="flex min-h-[220px] items-center justify-center bg-[radial-gradient(circle_at_top,#18181b,transparent_70%)] px-6">
                          <div className="flex max-w-sm flex-col items-center text-center">
                            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-500 transition-colors group-hover:border-zinc-700 group-hover:text-zinc-300">
                              <ImagePlus className="h-5 w-5" />
                            </div>
                            <p className="text-sm text-white">Upload product image</p>
                            <p className="mt-1 text-xs font-light text-zinc-500">Use a clean JPEG or WebP for the main storefront image. You can replace it before saving.</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between border-t border-zinc-900 bg-zinc-900/50 px-4 py-3 text-[11px] text-zinc-600">
                          <span>Recommended: 1600px or wider</span>
                          <span>JPEG, PNG, WebP, GIF</span>
                        </div>
                      </button>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="sr-only"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
                    />
                    <p className="text-[11px] text-zinc-600 font-light mt-2">
                      Variants can share the product image; add variant-specific images later if you need them.
                    </p>
                  </div>

                  <div className="sticky bottom-0 -mx-6 mt-4 border-t border-zinc-900 bg-zinc-950/95 px-6 py-4 backdrop-blur-sm">
                    <div className="flex gap-2">
                      <button type="button" className="btn-ghost flex-1" onClick={() => setStep(1)}>← Back</button>
                      <button type="button" className="btn-primary flex-1" onClick={() => setStep(3)} disabled={uploading || editHydrating}>
                      Next: Variants →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ---- STEP 3: Variants ---- */}
              {step === 3 && (
                <form onSubmit={handleStep3Submit} className="space-y-4">
                  {/* Existing variants (edit mode) */}
                  {modalMode === 'edit' && editProduct?.variants?.length > 0 && (
                    <div>
                      <p className="text-xs text-zinc-500 mb-2">Existing variants</p>
                      <div className="space-y-1">
                        {editProduct.variants.map((v: any) => (
                          <div key={v.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
                            <div>
                              <p className="text-xs text-zinc-300 font-mono">{v.sku}</p>
                              {v.title && <p className="text-[11px] text-zinc-600">{v.title}</p>}
                            </div>
                            <span className="text-xs text-zinc-500 tabular-nums">{(v.priceMinor / 100).toLocaleString()} {v.currency}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-zinc-600 mt-2 font-light">Add new variants below ↓</p>
                    </div>
                  )}

                  {/* New variant entries */}
                  <div className="space-y-3">
                    {variants.map((v, i) => (
                      <div key={i} className="rounded-xl border border-zinc-800 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-zinc-600">Variant {i + 1}</p>
                          {variants.length > 1 && (
                            <button type="button" className="text-zinc-700 hover:text-red-400" onClick={() => removeVariant(i)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <input
                          className="input-base"
                          placeholder="Variant title (e.g. Black / Size 42)"
                          value={v.title}
                          onChange={(e) => patchVariant(i, 'title', e.target.value)}
                        />
                        <input
                          className="input-base font-mono text-xs"
                          placeholder="SKU (auto-generated)"
                          value={v.sku}
                          onChange={(e) => patchVariant(i, 'sku', e.target.value)}
                        />
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <p className="text-[11px] text-zinc-500">Variant image</p>
                            <span className="text-[10px] text-zinc-600">Optional</span>
                          </div>
                          <p className="mb-2 text-[10px] text-zinc-600">Selected image uploads on Create/Save.</p>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="block w-fit text-[11px] text-zinc-500 file:mr-2.5 file:rounded-lg file:border file:border-zinc-700 file:bg-zinc-900 file:px-2.5 file:py-1.5 file:text-[11px] file:text-zinc-200 hover:file:border-zinc-600 hover:file:bg-zinc-800"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                void handleVariantImageFile(i, file);
                              }
                            }}
                          />
                          {variantSelectedFileNames[i] && (
                            <p className="mt-1.5 text-[10px] text-emerald-300">Selected: {variantSelectedFileNames[i]}</p>
                          )}
                          {v.imageUrl ? (
                            <div className="mt-2 flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/80 p-2.5">
                              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
                                <img src={v.imageUrl} alt={v.title || `Variant ${i + 1}`} className="h-full w-full object-cover" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] text-zinc-300">{v.title?.trim() || `Variant ${i + 1} image`}</p>
                                <p className="mt-0.5 text-[10px] text-zinc-600">Compact preview</p>
                              </div>
                              <button
                                type="button"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:border-red-400/50 hover:text-red-300"
                                onClick={() => {
                                  patchVariant(i, 'imageUrl', '');
                                  variantImageFiles.current[i] = null;
                                  setVariantSelectedFileNames((prev) => {
                                    const next = { ...prev };
                                    delete next[i];
                                    return next;
                                  });
                                }}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="mt-2 w-full rounded-xl border border-dashed border-zinc-800 bg-zinc-950/70 px-3 py-2.5 text-[11px] text-zinc-600 font-light">
                              This variant uses the product image until you upload one.
                            </div>
                          )}
                        </div>
                        <div>
                          <input
                            className="input-base"
                            placeholder="Price (e.g. 3500 or 3500.00)"
                            type="number"
                            min="0"
                            step="0.01"
                            value={v.price}
                            onChange={(e) => patchVariant(i, 'price', e.target.value)}
                            required={i === 0 && modalMode === 'create'}
                          />
                          <PriceHint price={v.price} currency={v.currency} />
                        </div>
                        <CustomSelect
                          options={[
                            { value: 'NGN', label: 'NGN — Nigerian Naira' },
                            { value: 'USD', label: 'USD — US Dollar' },
                          ]}
                          value={v.currency}
                          onChange={(val) => patchVariant(i, 'currency', val)}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="input-base"
                            placeholder="Initial stock"
                            type="number"
                            min="0"
                            value={v.stockOnHand}
                            onChange={(e) => patchVariant(i, 'stockOnHand', e.target.value)}
                          />
                          <CustomSelect
                            options={selectedStoreLocations.map((location: any) => ({ value: location.id, label: location.name }))}
                            value={v.stockLocationId}
                            onChange={(val) => patchVariant(i, 'stockLocationId', val)}
                            placeholder={selectedStoreLocations.length > 0 ? 'Stock location' : 'No locations yet'}
                            disabled={selectedStoreLocations.length === 0}
                          />
                        </div>
                        <p className="text-[11px] text-zinc-600 font-light">
                          Variant-specific images are optional; the product image remains the default.
                        </p>
                      </div>
                    ))}
                  </div>

                  <button type="button" className="btn-ghost w-full flex items-center justify-center gap-1.5 text-xs py-2" onClick={addVariant}>
                    <Plus className="w-3.5 h-3.5" /> Add another variant
                  </button>

                  <div className="sticky bottom-0 -mx-6 mt-4 border-t border-zinc-900 bg-zinc-950/95 px-6 py-4 backdrop-blur-sm">
                    <div className="flex gap-2">
                      <button type="button" className="btn-ghost flex-1" onClick={() => setStep(2)}>← Back</button>
                      <button type="submit" className="btn-primary flex-1" disabled={submitting || editHydrating || !title.trim()}>
                        {submitting ? (modalMode === 'create' ? 'Creating…' : 'Saving…') : (modalMode === 'create' ? 'Create product' : 'Save changes')}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {!modalMode && (
      <>
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">Catalog</h1>
          <p className="mt-1 text-sm text-zinc-500 font-light">Manage products, variants, and their AI knowledge base.</p>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={runSearch} className="flex gap-2">
            <input className="input-base !py-2" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, SKU, category" />
            <button className="btn-secondary" type="submit">Search</button>
          </form>
          {stores.length > 0 && canManage && (
            <button type="button" className="btn-primary flex items-center gap-2 shrink-0" onClick={openCreate}>
              <Plus className="w-4 h-4" /> New product
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-zinc-900 animate-pulse rounded-xl" />)}
        </div>
      ) : stores.length === 0 ? (
        <div className="card p-6 flex flex-col items-start gap-3 max-w-sm">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <p className="text-sm font-normal text-white">No stores yet</p>
          </div>
          <p className="text-xs text-zinc-500 font-light">Create a store first before adding products.</p>
          <a href="/stores" className="btn-secondary text-xs px-3 py-2">Go to Stores →</a>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-normal text-white">Products</h2>
            <span className="text-xs text-zinc-600">{products.length} result{products.length !== 1 ? 's' : ''}</span>
          </div>
          {products.length === 0 ? (
            <div className="p-12 flex flex-col items-center gap-3 text-center">
              <Package className="w-8 h-8 text-zinc-700" />
              <p className="text-sm text-zinc-600 font-light">No products found. Create your first product.</p>
              <button type="button" className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-2" onClick={openCreate}>
                <Plus className="w-3.5 h-3.5" /> New product
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/50">
              {products.map((product) => (
                <div key={product.id} className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-900/40 transition-colors group">
                  {product.imageUrl ? (
                    <img src={product.imageUrl as string} alt={product.title as string} className="w-12 h-12 rounded-xl object-cover bg-zinc-800 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-zinc-700" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white font-light truncate">{product.title}</p>
                      {product.description && (
                        <span title="Has AI description" className="shrink-0">
                          <Sparkles className="w-3 h-3 text-zinc-600" />
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-600">{product.category || 'Uncategorized'} · {product.variantCount || 0} variant{(product.variantCount || 0) !== 1 ? 's' : ''}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {(product.variants || []).slice(0, 3).map((v: any) => (
                        <span key={v.id} className="text-[10px] text-zinc-600 font-mono">
                          {v.sku} · {(v.priceMinor / 100).toLocaleString()} {v.currency}
                        </span>
                      ))}
                      {(product.variantCount || 0) > 3 && (
                        <span className="text-[10px] text-zinc-700">+{(product.variantCount || 0) - 3} more</span>
                      )}
                    </div>
                  </div>
                  {canManage && (
                  <button
                    type="button"
                    className="btn-ghost text-xs flex items-center gap-1.5 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={() => { void openEdit(product); }}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}
