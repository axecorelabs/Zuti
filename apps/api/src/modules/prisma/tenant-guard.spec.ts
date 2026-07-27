import { whereReferencesField, checkTenantSafety, buildTenantScopedMap, GUARDED_ACTIONS } from './tenant-guard';

describe('tenant-guard', () => {
  describe('whereReferencesField', () => {
    it('detects the field at the top level', () => {
      expect(whereReferencesField({ orgId: 'a' }, 'orgId')).toBe(true);
      expect(whereReferencesField({ orgId: { in: ['a', 'b'] } }, 'orgId')).toBe(true);
    });
    it('returns false when the field is absent', () => {
      expect(whereReferencesField({ status: 'OPEN' }, 'orgId')).toBe(false);
      expect(whereReferencesField(undefined, 'orgId')).toBe(false);
      expect(whereReferencesField(null, 'orgId')).toBe(false);
      expect(whereReferencesField({}, 'orgId')).toBe(false);
    });
    it('recurses into AND / OR / NOT', () => {
      expect(whereReferencesField({ AND: [{ status: 'x' }, { orgId: 'a' }] }, 'orgId')).toBe(true);
      expect(whereReferencesField({ OR: [{ orgId: 'a' }] }, 'orgId')).toBe(true);
      expect(whereReferencesField({ NOT: { orgId: 'a' } }, 'orgId')).toBe(true);
      expect(whereReferencesField({ AND: [{ status: 'x' }, { botId: 'b' }] }, 'orgId')).toBe(false);
    });
    it('does not walk into unrelated relation filters', () => {
      // org field of THIS model is never nested inside a relation filter — a product relation
      // referencing orgId must not count as the row's own scope.
      expect(whereReferencesField({ product: { orgId: 'a' } }, 'orgId')).toBe(false);
    });
  });

  describe('checkTenantSafety', () => {
    const map = new Map<string, string>([
      ['Conversation', 'organizationId'],
      ['RegistrationEntry', 'orgId'],
    ]);

    it('passes bulk queries that are org-scoped', () => {
      expect(checkTenantSafety('Conversation', 'findMany', { where: { organizationId: 'a' } }, map).safe).toBe(true);
      expect(checkTenantSafety('RegistrationEntry', 'updateMany', { where: { orgId: 'a', status: 'CONFIRMED' } }, map).safe).toBe(true);
    });

    it('flags bulk queries missing the org filter', () => {
      expect(checkTenantSafety('Conversation', 'findMany', { where: {} }, map).safe).toBe(false);
      expect(checkTenantSafety('RegistrationEntry', 'findMany', { where: { status: 'CONFIRMED' } }, map).safe).toBe(false);
      expect(checkTenantSafety('RegistrationEntry', 'count', {}, map).safe).toBe(false);
      expect(checkTenantSafety('Conversation', 'groupBy', { where: undefined }, map).safe).toBe(false);
    });

    it('ignores single-row / by-id operations', () => {
      expect(checkTenantSafety('RegistrationEntry', 'findUnique', { where: { id: 'x' } }, map).safe).toBe(true);
      expect(checkTenantSafety('RegistrationEntry', 'findFirst', { where: { checkInCode: 'x' } }, map).safe).toBe(true);
      expect(checkTenantSafety('Conversation', 'update', { where: { id: 'x' } }, map).safe).toBe(true);
      expect(checkTenantSafety('RegistrationEntry', 'create', { data: {} }, map).safe).toBe(true);
    });

    it('ignores models without a direct org field', () => {
      expect(checkTenantSafety('User', 'findMany', { where: {} }, map).safe).toBe(true);
      expect(checkTenantSafety(undefined, 'findMany', { where: {} }, map).safe).toBe(true);
    });

    it('reports the offending model/action/field when unsafe', () => {
      const res = checkTenantSafety('RegistrationEntry', 'deleteMany', { where: { status: 'CANCELLED' } }, map);
      expect(res).toMatchObject({ safe: false, model: 'RegistrationEntry', action: 'deleteMany', field: 'orgId' });
    });
  });

  describe('buildTenantScopedMap (live schema)', () => {
    const map = buildTenantScopedMap();
    it('includes known tenant-scoped models with the right field', () => {
      expect(map.size).toBeGreaterThan(0);
      expect(map.get('Conversation')).toBe('organizationId');
      expect(map.get('RegistrationEntry')).toBe('orgId');
      expect(map.get('Customer')).toBe('orgId');
    });
    it('excludes non-tenant models', () => {
      expect(map.has('User')).toBe(false);
    });
  });

  it('guards multi-row actions only', () => {
    expect(GUARDED_ACTIONS.has('findMany')).toBe(true);
    expect(GUARDED_ACTIONS.has('findUnique')).toBe(false);
    expect(GUARDED_ACTIONS.has('create')).toBe(false);
  });
});
