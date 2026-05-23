import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

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
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
  verifyEmail: (token: string) =>
    api.post('/auth/verify-email', { token }),
  resendVerification: (email: string) =>
    api.post('/auth/resend-verification', { email }),
};

// ── Organizations ─────────────────────────────────────────────────────────────
export const orgsApi = {
  list: () => api.get('/organizations'),
  get: (slug: string) => api.get(`/organizations/${slug}`),
  create: (name: string, slug: string) => api.post('/organizations', { name, slug }),
  removeMember: (orgId: string, userId: string) =>
    api.delete(`/organizations/${orgId}/members/${userId}`),
  listMembers: (orgId: string) => api.get(`/organizations/${orgId}/members`),
  updateMemberRole: (orgId: string, userId: string, role: string) =>
    api.patch(`/organizations/${orgId}/members/${userId}/role`, { role }),
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
      channel: 'TELEGRAM' | 'EMAIL';
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
      channel?: 'TELEGRAM' | 'EMAIL';
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
      primaryChannel: 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL';
      telegramToken?: string;
      template?: 'GENERAL' | 'SALES' | 'SUPPORT' | 'BOOKING' | 'TECHNICAL';
      skills?: Array<'SALES' | 'BOOKING' | 'SUPPORT' | 'TECHNICAL' | 'FORWARDING'>;
      actionForwardingEnabled?: boolean;
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
};

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversationsApi = {
  list: (orgId: string, params?: Record<string, string | undefined>) =>
    api.get(`/organizations/${orgId}/conversations`, { params }),
  get: (orgId: string, convId: string) =>
    api.get(`/organizations/${orgId}/conversations/${convId}`),
  update: (orgId: string, convId: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${orgId}/conversations/${convId}`, data),
  sendMessage: (orgId: string, convId: string, content: string) =>
    api.post(`/organizations/${orgId}/conversations/${convId}/messages`, { content }),
  addNote: (orgId: string, convId: string, content: string) =>
    api.post(`/organizations/${orgId}/conversations/${convId}/notes`, { content }),
  analytics: (orgId: string, days = 30, botId?: string) =>
    api.get(`/organizations/${orgId}/conversations/analytics/summary`, { params: { days: String(days), ...(botId ? { botId } : {}) } }),
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
  summary: (orgId: string, days = 30) =>
    api.get(`/organizations/${orgId}/ai-usage/summary`, { params: { days: String(days) } }),
};

// ── Pricing ─────────────────────────────────────────────────────────────────
export const pricingApi = {
  catalog: (orgId: string, market: 'NG' | 'US') =>
    api.get(`/organizations/${orgId}/pricing/catalog`, { params: { market } }),
  estimates: (orgId: string, market: 'NG' | 'US') =>
    api.get(`/organizations/${orgId}/pricing/estimates`, { params: { market } }),
  quote: (orgId: string, market: 'NG' | 'US', packId: string) =>
    api.post(`/organizations/${orgId}/pricing/quote`, { market, packId }),
};

// ── Billing ─────────────────────────────────────────────────────────────────
export const billingApi = {
  wallet: (orgId: string) =>
    api.get(`/organizations/${orgId}/billing/wallet`),
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
  list: (orgId: string) => api.get(`/organizations/${orgId}/notifications`),
  markRead: (orgId: string, notifId: string) =>
    api.post(`/organizations/${orgId}/notifications/${notifId}/read`),
  markAllRead: (orgId: string) =>
    api.post(`/organizations/${orgId}/notifications/read-all`),
};

// ── Activity ──────────────────────────────────────────────────────────────────
export const activityApi = {
  list: (orgId: string) => api.get(`/organizations/${orgId}/activity`),
};
