import { create } from 'zustand';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  /** Maps orgId → MemberRole ('OWNER' | 'ADMIN' | 'AGENT') */
  orgRoles: Record<string, string>;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  loadFromStorage: () => void;
  setOrgRoles: (roles: Record<string, string>) => void;
  getRoleForOrg: (orgId: string) => string | undefined;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isLoading: true,
  orgRoles: {},

  setAuth: (user, accessToken, refreshToken) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
    }
    set({ user, accessToken, isLoading: false });
  },

  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
    set({ user: null, accessToken: null, isLoading: false, orgRoles: {} });
  },

  loadFromStorage: () => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        set({ isLoading: false });
        return;
      }
      // Decode JWT payload (not verification — just extract user info)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          set({ isLoading: false });
          return;
        }
        set({
          accessToken: token,
          user: { id: payload.sub, name: payload.name ?? '', email: payload.email ?? '' },
          isLoading: false,
        });
      } catch {
        set({ isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  },

  setOrgRoles: (roles) => set({ orgRoles: roles }),
  getRoleForOrg: (orgId) => get().orgRoles[orgId],
}));
