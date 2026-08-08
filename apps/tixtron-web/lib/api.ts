import axios, { AxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  // Sends/receives the httpOnly refresh-token cookie — required since the API is a different
  // origin (port/domain) than this app.
  withCredentials: true,
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

// The refresh token itself is never seen by JS anymore — it lives in an httpOnly cookie the
// browser attaches automatically (withCredentials above). This just asks the server to use it.
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = api
    .post('/auth/refresh')
    .then((res) => {
      const nextAccess = String(res.data?.accessToken ?? '');
      if (!nextAccess) return null;
      localStorage.setItem('accessToken', nextAccess);
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
      // Best-effort: clear the now-invalid refresh-token cookie server-side too.
      api.post('/auth/logout').catch(() => {});
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
  refresh: () => api.post('/auth/refresh'),
  logout: () => api.post('/auth/logout'),
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

// ── Organizations ────────────────────────────────────────────────────────────
// Same org model/endpoints as Zuti — a Tixtron signup IS a Zuti organization,
// just presented through this simplified dashboard.
export const orgsApi = {
  list: (options?: { forceRefresh?: boolean }) =>
    withCachedOrgs('list', options?.forceRefresh === true),
  listSummary: (options?: { forceRefresh?: boolean }) =>
    withCachedOrgs('summary', options?.forceRefresh === true),
  get: (slug: string) => api.get(`/organizations/${slug}`),
  create: (name: string, slug: string) =>
    api.post('/organizations', { name, slug }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  // Payout account (Paystack subaccount) — where the org's ticket sales settle.
  payoutBanks: () => api.get('/organizations/payout/banks'),
  resolvePayout: (accountNumber: string, bankCode: string) =>
    api.get('/organizations/payout/resolve', { params: { accountNumber, bankCode } }),
  getPayout: (orgId: string) => api.get(`/organizations/${orgId}/payout`),
  setupPayout: (orgId: string, data: { businessName: string; settlementBank: string; bankName?: string; accountNumber: string; primaryContactEmail?: string }) =>
    api.post(`/organizations/${orgId}/payout`, data),
  listMembers: (orgId: string) => api.get(`/organizations/${orgId}/members`),
  removeMember: (orgId: string, userId: string) =>
    api.delete(`/organizations/${orgId}/members/${userId}`).then((res) => {
      clearOrgsCache();
      return res;
    }),
  updateMemberRole: (orgId: string, userId: string, role: string) =>
    api.patch(`/organizations/${orgId}/members/${userId}/role`, { role }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  // Soft-delete: recoverable for 30 days via restore, then permanently purged.
  deleteOrg: (orgId: string, confirmName: string) =>
    api.post(`/organizations/${orgId}/delete`, { confirmName }).then((res) => {
      clearOrgsCache();
      return res;
    }),
  restoreOrg: (orgId: string) =>
    api.post(`/organizations/${orgId}/restore`).then((res) => {
      clearOrgsCache();
      return res;
    }),
};

// ── Team invitations ────────────────────────────────────────────────────────
export const invitationsApi = {
  create: (orgId: string, email: string, role?: string) =>
    api.post('/invitations', { orgId, email, role }),
  listMine: () => api.get('/invitations/mine'),
  listByOrg: (orgId: string) => api.get(`/invitations/org/${orgId}`),
  getByToken: (token: string) => api.get(`/invitations/${token}`),
  accept: (token: string) => api.post(`/invitations/${token}/accept`),
  decline: (token: string) => api.post(`/invitations/${token}/decline`),
  revoke: (token: string) => api.post(`/invitations/${token}/revoke`),
};

// ── Image upload (banner/flier — reuses the same Supabase-backed endpoint) ──
export const commerceApi = {
  uploadImage: (orgId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ url: string }>(`/organizations/${orgId}/commerce/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ── Registrations / Events / Tickets (identical to Zuti's registrations API) ─
export const registrationsApi = {
  overview: (orgId: string) => api.get(`/organizations/${orgId}/registrations/overview`),
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
  checkIn: (orgId: string, code: string, productId?: string) =>
    api.post(`/organizations/${orgId}/registrations/checkin`, { code, productId }),
  checkInEntry: (orgId: string, entryId: string, admit: boolean) =>
    api.post(`/organizations/${orgId}/registrations/entries/${entryId}/checkin`, { admit }),
  listScanSessions: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/scan-sessions`),
  createScanSession: (orgId: string, productId: string, data: { label?: string; expiresAt?: string }) =>
    api.post(`/organizations/${orgId}/registrations/${productId}/scan-sessions`, data),
  revokeScanSession: (orgId: string, sessionId: string) =>
    api.delete(`/organizations/${orgId}/registrations/scan-sessions/${sessionId}`),
  listWaitlist: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/waitlist`),
  cancelWaitlistEntry: (orgId: string, waitlistEntryId: string) =>
    api.delete(`/organizations/${orgId}/registrations/waitlist/${waitlistEntryId}`),
  announcementRecipients: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/announcements/recipients`),
  listAnnouncements: (orgId: string, productId: string) =>
    api.get(`/organizations/${orgId}/registrations/${productId}/announcements`),
  createAnnouncement: (orgId: string, productId: string, data: { segment: string; tierId?: string; subject: string; body: string }) =>
    api.post(`/organizations/${orgId}/registrations/${productId}/announcements`, data),
};

// ── Bots — the events form's optional botId picker, plus Tixtron's command-based Telegram bot ──
export const botsApi = {
  list: (orgId: string) => api.get(`/organizations/${orgId}/bots`),
  create: (orgId: string, data: { name: string; telegramToken: string; botType: 'COMMAND' }) =>
    api.post(`/organizations/${orgId}/bots`, data),
  remove: (orgId: string, botId: string) => api.delete(`/organizations/${orgId}/bots/${botId}`),
  setWebhook: (orgId: string, botId: string) => api.post(`/organizations/${orgId}/bots/${botId}/webhook`),
  stats: (orgId: string, botId: string) => api.get(`/organizations/${orgId}/bots/${botId}/stats`),
  marketingRecipients: (orgId: string, botId: string) => api.get(`/organizations/${orgId}/bots/${botId}/marketing/recipients`),
  marketingCostEstimate: (orgId: string, botId: string) => api.get(`/organizations/${orgId}/bots/${botId}/marketing/eligibility`),
  createBroadcast: (orgId: string, botId: string, data: { message: string; eventId?: string }) =>
    api.post(`/organizations/${orgId}/bots/${botId}/marketing/broadcasts`, data),
  listBroadcasts: (orgId: string, botId: string) => api.get(`/organizations/${orgId}/bots/${botId}/marketing/broadcasts`),
};

export const communitiesApi = {
  get: (orgId: string) => api.get(`/organizations/${orgId}/communities`),
  create: (orgId: string, data: { botId: string; telegramChatId: string; telegramChatUsername?: string; name: string }) =>
    api.post(`/organizations/${orgId}/communities`, data),
  update: (orgId: string, communityId: string, data: { name?: string; telegramChatUsername?: string; isActive?: boolean }) =>
    api.patch(`/organizations/${orgId}/communities/${communityId}`, data),
  remove: (orgId: string, communityId: string) => api.delete(`/organizations/${orgId}/communities/${communityId}`),
};

// ── Billing — wallet, credit packs, comms credit estimate ──────────────────────
export const billingApi = {
  wallet: (orgId: string, config?: AxiosRequestConfig) =>
    api.get(`/organizations/${orgId}/billing/wallet`, config),
  checkoutPack: (orgId: string, market: 'NG' | 'US', packId: string, callbackUrl?: string) =>
    api.post(`/organizations/${orgId}/billing/checkout/pack`, { market, packId, callbackUrl }),
  verifyCheckout: (orgId: string, reference: string) =>
    api.post(`/organizations/${orgId}/billing/checkout/verify`, { reference }),
  commsEstimate: (orgId: string, recipientCount: number) =>
    api.get(`/organizations/${orgId}/billing/comms-estimate`, { params: { recipientCount } }),
  ledger: (orgId: string, limit: number, offset: number) =>
    api.get(`/organizations/${orgId}/billing/ledger`, { params: { limit, offset } }),
};

export const pricingApi = {
  catalog: (orgId: string, market: 'NG' | 'US', config?: AxiosRequestConfig) =>
    api.get(`/organizations/${orgId}/pricing/catalog`, { params: { market }, ...config }),
};

// ── Customers (the same unified Customer Hub Zuti uses — anyone who's registered/bought/messaged) ──
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
