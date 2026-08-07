export const ACCESS_TOKEN_KEY = 'accessToken';
export const REFRESH_TOKEN_KEY = 'refreshToken';
export const ACTIVE_ORG_ID_KEY = 'activeOrgId';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

// The refresh token itself now lives in an httpOnly cookie (see apps/api auth.controller.ts) —
// only the short-lived access token is ever JS-readable.
export function setAuthTokens(accessToken: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
}

export function clearAuthTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  // Also clears any pre-migration refreshToken value left over in existing users' browsers.
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getActiveOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_ORG_ID_KEY);
}

export function setActiveOrgId(orgId: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACTIVE_ORG_ID_KEY, orgId);
}
