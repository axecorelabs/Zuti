'use client';

import { useState } from 'react';

export default function EventDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.trim().length > 220 || text.split('\n').length > 4;

  const clampStyle: React.CSSProperties = !expanded && isLong
    ? { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
    : {};

  return (
    <div>
      <p
        style={{
          color: 'rgba(255,255,255,0.82)',
          fontSize: 15,
          lineHeight: 1.7,
          margin: 0,
          whiteSpace: 'pre-wrap',
          ...clampStyle,
        }}
      >
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{ background: 'none', border: 'none', color: '#a5b4fc', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '10px 0 0' }}
        >
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
