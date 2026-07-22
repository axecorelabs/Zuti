'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LayoutDashboard, Store, Boxes, ShoppingCart, CreditCard } from 'lucide-react';

const TABS = [
  { href: '/commerce', label: 'Overview', icon: LayoutDashboard },
  { href: '/commerce/stores', label: 'Stores', icon: Store },
  { href: '/commerce/catalog', label: 'Catalog', icon: Boxes },
  { href: '/commerce/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/commerce/payments', label: 'Payments', icon: CreditCard },
];

export default function CommerceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const org = searchParams.get('org');
  const q = org ? `?org=${org}` : '';

  return (
    <div className="commerce-page">
      <div className="border-b border-zinc-800/60 px-4 md:px-6 pt-4">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.href === '/commerce' ? pathname === '/commerce' : pathname.startsWith(t.href);
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={`${t.href}${q}`}
                className={`flex items-center gap-2 px-3 py-2.5 text-sm rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                  active ? 'border-blue-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}
