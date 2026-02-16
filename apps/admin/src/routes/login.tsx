import { requireGuest } from "@memorystack/mod-auth";
import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { useAdminAuthStore } from "@/lib/auth";
import { getAdminPostLoginRedirect } from "@/modules/runtime";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const store = useAdminAuthStore.getState();
    // Always check; do not trust in-memory state across hot reloads.
    await store.checkAuth();
    const state = useAdminAuthStore.getState();
    const decision = requireGuest(
      {
        isAuthenticated: Boolean(state.me),
        isLoading: state.isLoading,
      },
      getAdminPostLoginRedirect()
    );
    if (!(decision.allow || !decision.redirectTo)) {
      throw redirect({ to: decision.redirectTo as "/dashboard" });
    }
  },
  component: lazyRouteComponent(
    () => import("@/modules/auth/pages/admin-login-page"),
    "AdminLoginPage"
  ),
});
