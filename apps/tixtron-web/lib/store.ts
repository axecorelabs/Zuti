import { create } from 'zustand';
import { authApi } from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'MANAGER';
  canCreateWorkspace: boolean;
  managerProfileStatus?: 'PENDING' | 'VERIFIED' | 'ARCHIVED' | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  activeOrgId: string | null;
  /** Maps orgId → MemberRole ('OWNER' | 'ADMIN' | 'AGENT') */
  orgRoles: Record<string, string>;
  setAuth: (user: User, accessToken: string) => void;
  clearAuth: () => void;
  loadFromStorage: () => void;
  setActiveOrgId: (orgId: string | null) => void;
  setOrgRoles: (roles: Record<string, string>) => void;
  getRoleForOrg: (orgId: string) => string | undefined;
}

const ACTIVE_ORG_STORAGE_KEY = 'activeOrgId';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  isLoading: true,
  activeOrgId: null,
  orgRoles: {},

  setAuth: (user, accessToken) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', accessToken);
    }
    set({ user, accessToken, isLoading: false });
  },

  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    }
    set({ user: null, accessToken: null, isLoading: false, activeOrgId: null, orgRoles: {} });
  },

  loadFromStorage: () => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('accessToken');
      const activeOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
      if (!token) {
        set({ isLoading: false, activeOrgId: activeOrgId ?? null });
        return;
      }
      // Decode JWT payload (not verification — just extract user info)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          localStorage.removeItem('accessToken');
          set({ isLoading: false, activeOrgId: activeOrgId ?? null });
          return;
        }
        set({
          accessToken: token,
          user: {
            id: payload.sub,
            name: payload.name ?? '',
            email: payload.email ?? '',
            role: payload.role === 'MANAGER' ? 'MANAGER' : 'USER',
            canCreateWorkspace: payload.canCreateWorkspace !== false,
            managerProfileStatus: payload.managerProfileStatus ?? null,
          },
          activeOrgId: activeOrgId ?? null,
          isLoading: false,
        });

        // Refresh role/profile from the server in case JWT payload is stale.
        authApi.me()
          .then((res) => {
            const serverUser = res.data?.user as {
              id: string;
              name?: string;
              email?: string;
              role?: 'USER' | 'MANAGER';
              canCreateWorkspace?: boolean;
              managerProfileStatus?: 'PENDING' | 'VERIFIED' | 'ARCHIVED' | null;
            } | undefined;
            if (!serverUser?.id) return;
            set((state) => {
              if (!state.user) return state;
              return {
                ...state,
                user: {
                  id: serverUser.id,
                  name: serverUser.name ?? state.user.name,
                  email: serverUser.email ?? state.user.email,
                  role: serverUser.role === 'MANAGER' ? 'MANAGER' : 'USER',
                  canCreateWorkspace: serverUser.canCreateWorkspace !== false,
                  managerProfileStatus: serverUser.managerProfileStatus ?? null,
                },
              };
            });
          })
          .catch(() => {
            // Keep token-derived payload as fallback when profile fetch fails.
          });
      } catch {
        set({ isLoading: false, activeOrgId: activeOrgId ?? null });
      }
    } else {
      set({ isLoading: false });
    }
  },

  setActiveOrgId: (orgId) => {
    if (typeof window !== 'undefined') {
      if (orgId) {
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
      } else {
        localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
      }
    }
    set({ activeOrgId: orgId });
  },

  setOrgRoles: (roles) => set({ orgRoles: roles }),
  getRoleForOrg: (orgId) => get().orgRoles[orgId],
}));
