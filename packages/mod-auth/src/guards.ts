export interface AuthGuardState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface GuardDecision {
  allow: boolean;
  redirectTo: string | null;
}

export function requireAuthenticated(
  state: AuthGuardState,
  redirectTo = "/login"
): GuardDecision {
  if (state.isLoading) {
    return { allow: false, redirectTo: null };
  }
  if (!state.isAuthenticated) {
    return { allow: false, redirectTo };
  }
  return { allow: true, redirectTo: null };
}

export function requireGuest(
  state: AuthGuardState,
  redirectTo = "/dashboard"
): GuardDecision {
  if (state.isLoading) {
    return { allow: false, redirectTo: null };
  }
  if (state.isAuthenticated) {
    return { allow: false, redirectTo };
  }
  return { allow: true, redirectTo: null };
}
