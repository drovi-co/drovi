import { createFileRoute, redirect } from "@tanstack/react-router";

import { useAuthStore } from "@/lib/auth";
import { orgAPI } from "@/lib/api";
import {
  getStoredOnboardingState,
  inferOnboardingComplete,
  setStoredOnboardingState,
} from "@/lib/onboarding-state";

export const Route = createFileRoute("/")({
  component: () => null,
  beforeLoad: async () => {
    // Landing page lives on drovi.co (separate app)
    // App lives on app.drovi.co - always redirect to dashboard or login
    const store = useAuthStore.getState();
    if (!store.user) {
      await store.checkAuth();
    }

    const user = useAuthStore.getState().user;
    if (user) {
      const stored = getStoredOnboardingState();
      if (stored === "pending") {
        throw redirect({ to: "/onboarding/create-org" });
      }

      if (stored === null) {
        try {
          const orgInfo = await orgAPI.getOrgInfo();
          const inferredComplete = inferOnboardingComplete(orgInfo);
          setStoredOnboardingState(inferredComplete ? "complete" : "pending");
          if (!inferredComplete) {
            throw redirect({ to: "/onboarding/create-org" });
          }
        } catch {
          // If we cannot verify onboarding state, default to onboarding.
          setStoredOnboardingState("pending");
          throw redirect({ to: "/onboarding/create-org" });
        }
      }

      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/login" });
  },
});
