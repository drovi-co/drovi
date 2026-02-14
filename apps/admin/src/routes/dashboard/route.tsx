import { requireAuthenticated } from "@memorystack/mod-auth";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { useAdminAuthStore } from "@/lib/auth";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async () => {
    const store = useAdminAuthStore.getState();
    // Always re-check on entering the admin shell. This prevents stale state
    // (for example, when a pilot session cookie previously tricked /admin/me)
    // from keeping the operator UI mounted.
    await store.checkAuth();
    const state = useAdminAuthStore.getState();
    const decision = requireAuthenticated({
      isAuthenticated: Boolean(state.me),
      isLoading: state.isLoading,
    });
    if (!(decision.allow || !decision.redirectTo)) {
      throw redirect({ to: decision.redirectTo as "/login" });
    }
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
