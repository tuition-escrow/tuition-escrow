/**
 * Auth context — manages JWT from the API.
 *
 * README section: "Tech stack" — "Auth integrated with the API."
 *
 * Stores the JWT in memory only (not localStorage) to reduce XSS risk.
 * A refresh endpoint is used to maintain sessions.
 */

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

export interface AuthUser {
  id: string;
  role: 'funder' | 'school_admin' | 'attester' | 'platform_admin';
  schoolId?: string;
  stellarAddress?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login(token: string, user: AuthUser): void;
  logout(): void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const login = useCallback((t: string, u: AuthUser) => {
    setToken(t);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}
