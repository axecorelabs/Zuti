'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { orgsApi } from '@/lib/api';
import PayoutsTab from './payouts-tab';

export default function PayoutsPage() {
  const { activeOrgId } = useAuthStore();
  const [orgName, setOrgName] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!activeOrgId) return;
    orgsApi.list().then((res) => {
      const org = (res.data as Array<{ id: string; name: string }>).find((o) => o.id === activeOrgId);
      setOrgName(org?.name);
    }).catch(() => {});
  }, [activeOrgId]);

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-5">
          <h1 className="font-brand font-semibold text-lg text-zinc-900 dark:text-white">Payouts</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-0.5">Connect the bank account that receives your ticket sales.</p>
        </div>
        <PayoutsTab orgId={activeOrgId ?? undefined} orgName={orgName} />
      </div>
    </div>
  );
}
