import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useAuthStore, useIsAuthenticated, useCurrentUser, useCurrentOrg } from "../../store/authStore";
import type { User, Organization } from "../../api/schemas";

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  organization: Organization | null;
  login: (provider?: string) => Promise<{ authUrl: string; state: string }>;
  logout: () => Promise<void>;
  checkSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const isAuthenticated = useIsAuthenticated();
  const user = useCurrentUser();
  const organization = useCurrentOrg();
  const { login, logout, checkSession, isLoading } = useAuthStore();

  // Check session on mount
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Listen for OAuth callback via URL params or deep links
  useEffect(() => {
    const handleOAuthCallback = () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      const error = params.get("error");

      if (token) {
        // Handle successful OAuth callback
        useAuthStore.getState().handleCallback(token);
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
      } else if (error) {
        // Handle OAuth error
        useAuthStore.getState().setError(error);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    };

    handleOAuthCallback();
  }, []);

  const value: AuthContextValue = {
    isAuthenticated,
    isLoading,
    user,
    organization,
    login,
    logout,
    checkSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
