import { Prisma } from '@prisma/client';

/**
 * Defense-in-depth tenant guard (detection). Tenant isolation is enforced in the app layer (every
 * query is orgId-scoped behind auth), and RLS is not used — this catches a *bug* where a bulk query
 * on tenant-scoped data forgets its org filter, which would read/write across tenants.
 *
 * Deliberately conservative to stay noise-free and trusted:
 *  - Only models with a DIRECT org scalar (orgId / organizationId) are guarded. Relation-scoped
 *    models (e.g. a tier scoped via its product) are out of scope here.
 *  - Only BULK actions are checked. Single-row ops (findUnique/findFirst, create, id-based
 *    update/delete) return/affect one row and are trusted to their id — guarding them would flag
 *    huge numbers of legitimate lookups.
 *  - We flag only when the org field is ABSENT from the whole where-tree — the egregious
 *    "forgot to scope" case — not subtle OR/NOT logic.
 */

const ORG_FIELDS = ['orgId', 'organizationId'] as const;

// Multi-row reads/writes where a missing tenant filter can leak or mutate across orgs.
export const GUARDED_ACTIONS = new Set(['findMany', 'updateMany', 'deleteMany', 'count', 'aggregate', 'groupBy']);

/** model name → its org scalar field, for every model that has one. Built from the live schema so it
 * never drifts as models are added. */
export function buildTenantScopedMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const model of Prisma.dmmf.datamodel.models) {
    const field = model.fields.find((f) => f.kind === 'scalar' && (ORG_FIELDS as readonly string[]).includes(f.name));
    if (field) map.set(model.name, field.name);
  }
  return map;
}

/** Does `field` appear as a key anywhere in the where-tree (top level, or inside AND/OR/NOT)? */
export function whereReferencesField(where: unknown, field: string, depth = 0): boolean {
  if (!where || typeof where !== 'object' || depth > 6) return false;
  if (Array.isArray(where)) return where.some((w) => whereReferencesField(w, field, depth + 1));
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === field) return true;
    if ((key === 'AND' || key === 'OR' || key === 'NOT') && whereReferencesField(value, field, depth + 1)) return true;
  }
  return false;
}

export interface TenantCheck {
  safe: boolean;
  model: string;
  action: string;
  field?: string;
}

/** Decide whether a query is tenant-safe by our conservative rules. `args` is the Prisma query args. */
export function checkTenantSafety(
  model: string | undefined,
  action: string,
  args: { where?: unknown } | undefined,
  tenantMap: Map<string, string>,
): TenantCheck {
  if (!model) return { safe: true, model: model ?? '', action }; // raw queries, $runCommandRaw, etc.
  const field = tenantMap.get(model);
  if (!field) return { safe: true, model, action }; // not a directly tenant-scoped model
  if (!GUARDED_ACTIONS.has(action)) return { safe: true, model, action }; // single-row / by-id op
  return { safe: whereReferencesField(args?.where, field), model, action, field };
}
