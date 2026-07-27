'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from './store';

/**
 * ONE websocket connection per tab, shared across every dashboard feature. Mounted at the dashboard
 * layout so any page reuses the same connection (was: inbox, events, and messages each opened their
 * own). The provider owns connect/auth/reconnect and joins the active org room; features subscribe
 * to individual events via useSocketEvent — no feature opens its own socket.
 */
const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { activeOrgId, accessToken } = useAuthStore();
  const [socket, setSocket] = useState<Socket | null>(null);
  const orgRef = useRef<string | null>(activeOrgId);
  orgRef.current = activeOrgId;

  // One connection, keyed on the auth token. Re-created only on login/logout.
  useEffect(() => {
    const token = accessToken ?? (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null);
    if (!token) { setSocket(null); return; }
    const rawUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const apiUrl = /^https?:\/\/.+/.test(rawUrl) ? rawUrl : 'http://localhost:3001';
    const socketUrl = apiUrl.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
    const s = io(socketUrl, { path: '/ws', transports: ['websocket'], auth: { token } });
    // Re-join on every (re)connect so a dropped connection restores its room automatically.
    s.on('connect', () => { if (orgRef.current) s.emit('join', orgRef.current); });
    setSocket(s);
    return () => { s.disconnect(); setSocket(null); };
  }, [accessToken]);

  // Join / re-join the active org room when it changes (org switch).
  useEffect(() => {
    if (socket?.connected && activeOrgId) socket.emit('join', activeOrgId);
  }, [socket, activeOrgId]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}

/**
 * Subscribe to a server event on the shared socket. The handler is kept in a ref so it always sees
 * the latest state/props without re-subscribing on every render; the listener is added once per
 * (socket, event) and cleaned up on unmount.
 */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const socket = useSocket();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const h = (payload: T) => ref.current(payload);
    socket.on(event, h as (...args: unknown[]) => void);
    return () => { socket.off(event, h as (...args: unknown[]) => void); };
  }, [socket, event]);
}
