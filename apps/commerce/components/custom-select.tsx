'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  sub?: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  className = '',
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`w-full flex items-center justify-between gap-2 bg-zinc-900 border rounded-xl px-4 py-3 text-sm font-light text-left transition-colors
          ${open ? 'border-zinc-600 ring-1 ring-zinc-700' : 'border-zinc-800'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-zinc-700 cursor-pointer'}
          ${!selected ? 'text-zinc-600' : 'text-white'}`}
      >
        <span className="truncate flex-1">
          {selected ? (
            <span className="flex flex-col leading-tight">
              <span>{selected.label}</span>
              {selected.sub ? <span className="text-xs text-zinc-500 font-light">{selected.sub}</span> : null}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-zinc-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
          <ul className="max-h-52 overflow-y-auto py-1">
            {options.length === 0 ? (
              <li className="px-4 py-3 text-sm text-zinc-600 font-light">No options</li>
            ) : (
              options.map((opt) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left transition-colors
                      ${opt.value === value
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'}`}
                  >
                    <span className="flex flex-col leading-tight flex-1 min-w-0">
                      <span className="truncate">{opt.label}</span>
                      {opt.sub ? <span className="text-xs text-zinc-500 font-light truncate">{opt.sub}</span> : null}
                    </span>
                    {opt.value === value && <Check className="w-3.5 h-3.5 text-zinc-400 shrink-0" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
