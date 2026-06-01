import axios from 'axios';
import {
  clearAuthTokens,
  getAccessToken,
  getActiveOrgId,
  setActiveOrgId,
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
    data: {
      productId: string;
      sku: string;
      title?: string;
      imageUrl?: string;
      priceMinor: number;
      currency: 'NGN' | 'USD';
      attributes?: Record<string, unknown>;
    },
  ) => api.post(`/organizations/${orgId}/commerce/variants`, data),
  updateVariant: (
    orgId: string,
    variantId: string,
    data: {
      sku?: string;
      title?: string;
      imageUrl?: string;
      priceMinor?: number;
      currency?: 'NGN' | 'USD';
      attributes?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    },
  ) => api.patch(`/organizations/${orgId}/commerce/variants/${variantId}`, data),
  upsertInventory: (
    orgId: string,
    data: {
      variantId: string;
      locationId: string;
      onHand?: number;
      reserved?: number;
      reorderPoint?: number;
      metadata?: Record<string, unknown>;
    },
  ) => api.post(`/organizations/${orgId}/commerce/inventory/upsert`, data),
  createOrder: (
    orgId: string,
    data: {
      storeId: string;
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      deliveryAddress?: string;
      notes?: string;
      items: Array<{ variantId: string; locationId?: string; quantity: number }>;
    },
  ) => api.post(`/organizations/${orgId}/commerce/orders`, data),
  getOrder: (orgId: string, orderId: string) => api.get(`/organizations/${orgId}/commerce/orders/${orderId}`),
  listOrders: (orgId: string, limit = 50) =>
    api.get(`/organizations/${orgId}/commerce/orders`, { params: { limit } }),
  initializePayment: (orgId: string, orderId: string, data?: { customerEmail?: string }) =>
    api.post(`/organizations/${orgId}/commerce/orders/${orderId}/payment/initialize`, data ?? {}),
  verifyPayment: (orgId: string, orderId: string, data?: { reference?: string }) =>
    api.post(`/organizations/${orgId}/commerce/orders/${orderId}/payment/verify`, data ?? {}),
  uploadImage: (orgId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ url: string }>(`/organizations/${orgId}/commerce/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export const notificationsApi = {
  list: (orgId: string, includeRead = false) =>
    api.get(`/organizations/${orgId}/notifications`, {
      params: includeRead ? { includeRead: 'true' } : undefined,
    }),
  markRead: (orgId: string, notifId: string) =>
    api.post(`/organizations/${orgId}/notifications/${notifId}/read`),
  markAllRead: (orgId: string) =>
    api.post(`/organizations/${orgId}/notifications/read-all`),
};

export const authApiExtra = {
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

export function resolveOrgId(orgs: OrgSummary[]): string | null {
  const cached = getActiveOrgId();
  const resolved = cached && orgs.some((org) => org.id === cached) ? cached : orgs[0]?.id ?? null;
  if (resolved) {
    setActiveOrgId(resolved);
  }
  return resolved;
}
