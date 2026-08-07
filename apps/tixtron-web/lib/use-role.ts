'use client';

import { useAuthStore } from './store';

/** The current user's role in the active org (OWNER | ADMIN | AGENT), or undefined until loaded. */
export function useActiveRole(): string | undefined {
  const { activeOrgId, orgRoles } = useAuthStore();
  return activeOrgId ? orgRoles[activeOrgId] : undefined;
}

/**
 * Whether the current user may MANAGE add-on resources (create/edit/delete events, catalog,
 * inventory, fulfillment). OWNER/ADMIN only — AGENTs get the operational, read + act view instead.
 * Unknown role resolves to false so restricted controls never flash before the role loads; the
 * backend RolesGuard is the real enforcement, this is UX.
 */
export function useCanManage(): boolean {
  const role = useActiveRole();
  return role === 'OWNER' || role === 'ADMIN';
}
