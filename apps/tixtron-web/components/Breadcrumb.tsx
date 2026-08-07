import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

// "overlay" is for breadcrumbs sitting directly on a photo (inside a small bg-black/45 pill, e.g.
// the event detail hero) — always light-on-dark regardless of site theme, and no outer margin
// since the pill itself controls spacing. "default" is for normal page use (adds its own mb-6,
// theme-aware colors) — e.g. /search, /organizers.
export function Breadcrumb({ items, variant = 'default' }: { items: BreadcrumbItem[]; variant?: 'default' | 'overlay' }) {
  const isOverlay = variant === 'overlay';
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1.5 text-xs flex-wrap ${isOverlay ? 'text-zinc-300' : 'text-zinc-500 mb-6'}`}
    >
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className={`w-3 h-3 shrink-0 ${isOverlay ? 'text-zinc-500' : 'text-zinc-300 dark:text-zinc-700'}`} />}
          {item.href ? (
            <Link href={item.href} className={`transition-colors ${isOverlay ? 'hover:text-white' : 'hover:text-zinc-900 dark:hover:text-white'}`}>{item.label}</Link>
          ) : (
            <span className={`font-medium truncate max-w-[240px] ${isOverlay ? 'text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
