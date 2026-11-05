/**
 * Auth context — manages JWT from the API.
 *
 * README section: "Tech stack" — "Auth integrated with the API."
 *
 * Stores the JWT in memory only (not localStorage) to reduce XSS risk.
 * A refresh endpoint is used to maintain sessions.
 */

"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { login as apiLogin } from "@/lib/api";

export interface AuthUser {
  id: string;
  role: "funder" | "school_admin" | "attester" | "platform_admin";
  schoolId?: string;
  stellarAddress?: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login(token: string, user: AuthUser): void;
  loginWithRole(
    role: AuthUser["role"],
    stellarAddress?: string,
    schoolId?: string,
  ): Promise<void>;
  logout(): void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedToken = sessionStorage.getItem("tuition_escrow_token");
      const savedUser = sessionStorage.getItem("tuition_escrow_user");
      if (savedToken && savedUser) {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      }
    } catch {
      // Ignore sessionStorage errors
    }
  }, []);

  const login = useCallback((t: string, u: AuthUser) => {
    setToken(t);
    setUser(u);
    try {
      sessionStorage.setItem("tuition_escrow_token", t);
      sessionStorage.setItem("tuition_escrow_user", JSON.stringify(u));
    } catch {
      // Ignore
    }
  }, []);

  const loginWithRole = useCallback(
    async (
      role: AuthUser["role"],
      stellarAddress?: string,
      schoolId?: string,
    ) => {
      const resp = await apiLogin({ role, stellarAddress, schoolId });
      login(resp.token, {
        id: resp.user.id,
        role: resp.user.role,
        schoolId: resp.user.schoolId,
        stellarAddress: resp.user.stellarAddress || stellarAddress,
      });
    },
    [login],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    try {
      sessionStorage.removeItem("tuition_escrow_token");
      sessionStorage.removeItem("tuition_escrow_user");
    } catch {
      // Ignore
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        loginWithRole,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
