import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
});

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
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
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
};

// ── Organizations ─────────────────────────────────────────────────────────────
export const orgsApi = {
  list: () => api.get('/organizations'),
  get: (slug: string) => api.get(`/organizations/${slug}`),
  create: (name: string, slug: string) => api.post('/organizations', { name, slug }),
  removeMember: (orgId: string, userId: string) =>
    api.delete(`/organizations/${orgId}/members/${userId}`),
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
};

// ── Bots ──────────────────────────────────────────────────────────────────────
export const botsApi = {
  list: (orgId: string) => api.get(`/organizations/${orgId}/bots`),
  get: (orgId: string, botId: string) =>
    api.get(`/organizations/${orgId}/bots/${botId}`),
  create: (orgId: string, name: string, telegramToken: string) =>
    api.post(`/organizations/${orgId}/bots`, { name, telegramToken }),
  update: (orgId: string, botId: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${orgId}/bots/${botId}`, data),
  delete: (orgId: string, botId: string) =>
    api.delete(`/organizations/${orgId}/bots/${botId}`),
  setWebhook: (orgId: string, botId: string) =>
    api.post(`/organizations/${orgId}/bots/${botId}/webhook`),
};

// ── Conversations ─────────────────────────────────────────────────────────────
export const conversationsApi = {
  list: (orgId: string, params?: Record<string, string>) =>
    api.get(`/organizations/${orgId}/conversations`, { params }),
  get: (orgId: string, convId: string) =>
    api.get(`/organizations/${orgId}/conversations/${convId}`),
  update: (orgId: string, convId: string, data: Record<string, unknown>) =>
    api.patch(`/organizations/${orgId}/conversations/${convId}`, data),
  sendMessage: (orgId: string, convId: string, content: string) =>
    api.post(`/organizations/${orgId}/conversations/${convId}/messages`, { content }),
};
