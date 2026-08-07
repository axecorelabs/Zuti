import axios from 'axios';
import {
  clearAuthTokens,
  getAccessToken,
  setAuthTokens,
} from '@/lib/session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  // Sends/receives the httpOnly refresh-token cookie — required since the API is a different
  // origin (domain, in admin's case) than this app.
  withCredentials: true,
});

let refreshPromise: Promise<string | null> | null = null;

// The refresh token itself is never seen by JS anymore — it lives in an httpOnly cookie the
// browser attaches automatically (withCredentials above). This just asks the server to use it.
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = api
    .post('/auth/refresh')
    .then((res) => {
      const accessToken = String(res.data?.accessToken ?? '');
      if (!accessToken) return null;
      setAuthTokens(accessToken);
      return accessToken;
    })
    .catch(() => null)
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const original = error?.config ?? {};
    const isAuthEndpoint = String(original?.url ?? '').includes('/auth/');

    if (status === 401 && !isAuthEndpoint && !original._retry) {
      original._retry = true;
      const nextAccess = await refreshAccessToken();
      if (nextAccess) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${nextAccess}`;
        return api.request(original);
      }

      clearAuthTokens();
      // Best-effort: clear the now-invalid refresh-token cookie server-side too.
      api.post('/auth/logout').catch(() => {});
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);

export type OrgSummary = { id: string; name: string; slug: string; role: string };

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
};

export const orgApi = {
  listSummary: () => api.get<OrgSummary[]>('/organizations/summary'),
};

export const adminApi = {
  getOverview: () => api.get('/admin/overview'),
  listUsers: (params?: { limit?: number; role?: 'OWNER' | 'ADMIN' | 'AGENT' }) =>
    api.get('/admin/users', { params }),
  getUser: (userId: string) => api.get(`/admin/users/${userId}`),
  updateUserRole: (
    userId: string,
    payload: {
      role: 'USER' | 'MANAGER';
      canCreateWorkspace?: boolean;
      managerVerificationStatus?: 'PENDING' | 'VERIFIED' | 'ARCHIVED';
    },
  ) => api.patch(`/admin/users/${userId}/role`, payload),
  listWorkspaces: (params?: { limit?: number }) =>
    api.get('/admin/workspaces', { params }),
  listBots: (params?: {
    limit?: number;
    status?: 'ACTIVE' | 'INACTIVE';
    channel?: 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL' | 'WHATSAPP';
    q?: string;
  }) =>
    api.get('/admin/bots', { params }),
  getWorkspace: (workspaceId: string) => api.get(`/admin/workspaces/${workspaceId}`),
  getCashflow: (params?: { limit?: number }) =>
    api.get('/admin/cashflow', { params }),
  listActivity: (params?: { limit?: number; page?: number }) =>
    api.get('/admin/activity', { params }),
  getOperations: (params?: { limit?: number }) =>
    api.get('/admin/operations', { params }),
  getSystemHealth: (params?: { limit?: number }) =>
    api.get('/admin/system-health', { params }),
};

// Tixtron Ops — gated by TixtronOpsGuard (org membership in the internal Tixtron HQ org), not the
// SuperAdminGuard email allowlist above. Self-management panels reuse the exact same org-scoped
// endpoints any organizer uses (bots/communities/registrations), just against Tixtron HQ's own
// org id, resolved dynamically via getContext() rather than hardcoded.
export const tixtronOpsApi = {
  getContext: () => api.get<{ organizationId: string; organizationName: string }>('/admin/tixtron/context'),
  listBots: (orgId: string) => api.get(`/organizations/${orgId}/bots`),
  createBot: (orgId: string, data: { name: string; telegramToken: string; botType: 'COMMAND' }) =>
    api.post(`/organizations/${orgId}/bots`, data),
  setBotWebhook: (orgId: string, botId: string) => api.post(`/organizations/${orgId}/bots/${botId}/webhook`),
  removeBot: (orgId: string, botId: string) => api.delete(`/organizations/${orgId}/bots/${botId}`),
  getCommunity: (orgId: string) => api.get(`/organizations/${orgId}/communities`),
  createCommunity: (orgId: string, data: { botId: string; telegramChatId: string; telegramChatUsername?: string; name: string }) =>
    api.post(`/organizations/${orgId}/communities`, data),
  removeCommunity: (orgId: string, communityId: string) => api.delete(`/organizations/${orgId}/communities/${communityId}`),
  listEvents: (orgId: string) => api.get(`/organizations/${orgId}/registrations`),
  createEvent: (orgId: string, data: { name: string; isFree: boolean; requiresApproval: boolean; fields: unknown[]; eventDate?: string }) =>
    api.post(`/organizations/${orgId}/registrations`, data),
  // Marketplace-operator tools — cross-org, not scoped to Tixtron HQ's own org id.
  listOrganizers: () => api.get('/admin/tixtron/organizers'),
  listCurationEvents: (q?: string) => api.get('/admin/tixtron/events', { params: q ? { q } : undefined }),
  setEventFeatured: (productId: string, data: { isFeatured: boolean; featuredOrder?: number }) =>
    api.patch(`/admin/tixtron/events/${productId}/featured`, data),
  listEmailSubscribers: () => api.get('/admin/tixtron/subscribers'),
};
