'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function KnowledgeGapsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/knowledge?tab=gaps');
  }, [router]);

  return (
    <div className="p-8">
      <p className="text-sm text-zinc-500">Redirecting to Resolution Center...</p>
      <p className="text-xs text-zinc-600 mt-2">
        If redirect does not happen, open{' '}
        <Link href="/knowledge?tab=gaps" className="text-blue-400 hover:text-blue-300">
          Knowledge Gaps
        </Link>
        .
      </p>
    </div>
  );
}
