import { requireAuthenticated } from "@memorystack/mod-auth";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { useAuthStore } from "@/lib/auth";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingShell,
  beforeLoad: async () => {
    const store = useAuthStore.getState();
    if (!store.user) {
      await store.checkAuth();
    }

    const state = useAuthStore.getState();
    const decision = requireAuthenticated({
      isAuthenticated: Boolean(state.user),
      isLoading: state.isLoading,
    });
    if (!(decision.allow || !decision.redirectTo)) {
      throw redirect({ to: decision.redirectTo as "/login" });
    }

    return { user: state.user };
  },
});

function OnboardingShell() {
  return <Outlet />;
}
