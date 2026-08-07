'use client';

import { useState } from 'react';

export default function EventDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.trim().length > 220 || text.split('\n').length > 4;

  return (
    <div>
      <p
        className={`text-zinc-600 dark:text-zinc-300 text-[15px] lg:text-[15.5px] leading-[1.7] whitespace-pre-wrap ${!expanded && isLong ? 'line-clamp-4' : ''}`}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="bg-transparent border-none text-brand-600 dark:text-brand-400 text-[13px] font-semibold pt-2.5 hover:text-brand-500 dark:hover:text-brand-300"
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
