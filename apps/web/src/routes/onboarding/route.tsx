import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { useAuthStore } from "@/lib/auth";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingShell,
  beforeLoad: async () => {
    const store = useAuthStore.getState();
    if (!store.user) {
      await store.checkAuth();
    }

    const user = useAuthStore.getState().user;
    if (!user) {
      throw redirect({ to: "/login" });
    }

    return { user };
  },
});

function OnboardingShell() {
  return <Outlet />;
}
