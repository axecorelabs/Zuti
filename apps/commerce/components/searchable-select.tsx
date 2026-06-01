'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  sub?: string;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * If true, the typed search text is also accepted as the value (combobox mode).
   * Useful for category fields where the user may enter a custom value not in the list.
   */
  freeform?: boolean;
  loading?: boolean;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  disabled = false,
  className = '',
  freeform = false,
  loading = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  // In freeform mode the displayed value is the raw string even if not in the list
  const displayLabel = selected ? selected.label : freeform ? value : '';

  const filtered = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const openDropdown = () => {
    if (disabled || loading) return;
    // Pre-fill search with current value so user can refine
    setSearch(freeform && value && !selected ? value : '');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const closeDropdown = () => {
    setOpen(false);
    setSearch('');
  };

  const selectOption = (opt: SearchableOption) => {
    onChange(opt.value);
    closeDropdown();
  };

  const handleSearchChange = (v: string) => {
    setSearch(v);
    if (freeform) onChange(v);
  };

  const clearValue = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    closeDropdown();
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      {/* Trigger button (closed state) */}
      {!open && (
        <button
          type="button"
          onClick={openDropdown}
          disabled={disabled || loading}
          className={`w-full flex items-center justify-between gap-2 bg-zinc-900 border rounded-xl px-4 py-3 text-sm font-light text-left transition-colors
            border-zinc-800 hover:border-zinc-700
            ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            ${!displayLabel ? 'text-zinc-600' : 'text-white'}`}
        >
          <span className="truncate flex-1">
            {loading ? 'Loading…' : displayLabel || placeholder}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {value && !loading && (
              <span
                onClick={clearValue}
                className="text-zinc-600 hover:text-zinc-400 transition-colors"
                aria-label="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </span>
            )}
            <ChevronDown className="w-4 h-4 text-zinc-500" />
          </div>
        </button>
      )}

      {/* Open state: inline search input + dropdown list */}
      {open && (
        <div className="bg-zinc-900 border border-zinc-600 ring-1 ring-zinc-700 rounded-xl overflow-hidden">
          {/* Search row */}
          <div className="flex items-center gap-2 px-4 py-3">
            <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 outline-none font-light"
              placeholder={placeholder}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') closeDropdown();
                if (e.key === 'Enter') {
                  if (filtered.length > 0) selectOption(filtered[0]);
                  else if (freeform && search.trim()) closeDropdown();
                }
              }}
            />
            <button
              type="button"
              onClick={closeDropdown}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <ChevronDown className="w-4 h-4 rotate-180" />
            </button>
          </div>

          {/* Options list */}
          {filtered.length > 0 && (
            <ul className="max-h-52 overflow-y-auto border-t border-zinc-800 py-1">
              {filtered.map((opt) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => selectOption(opt)}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left transition-colors
                      ${opt.value === value
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'
                      }`}
                  >
                    <span className="flex flex-col leading-tight">
                      <span>{opt.label}</span>
                      {opt.sub && <span className="text-xs text-zinc-500 font-light">{opt.sub}</span>}
                    </span>
                    {opt.value === value && <Check className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {filtered.length === 0 && !freeform && (
            <p className="px-4 py-3 text-sm text-zinc-600 font-light border-t border-zinc-800">No results</p>
          )}
          {filtered.length === 0 && freeform && search.trim() && (
            <p className="px-4 py-2 text-[11px] text-zinc-600 font-light border-t border-zinc-800">
              Press Enter to use "{search}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}
