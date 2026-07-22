'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { orgsApi, commerceApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Store, Package, BarChart2, MapPin } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

type Org = { id: string; name: string };

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300">
        <p className="text-white font-medium mb-0.5">{label}</p>
        <p>{payload[0].value} {payload[0].name}</p>
      </div>
    );
  }
  return null;
};

export default function CommerceOverviewPage() {
  const { activeOrgId } = useAuthStore();
  const searchParams = useSearchParams();
  const orgParam = searchParams.get('org');
  const [org, setOrg] = useState<Org | null>(null);
  const [stores, setStores] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const orgRes = await orgsApi.list();
        const orgs = (orgRes.data ?? []) as Org[];
        if (!orgs.length) return;
        const active =
          (orgParam ? orgs.find((o) => o.id === orgParam) : undefined)
          ?? (activeOrgId ? orgs.find((o) => o.id === activeOrgId) : undefined)
          ?? orgs[0];
        if (!mounted || !active) return;
        setOrg(active);

        const [storeRes, productRes] = await Promise.all([
          commerceApi.listStores(active.id),
          commerceApi.searchProducts(active.id),
        ]);
        if (!mounted) return;
        setStores(Array.isArray(storeRes.data) ? storeRes.data : []);
        setProducts(Array.isArray(productRes.data?.items) ? productRes.data.items : []);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [activeOrgId, orgParam]);

  const storeChartData = stores.map((s: any) => ({
    name: (s.name as string).length > 14 ? (s.name as string).slice(0, 12) + '…' : (s.name as string),
    products: (s._count?.products as number) ?? 0,
    locations: (s._count?.locations as number) ?? 0,
  }));

  const productChartData = products.slice(0, 8).map((p: any) => ({
    name: (p.title as string).length > 14 ? (p.title as string).slice(0, 12) + '…' : (p.title as string),
    variants: (p.variantCount as number) ?? 0,
  }));

  const statCards = [
    { label: 'Active stores', value: stores.length, icon: Store, accent: 'bg-blue-600/15 border-blue-600/20 text-blue-400' },
    { label: 'Catalog products', value: products.length, icon: Package, accent: 'bg-zinc-800 border-zinc-700 text-zinc-400' },
    { label: 'Total variants', value: products.reduce((acc: number, p: any) => acc + ((p.variantCount as number) ?? 0), 0), icon: BarChart2, accent: 'bg-zinc-800 border-zinc-700 text-zinc-400' },
    { label: 'Total locations', value: stores.reduce((acc: number, s: any) => acc + ((s._count?.locations as number) ?? 0), 0), icon: MapPin, accent: 'bg-zinc-800 border-zinc-700 text-zinc-400' },
  ];

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="font-brand font-semibold text-2xl tracking-tight text-white">
          {loading
            ? <span className="inline-block w-40 h-7 bg-zinc-900 animate-pulse rounded-lg" />
            : (org?.name ?? 'Commerce')}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 font-light">Commerce operations — stores, catalog and orders.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-zinc-500 font-normal">{label}</p>
              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${accent}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
            </div>
            {loading
              ? <div className="w-10 h-7 bg-zinc-800 animate-pulse rounded" />
              : <p className="font-brand font-semibold text-3xl text-white tracking-tight">{value}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-6">
          <div className="mb-5">
            <h2 className="text-sm font-normal text-white">Products by store</h2>
            <p className="text-xs text-zinc-600 font-light mt-0.5">Product count per store</p>
          </div>
          {loading ? (
            <div className="h-40 bg-zinc-900 animate-pulse rounded-xl" />
          ) : storeChartData.length === 0 ? (
            <div className="h-40 flex items-center justify-center">
              <p className="text-sm text-zinc-600 font-light">No stores yet.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={storeChartData} barSize={28}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 11 }} />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="products" name="products" radius={[4, 4, 0, 0]}>
                  {storeChartData.map((_, i) => (<Cell key={i} fill="#3b82f6" />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-6">
          <div className="mb-5">
            <h2 className="text-sm font-normal text-white">Variants by product</h2>
            <p className="text-xs text-zinc-600 font-light mt-0.5">Top 8 products</p>
          </div>
          {loading ? (
            <div className="h-40 bg-zinc-900 animate-pulse rounded-xl" />
          ) : productChartData.length === 0 ? (
            <div className="h-40 flex items-center justify-center">
              <p className="text-sm text-zinc-600 font-light">No products yet.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={productChartData} barSize={28}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#52525b', fontSize: 11 }} />
                <YAxis hide allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar dataKey="variants" name="variants" radius={[4, 4, 0, 0]}>
                  {productChartData.map((_, i) => (<Cell key={i} fill="#27272a" />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-normal text-white">Recent catalog snapshot</h2>
        <p className="text-xs text-zinc-600 font-light mt-0.5 mb-4">Latest products in your store.</p>
        <div className="space-y-2">
          {products.slice(0, 6).map((product: any) => (
            <div key={product.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl as string} alt={product.title as string} className="w-9 h-9 rounded-lg object-cover bg-zinc-800 shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4 text-zinc-600" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-light truncate">{product.title}</p>
                <p className="text-xs text-zinc-600">{product.category || 'Uncategorized'}</p>
              </div>
              <p className="text-xs text-zinc-500 shrink-0">{product.variantCount || 0} variants</p>
            </div>
          ))}
          {!loading && products.length === 0
            ? <p className="text-sm text-zinc-600 font-light">No products yet. Create one in Catalog.</p>
            : null}
        </div>
      </div>
    </div>
  );
}
