'use client';

import { useEffect, useState } from 'react';
import { tixtronOpsApi } from './api';

/** Every Tixtron Ops panel starts by resolving the internal org id this way — never hardcoded,
 * and a 403 here means the logged-in account isn't OWNER/ADMIN of Tixtron HQ (TixtronOpsGuard). */
export function useTixtronContext() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    tixtronOpsApi.getContext()
      .then((res) => {
        if (!active) return;
        setOrganizationId(res.data.organizationId);
        setOrganizationName(res.data.organizationName);
      })
      .catch((e: any) => {
        if (!active) return;
        const status = e?.response?.status;
        if (status === 403) setError("You don't have Tixtron Ops access — ask an existing Tixtron HQ owner to add you.");
        else if (status === 404) setError('Tixtron HQ has not been provisioned yet.');
        else setError('Could not load Tixtron context.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return { organizationId, organizationName, loading, error };
}
