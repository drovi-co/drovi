import { requireGuest } from "@memorystack/mod-auth";
import {
  createFileRoute,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { useAuthStore } from "@/lib/auth";
import { getWebPostLoginRedirect } from "@/modules/runtime";

export const Route = createFileRoute("/login")({
  component: lazyRouteComponent(
    () => import("@/modules/auth/pages/login-page"),
    "LoginPage"
  ),
  beforeLoad: async () => {
    const store = useAuthStore.getState();
    if (!store.user) {
      await store.checkAuth();
    }
    const state = useAuthStore.getState();
    const decision = requireGuest(
      {
        isAuthenticated: Boolean(state.user),
        isLoading: state.isLoading,
      },
      getWebPostLoginRedirect()
    );

    if (!(decision.allow || !decision.redirectTo)) {
      throw redirect({ to: decision.redirectTo as "/dashboard" });
    }
  },
});
