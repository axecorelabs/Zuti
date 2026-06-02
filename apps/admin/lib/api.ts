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
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;
  if (!refreshToken) return null;

  refreshPromise = api
    .post('/auth/refresh', { refreshToken })
    .then((res) => {
      const accessToken = String(res.data?.accessToken ?? '');
      const nextRefresh = String(res.data?.refreshToken ?? '');
      if (!accessToken || !nextRefresh) return null;
      setAuthTokens(accessToken, nextRefresh);
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
