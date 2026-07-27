import axios, { AxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

const ORGS_CACHE_TTL_MS = 45_000;
type OrgsCachedResult = Promise<{ data: any[] }>;
let orgsListCacheData: any[] | null = null;
let orgsListCacheExpiresAt = 0;
let orgsListInFlight: OrgsCachedResult | null = null;
let orgsSummaryCacheData: any[] | null = null;
let orgsSummaryCacheExpiresAt = 0;
let orgsSummaryInFlight: OrgsCachedResult | null = null;

function clearOrgsCache() {
  orgsListCacheData = null;
  orgsListCacheExpiresAt = 0;
  orgsListInFlight = null;
  orgsSummaryCacheData = null;
  orgsSummaryCacheExpiresAt = 0;
  orgsSummaryInFlight = null;
}

function withCachedOrgs(
  kind: 'list' | 'summary',
  forceRefresh = false,
): OrgsCachedResult {
  const now = Date.now();
  const hasValidCache = kind === 'list'
    ? (orgsListCacheData && orgsListCacheExpiresAt > now)
    : (orgsSummaryCacheData && orgsSummaryCacheExpiresAt > now);

  if (!forceRefresh && hasValidCache) {
    return Promise.resolve({ data: (kind === 'list' ? orgsListCacheData : orgsSummaryCacheData) ?? [] });
  }

  const inFlight = kind === 'list' ? orgsListInFlight : orgsSummaryInFlight;
  if (!forceRefresh && inFlight) return inFlight;

  const endpoint = kind === 'list' ? '/organizations' : '/organizations/summary';
  const request = api.get(endpoint)
    .then((res) => {
      const rows = Array.isArray(res.data) ? res.data : [];
      if (kind === 'list') {
        orgsListCacheData = rows;
        orgsListCacheExpiresAt = Date.now() + ORGS_CACHE_TTL_MS;
      } else {
        orgsSummaryCacheData = rows;
        orgsSummaryCacheExpiresAt = Date.now() + ORGS_CACHE_TTL_MS;
      }
      return { data: rows };
    })
    .finally(() => {
      if (kind === 'list') orgsListInFlight = null;
      else orgsSummaryInFlight = null;
    });

  if (kind === 'list') orgsListInFlight = request;
  else orgsSummaryInFlight = request;
  return request;
}

type RetryableConfig = {
  _retry?: boolean;
  headers?: Record<string, string>;
};

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
  if (!refreshToken) return null;

  refreshPromise = api
    .post('/auth/refresh', { refreshToken })
    .then((res) => {
      const nextAccess = String(res.data?.accessToken ?? '');
      const nextRefresh = String(res.data?.refreshToken ?? '');
      if (!nextAccess || !nextRefresh) return null;

      localStorage.setItem('accessToken', nextAccess);
      localStorage.setItem('refreshToken', nextRefresh);
      return nextAccess;
    })
    .catch(() => null)
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

// Attach token from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-redirect on 401
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const requestUrl = String(err?.config?.url ?? '');
    const isAuthEndpoint = requestUrl.includes('/auth/');
    const status = err?.response?.status;
    const original = (err?.config ?? {}) as RetryableConfig;

    if (status === 401 && typeof window !== 'undefined' && !isAuthEndpoint && !original._retry) {
      original._retry = true;
      const nextAccess = await refreshAccessToken();
      if (nextAccess) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${nextAccess}`;
        return api.request(original as any);
      }

      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
    }

    return Promise.reject(err);
  },
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (name: string, email: string, password: string) =>
    api.post('/auth/register', { name, email, password }),
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
  verifyEmail: (token: string) =>
    api.post('/auth/verify-email', { token }),
  resendVerification: (email: string) =>
    api.post('/auth/resend-verification', { email }),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

// ── Organizations ─────────────────────────────────────────────────────────────
export const orgsApi = {
  list: (options?: { forceRefresh?: boolean }) =>
    withCachedOrgs('list', options?.forceRefresh === true),
  listSummary: (options?: { forceRefresh?: boolean }) =>
    withCachedOrgs('summary', options?.forceRefresh === true),
  overview: () => api.get('/organizations/overview'),
  globalOverview: () => api.get('/organizations/global-overview'),
  // Payout account (Paystack subaccount) — where the org's sales settle.
  payoutBanks: () => api.get('/organizations/payout/banks'),
  resolvePayout: (accountNumber: string, bankCode: string) =>
    api.get('/organizations/payout/resolve', { params: { accountNumber, bankCode } }),
  getPayout: (orgId: string) => api.get(`/organizations/${orgId}/payout`),
  setupPayout: (orgId: string, data: { businessName: string; settlementBank: string; bankName?: string; accountNumber: string; primaryContactEmail?: string }) =>
    api.post(`/organizations/${orgId}/payout`, data),
  get: (slug: string) => api.get(`/organizations/${slug}`),
  create: (name: string, slug: string) =>
    api.post('/organizations', { name, slug }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  listVerifiedManagers: () => api.get('/organizations/setup/managers'),
  autoAssignVerifiedManager: () => api.get('/organizations/setup/managers/auto-assign'),
  requestWorkspaceSetup: (data: {
    managerId: string;
    preferredContactMode: 'EMAIL' | 'PHONE' | 'WHATSAPP' | 'TELEGRAM';
    contactDetail: string;
    workspaceName: string;
    note: string;
  }) => api.post('/organizations/setup/requests', data),
  listMySetupRequests: (params?: { status?: 'PENDING' | 'CONTACTED' | 'ORG_CREATED' | 'REQUESTER_ADDED' | 'COMPLETED' | 'DECLINED' | 'CANCELED' }) =>
    api.get('/organizations/setup/requests/mine', { params }),
  listAssignedSetupRequests: (params?: { status?: 'PENDING' | 'CONTACTED' | 'ORG_CREATED' | 'REQUESTER_ADDED' | 'COMPLETED' | 'DECLINED' | 'CANCELED' }) =>
    api.get('/organizations/setup/requests/assigned', { params }),
  updateSetupRequestStatus: (
    requestId: string,
    status: 'PENDING' | 'CONTACTED' | 'ORG_CREATED' | 'REQUESTER_ADDED' | 'COMPLETED' | 'DECLINED' | 'CANCELED',
  ) => api.patch(`/organizations/setup/requests/${requestId}/status`, { status }),
  createOrganizationFromSetupRequest: (requestId: string) =>
    api.post('/organizations/setup/requests/create-organization', { requestId }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  retryRequesterAddFromSetupRequest: (requestId: string) =>
    api.post('/organizations/setup/requests/retry-requester-add', { requestId }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  finalizeSetupHandover: (requestId: string) =>
    api.post('/organizations/setup/requests/finalize-handover', { requestId }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  removeMember: (orgId: string, userId: string) =>
    api.delete(`/organizations/${orgId}/members/${userId}`).then((res) => {
      clearOrgsCache();
      return res;
    }),
  listMembers: (orgId: string) => api.get(`/organizations/${orgId}/members`),
  updateMemberRole: (orgId: string, userId: string, role: string) =>
    api.patch(`/organizations/${orgId}/members/${userId}/role`, { role }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  transferOwnership: (orgId: string, targetUserId: string) =>
    api.post(`/organizations/${orgId}/transfer-owner`, { targetUserId }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  updateAgentProfile: (
    orgId: string,
    userId: string,
    data: { specializations?: string[]; isAvailable?: boolean; maxConcurrentConversations?: number },
  ) => api.patch(`/organizations/${orgId}/members/${userId}/profile`, data),
  listContactEndpoints: (orgId: string) => api.get(`/organizations/${orgId}/contact-endpoints`),
  createContactEndpoint: (
    orgId: string,
    data: {
      label: string;
      channel: 'TELEGRAM' | 'EMAIL' | 'WHATSAPP';
      destination: string;
      userId?: string;
      isPrimary?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) => api.post(`/organizations/${orgId}/contact-endpoints`, data),
  updateContactEndpoint: (
    orgId: string,
    endpointId: string,
    data: {
      label?: string;
      channel?: 'TELEGRAM' | 'EMAIL' | 'WHATSAPP';
      destination?: string;
      userId?: string | null;
      isActive?: boolean;
      isPrimary?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) => api.patch(`/organizations/${orgId}/contact-endpoints/${endpointId}`, data),
  deleteContactEndpoint: (orgId: string, endpointId: string) =>
    api.delete(`/organizations/${orgId}/contact-endpoints/${endpointId}`),
  listContactPolicies: (orgId: string) => api.get(`/organizations/${orgId}/contact-policies`),
  createContactPolicy: (
    orgId: string,
    data: {
      name: string;
      scope: 'ORGANIZATION' | 'BOT';
      endpointId?: string;
      botId?: string;
      isDefault?: boolean;
      rules?: Record<string, unknown>;
    },
  ) => api.post(`/organizations/${orgId}/contact-policies`, data),
  updateContactPolicy: (
    orgId: string,
    policyId: string,
    data: {
      name?: string;
      endpointId?: string | null;
      botId?: string | null;
      isDefault?: boolean;
      rules?: Record<string, unknown>;
    },
  ) => api.patch(`/organizations/${orgId}/contact-policies/${policyId}`, data),
  deleteContactPolicy: (orgId: string, policyId: string) =>
    api.delete(`/organizations/${orgId}/contact-policies/${policyId}`),
  listActionTasks: (
    orgId: string,
    params?: { botId?: string; status?: string; actionType?: string; q?: string; limit?: number; page?: number },
  ) => api.get(`/organizations/${orgId}/action-tasks`, { params }),
  listLeads: (
    orgId: string,
    params?: { botId?: string; q?: string; limit?: number; page?: number },
  ) => api.get(`/organizations/${orgId}/leads`, { params }),
  listBookings: (
    orgId: string,
    params?: { botId?: string; status?: string; q?: string; limit?: number; page?: number },
  ) => api.get(`/organizations/${orgId}/bookings`, { params }),
  listSalesOrders: (
    orgId: string,
    params?: { botId?: string; status?: string; q?: string; limit?: number; page?: number },
  ) => api.get(`/organizations/${orgId}/sales-orders`, { params }),
  listTechnicalIssues: (
    orgId: string,
    params?: { botId?: string; status?: string; q?: string; limit?: number; page?: number },
  ) => api.get(`/organizations/${orgId}/technical-issues`, { params }),
};

// ── Invitations ───────────────────────────────────────────────────────────────
export const invitationsApi = {
  create: (orgId: string, email: string, role?: string) =>
    api.post('/invitations', { orgId, email, role }),
  listMine: () => api.get('/invitations/mine'),
  listByOrg: (orgId: string) => api.get(`/invitations/org/${orgId}`),
  createJoinCode: (orgId: string, role: 'AGENT' | 'ADMIN' = 'AGENT', expiresInHours = 72) =>
    api.post('/invitations/join-codes', { orgId, role, expiresInHours }),
  listJoinCodesByOrg: (orgId: string) => api.get(`/invitations/join-codes/org/${orgId}`),
  redeemJoinCode: (joinId: string, code: string) =>
    api.post('/invitations/join-codes/redeem', { joinId, code }),
  revokeJoinCode: (joinId: string) => api.post(`/invitations/join-codes/${joinId}/revoke`),
  getByToken: (token: string) => api.get(`/invitations/${token}`),
  accept: (token: string) => api.post(`/invitations/${token}/accept`),
  decline: (token: string) => api.post(`/invitations/${token}/decline`),
  revoke: (token: string) => api.post(`/invitations/${token}/revoke`),
};

// ── Bots ──────────────────────────────────────────────────────────────────────
export const botsApi = {
  templates: (orgId: string) => api.get(`/organizations/${orgId}/bots/templates`),
  list: (orgId: string) => api.get(`/organizations/${orgId}/bots`),
  get: (orgId: string, botId: string) =>
    api.get(`/organizations/${orgId}/bots/${botId}`),
  create: (
    orgId: string,
    data: {
      name: string;
      primaryChannel: 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL' | 'WHATSAPP';
      telegramToken?: string;
      webWidgetAllowedDomains?: string[];
      whatsappProvider?: 'META' | 'TWILIO';
      whatsappIntegrationMode?: 'META_EMBEDDED_SIGNUP' | 'META_MANUAL' | 'TWILIO';
      whatsappChannelIdentifier?: string;
      whatsappPhoneNumber?: string;
      whatsappDisplayName?: string;
      whatsappConfig?: Record<string, unknown>;
      template?: 'GENERAL' | 'SALES' | 'SUPPORT' | 'BOOKING' | 'TECHNICAL' | 'ECOMMERCE';
      skills?: Array<'SALES' | 'BOOKING' | 'SUPPORT' | 'TECHNICAL' | 'FORWARDING'>;
      actionForwardingEnabled?: boolean;
      commerceStoreId?: string;
    },
  ) => api.post(`/organizations/${orgId}/bots`, data),
  update: (orgId: string, botId: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${orgId}/bots/${botId}`, data),
  delete: (orgId: string, botId: string) =>
    api.delete(`/organizations/${orgId}/bots/${botId}`),
  setWebhook: (orgId: string, botId: string) =>
    api.post(`/organizations/${orgId}/bots/${botId}/webhook`),
  enableEmail: (orgId: string, botId: string, localPart: string) =>
    api.post(`/organizations/${orgId}/bots/${botId}/email/enable`, { localPart }),
  disableEmail: (orgId: string, botId: string) =>
    api.post(`/organizations/${orgId}/bots/${botId}/email/disable`),
  connectTelegram: (orgId: string, botId: string, token: string) =>
    api.post(`/organizations/${orgId}/bots/${botId}/telegram/connect`, { token }),
  disconnectTelegram: (orgId: string, botId: string) =>
    api.post(`/organizations/${orgId}/bots/${botId}/telegram/disconnect`),
  connectWhatsApp: (
    orgId: string,
    botId: string,
    data: {
      provider: 'META' | 'TWILIO';
      integrationMode: 'META_EMBEDDED_SIGNUP' | 'META_MANUAL' | 'TWILIO';
      channelIdentifier: string;
      phoneNumber?: string;
      displayName?: string;
      verifyToken?: string;
      config?: Record<string, unknown>;
    },
  ) => api.post(`/organizations/${orgId}/bots/${botId}/whatsapp/connect`, data),
  disconnectWhatsApp: (orgId: string, botId: string) =>
    api.post(`/organizations/${orgId}/bots/${botId}/whatsapp/disconnect`),
  startMetaEmbeddedSignup: (orgId: string, botId: string) =>
    api.get(`/organizations/${orgId}/bots/${botId}/whatsapp/meta/embedded/start`),
  completeMetaEmbeddedSignup: (
    orgId: string,
    botId: string,
    data: {
      code: string;
      state: string;
      selectedBusinessAccountId?: string;
      selectedPhoneNumberId?: string;
    },
  ) =>
    api.post(`/organizations/${orgId}/bots/${botId}/whatsapp/meta/embedded/complete`, data),
  completeMetaEmbeddedSelection: (
    orgId: string,
    botId: string,
    data: {
      sessionId: string;
      selectedPhoneNumberId: string;
      selectedBusinessAccountId?: string;
    },
  ) =>
    api.post(`/organizations/${orgId}/bots/${botId}/whatsapp/meta/embedded/complete-selection`, data),
};

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversationsApi = {
  list: (
    orgId: string,
    params?: Record<string, string | undefined> & { limit?: string; cursor?: string },
    config?: AxiosRequestConfig,
  ) => api.get(`/organizations/${orgId}/conversations`, { params, ...config }),
  get: (
    orgId: string,
    convId: string,
    params?: { messageLimit?: number; before?: string; includeContext?: boolean },
    config?: AxiosRequestConfig,
  ) => api.get(`/organizations/${orgId}/conversations/${convId}`, { params, ...config }),
  startInternal: (
    orgId: string,
    data: {
      botId: string;
      customerEmail: string;
      customerName?: string;
      subject?: string;
      sourceRecordType?: string;
      sourceRecordId?: string;
      sourceActionTaskId?: string;
      sourceConversationId?: string;
      allowExternalDelivery?: boolean;
    },
  ) => api.post(`/organizations/${orgId}/conversations/start-internal`, data),
  update: (orgId: string, convId: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${orgId}/conversations/${convId}`, data),
  sendMessage: (orgId: string, convId: string, content: string) =>
    api.post(`/organizations/${orgId}/conversations/${convId}/messages`, { content }),
  retryEmailDelivery: (orgId: string, convId: string) =>
    api.post(`/organizations/${orgId}/conversations/${convId}/retry-email-delivery`),
  addNote: (orgId: string, convId: string, content: string) =>
    api.post(`/organizations/${orgId}/conversations/${convId}/notes`, { content }),
  overview: (orgId: string) =>
    api.get(`/organizations/${orgId}/conversations/analytics/overview`),
  analytics: (
    orgId: string,
    days = 30,
    botId?: string,
    config?: AxiosRequestConfig,
  ) => api.get(`/organizations/${orgId}/conversations/analytics/summary`, {
    params: { days: String(days), ...(botId ? { botId } : {}) },
    ...config,
  }),
};

// ── Commerce ─────────────────────────────────────────────────────────────────
export const commerceApi = {
  listStores: (orgId: string) => api.get(`/organizations/${orgId}/commerce/stores`),
  createStore: (orgId: string, data: { name: string; currency: 'NGN' | 'USD' }) =>
    api.post(`/organizations/${orgId}/commerce/stores`, data),
  updateStore: (orgId: string, storeId: string, data: { name?: string; paystackSubaccountCode?: string }) =>
    api.patch(`/organizations/${orgId}/commerce/stores/${storeId}`, data),
  deleteStore: (orgId: string, storeId: string) =>
    api.delete(`/organizations/${orgId}/commerce/stores/${storeId}`),
  listBanks: (orgId: string) =>
    api.get(`/organizations/${orgId}/commerce/stores/banks`),
  resolveAccount: (orgId: string, accountNumber: string, bankCode: string) =>
    api.get(`/organizations/${orgId}/commerce/stores/banks/resolve`, { params: { accountNumber, bankCode } }),
  setupSubaccount: (
    orgId: string,
    storeId: string,
    data: { businessName: string; settlementBank: string; accountNumber: string; percentageCharge?: number; primaryContactEmail?: string; primaryContactName?: string; primaryContactPhone?: string },
  ) => api.post(`/organizations/${orgId}/commerce/stores/${storeId}/subaccount`, data),
  listPayments: (orgId: string, limit = 100) =>
    api.get(`/organizations/${orgId}/commerce/payments`, { params: { limit } }),
  updateProduct: (orgId: string, productId: string, data: { title?: string; description?: string; category?: string; imageUrl?: string; tags?: string[]; metadata?: Record<string, unknown> }) =>
    api.patch(`/organizations/${orgId}/commerce/products/${productId}`, data),
  generateProductDescription: (
    orgId: string,
    data: { title: string; category?: string; tags?: string[]; specs?: Array<{ key: string; value: string }>; currentDescription?: string; mode?: 'generate' | 'improve' },
  ) => api.post<{ description: string }>(`/organizations/${orgId}/commerce/products/description/generate`, data),
  getProductContext: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/commerce/products/${productId}`),
  createLocation: (orgId: string, data: { storeId: string; name: string; code: string; priority?: number }) =>
    api.post(`/organizations/${orgId}/commerce/locations`, data),
  searchProducts: (orgId: string, q?: string) =>
    api.get(`/organizations/${orgId}/commerce/products/search`, { params: { q, limit: 20 } }),
  createProduct: (
    orgId: string,
    data: { storeId: string; title: string; description?: string; category?: string; tags?: string[]; imageUrl?: string; metadata?: Record<string, unknown> },
  ) => api.post(`/organizations/${orgId}/commerce/products`, data),
  createVariant: (
    orgId: string,
    data: { productId: string; sku: string; title?: string; imageUrl?: string; priceMinor: number; currency: 'NGN' | 'USD'; attributes?: Record<string, unknown> },
  ) => api.post(`/organizations/${orgId}/commerce/variants`, data),
  updateVariant: (
    orgId: string,
    variantId: string,
    data: { sku?: string; title?: string; imageUrl?: string; priceMinor?: number; currency?: 'NGN' | 'USD'; attributes?: Record<string, unknown>; metadata?: Record<string, unknown> },
  ) => api.patch(`/organizations/${orgId}/commerce/variants/${variantId}`, data),
  upsertInventory: (
    orgId: string,
    data: { variantId: string; locationId: string; onHand?: number; reserved?: number; reorderPoint?: number; metadata?: Record<string, unknown> },
  ) => api.post(`/organizations/${orgId}/commerce/inventory/upsert`, data),
  createOrder: (
    orgId: string,
    data: { storeId: string; customerName?: string; customerEmail?: string; customerPhone?: string; deliveryAddress?: string; notes?: string; items: Array<{ variantId: string; locationId?: string; quantity: number }> },
  ) => api.post(`/organizations/${orgId}/commerce/orders`, data),
  getOrder: (orgId: string, orderId: string) => api.get(`/organizations/${orgId}/commerce/orders/${orderId}`),
  listOrders: (orgId: string, limit = 50) =>
    api.get(`/organizations/${orgId}/commerce/orders`, { params: { limit } }),
  initializePayment: (orgId: string, orderId: string, data?: { customerEmail?: string }) =>
    api.post(`/organizations/${orgId}/commerce/orders/${orderId}/payment/initialize`, data ?? {}),
  verifyPayment: (orgId: string, orderId: string, data?: { reference?: string }) =>
    api.post(`/organizations/${orgId}/commerce/orders/${orderId}/payment/verify`, data ?? {}),
  updateFulfillment: (
    orgId: string,
    orderId: string,
    status: 'UNFULFILLED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED',
  ) => api.patch(`/organizations/${orgId}/commerce/orders/${orderId}/fulfillment`, { status }),
  uploadImage: (orgId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ url: string }>(`/organizations/${orgId}/commerce/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ── Commerce helpers (ported from the commerce console) ────────────────────────
// The commerce pages resolve their org via these; both apps share the same 'activeOrgId'
// localStorage key, so this stays in sync with the sidebar org switcher.
export const orgApi = {
  listSummary: () => api.get<Array<{ id: string; name: string; slug: string; role: string }>>('/organizations/summary'),
};

export function resolveOrgId(orgs: { id: string }[]): string | null {
  const cached = typeof window !== 'undefined' ? localStorage.getItem('activeOrgId') : null;
  const resolved = cached && orgs.some((org) => org.id === cached) ? cached : orgs[0]?.id ?? null;
  if (resolved && typeof window !== 'undefined') localStorage.setItem('activeOrgId', resolved);
  return resolved;
}

export const authApiExtra = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

// ── Canned Responses ──────────────────────────────────────────────────────────
export const cannedResponsesApi = {
  list: (orgId: string) => api.get(`/organizations/${orgId}/canned-responses`),
  create: (orgId: string, data: { shortcut: string; title: string; content: string }) =>
    api.post(`/organizations/${orgId}/canned-responses`, data),
  update: (orgId: string, id: string, data: Partial<{ shortcut: string; title: string; content: string }>) =>
    api.patch(`/organizations/${orgId}/canned-responses/${id}`, data),
  remove: (orgId: string, id: string) =>
    api.delete(`/organizations/${orgId}/canned-responses/${id}`),
};

// ── Team Chat ────────────────────────────────────────────────────────────────
export const teamChatApi = {
  listMessages: (orgId: string, params?: { limit?: number; before?: string }) =>
    api.get(`/organizations/${orgId}/team-chat/messages`, { params }),
  sendMessage: (orgId: string, content: string) =>
    api.post(`/organizations/${orgId}/team-chat/messages`, { content }),
  listEscalationThreads: (orgId: string, status?: string) =>
    api.get(`/organizations/${orgId}/team-chat/escalation-threads`, { params: status ? { status } : undefined }),
  replyToEscalationThread: (
    orgId: string,
    threadId: string,
    content: string,
    createKnowledgeSuggestion = true,
  ) => api.post(`/organizations/${orgId}/team-chat/escalation-threads/${threadId}/replies`, { content, createKnowledgeSuggestion }),
  updateEscalationThreadStatus: (orgId: string, threadId: string, status: string) =>
    api.post(`/organizations/${orgId}/team-chat/escalation-threads/${threadId}/status`, { status }),
};

// ── Knowledge Suggestions ───────────────────────────────────────────────────
export const knowledgeApi = {
  listSuggestions: (orgId: string, status?: string) =>
    api.get(`/organizations/${orgId}/knowledge/suggestions`, { params: status ? { status } : undefined }),
  updateSuggestion: (orgId: string, suggestionId: string, data: Partial<{ title: string; content: string }>) =>
    api.patch(`/organizations/${orgId}/knowledge/suggestions/${suggestionId}`, data),
  approveSuggestion: (orgId: string, suggestionId: string) =>
    api.post(`/organizations/${orgId}/knowledge/suggestions/${suggestionId}/approve`),
  rejectSuggestion: (orgId: string, suggestionId: string, reason?: string) =>
    api.post(`/organizations/${orgId}/knowledge/suggestions/${suggestionId}/reject`, { reason }),
  listGaps: (orgId: string, status?: string) =>
    api.get(`/organizations/${orgId}/knowledge/gaps`, { params: status ? { status } : undefined }),
  updateGapStatus: (orgId: string, gapId: string, status: 'OPEN' | 'ANSWERED' | 'RESOLVED' | 'DISMISSED') =>
    api.post(`/organizations/${orgId}/knowledge/gaps/${gapId}/status`, { status }),
};

// ── AI Usage ────────────────────────────────────────────────────────────────
export const aiUsageApi = {
  summary: (orgId: string, days = 30, config?: AxiosRequestConfig) =>
    api.get(`/organizations/${orgId}/ai-usage/summary`, { params: { days: String(days) }, ...config }),
};

// ── Pricing ─────────────────────────────────────────────────────────────────
export const pricingApi = {
  catalog: (orgId: string, market: 'NG' | 'US', config?: AxiosRequestConfig) =>
    api.get(`/organizations/${orgId}/pricing/catalog`, { params: { market }, ...config }),
  estimates: (orgId: string, market: 'NG' | 'US', config?: AxiosRequestConfig) =>
    api.get(`/organizations/${orgId}/pricing/estimates`, { params: { market }, ...config }),
  quote: (orgId: string, market: 'NG' | 'US', packId: string) =>
    api.post(`/organizations/${orgId}/pricing/quote`, { market, packId }),
};

// ── Billing ─────────────────────────────────────────────────────────────────
export const billingApi = {
  wallet: (orgId: string, config?: AxiosRequestConfig) =>
    api.get(`/organizations/${orgId}/billing/wallet`, config),
  checkoutPack: (
    orgId: string,
    market: 'NG' | 'US',
    packId: string,
    callbackUrl?: string,
  ) => api.post(`/organizations/${orgId}/billing/checkout/pack`, { market, packId, callbackUrl }),
  checkoutCommitment: (
    orgId: string,
    market: 'NG' | 'US',
    subscriptionId: string,
    callbackUrl?: string,
  ) => api.post(`/organizations/${orgId}/billing/checkout/commitment`, {
    market,
    subscriptionId,
    callbackUrl,
  }),
  verifyCheckout: (orgId: string, reference: string) =>
    api.post(`/organizations/${orgId}/billing/checkout/verify`, { reference }),
};

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationsApi = {
  list: (orgId: string, includeRead = false, includeAllUsers = false) =>
    api.get(`/organizations/${orgId}/notifications`, {
      params: includeRead || includeAllUsers
        ? {
            ...(includeRead ? { includeRead: 'true' } : {}),
            ...(includeAllUsers ? { includeAllUsers: 'true' } : {}),
          }
        : undefined,
    }),
  markRead: (orgId: string, notifId: string) =>
    api.post(`/organizations/${orgId}/notifications/${notifId}/read`),
  markAllRead: (orgId: string) =>
    api.post(`/organizations/${orgId}/notifications/read-all`),
};

// ── Registrations ─────────────────────────────────────────────────────────────
export const registrationsApi = {
  listProducts: (orgId: string, botId?: string) =>
    api.get(`/organizations/${orgId}/registrations`, { params: botId ? { botId } : undefined }),
  createProduct: (orgId: string, data: Record<string, unknown>) =>
    api.post(`/organizations/${orgId}/registrations`, data),
  updateProduct: (orgId: string, productId: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${orgId}/registrations/${productId}`, data),
  deleteProduct: (orgId: string, productId: string) =>
    api.delete(`/organizations/${orgId}/registrations/${productId}`),
  listEntries: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/entries`),
  updateEntryStatus: (orgId: string, entryId: string, status: string) =>
    api.patch(`/organizations/${orgId}/registrations/entries/${entryId}`, { status }),
  listFailedReceipts: (orgId: string) =>
    api.get(`/organizations/${orgId}/registrations/dead-letter`),
  retryFailedReceipt: (orgId: string, jobId: string) =>
    api.post(`/organizations/${orgId}/registrations/dead-letter/${jobId}/retry`),
  discardFailedReceipt: (orgId: string, jobId: string) =>
    api.delete(`/organizations/${orgId}/registrations/dead-letter/${jobId}`),
  // Ticket tiers
  listTicketTypes: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/ticket-types`),
  createTicketType: (orgId: string, productId: string, data: Record<string, unknown>) =>
    api.post(`/organizations/${orgId}/registrations/${productId}/ticket-types`, data),
  updateTicketType: (orgId: string, ticketTypeId: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${orgId}/registrations/ticket-types/${ticketTypeId}`, data),
  deleteTicketType: (orgId: string, ticketTypeId: string) =>
    api.delete(`/organizations/${orgId}/registrations/ticket-types/${ticketTypeId}`),
  // Scan-to-admit: verify a ticket QR's code and mark the entry checked in (single-use).
  // Pass productId to lock the scanner to one event (tickets for others are rejected).
  checkIn: (orgId: string, code: string, productId?: string) =>
    api.post(`/organizations/${orgId}/registrations/checkin`, { code, productId }),
  // Manual admit / undo a specific entry from the Check-in list (QR fallback). admit=false undoes.
  checkInEntry: (orgId: string, entryId: string, admit: boolean) =>
    api.post(`/organizations/${orgId}/registrations/entries/${entryId}/checkin`, { admit }),
  // Scan sessions (temporary public check-in links) — OWNER/ADMIN.
  listScanSessions: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/scan-sessions`),
  createScanSession: (orgId: string, productId: string, data: { label?: string; expiresAt?: string }) =>
    api.post(`/organizations/${orgId}/registrations/${productId}/scan-sessions`, data),
  revokeScanSession: (orgId: string, sessionId: string) =>
    api.delete(`/organizations/${orgId}/registrations/scan-sessions/${sessionId}`),
  // Attendee announcements (Messages) — OWNER/ADMIN.
  announcementRecipients: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/announcements/recipients`),
  listAnnouncements: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/announcements`),
  createAnnouncement: (orgId: string, productId: string, data: { segment: string; tierId?: string; subject: string; body: string }) =>
    api.post(`/organizations/${orgId}/registrations/${productId}/announcements`, data),
};

// ── Customers (Customer hub) ────────────────────────────────────────────────
export const customersApi = {
  list: (orgId: string, params?: { search?: string; stage?: string; includeLeads?: boolean; limit?: number; offset?: number }) =>
    api.get(`/organizations/${orgId}/customers`, { params }),
  get: (orgId: string, customerId: string) =>
    api.get(`/organizations/${orgId}/customers/${customerId}`),
  update: (orgId: string, customerId: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${orgId}/customers/${customerId}`, data),
  merge: (orgId: string, survivorId: string, absorbedId: string) =>
    api.post(`/organizations/${orgId}/customers/${survivorId}/merge`, { absorbedId }),
  export: (orgId: string, customerId: string) =>
    api.get(`/organizations/${orgId}/customers/${customerId}/export`),
  remove: (orgId: string, customerId: string) =>
    api.delete(`/organizations/${orgId}/customers/${customerId}`),
};

// ── Activity ──────────────────────────────────────────────────────────────────
export const activityApi = {
  list: (orgId: string, params?: { page?: number; limit?: number }) =>
    api.get(`/organizations/${orgId}/activity`, { params }),
};
