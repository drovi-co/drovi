import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
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
    const session = await authClient.getSession();
    if (session.data?.user) {
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
          // If we cannot verify onboarding state, default to the main app.
        }
      }

      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/login" });
  },
});
