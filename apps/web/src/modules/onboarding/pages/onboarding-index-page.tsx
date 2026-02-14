import { canRunOnboardingStep } from "@memorystack/mod-onboarding";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { orgAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import {
  getStoredOnboardingState,
  inferOnboardingComplete,
  setStoredOnboardingState,
} from "@/lib/onboarding-state";
import { getWebCapabilities, getWebOnboardingSteps } from "@/modules/runtime";

export function OnboardingIndexPage() {
  const { user, isLoading: authLoading } = useAuthStore();
  const { data: orgInfo } = useQuery({
    queryKey: ["org-info"],
    queryFn: () => orgAPI.getOrgInfo(),
    enabled: !!user,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // If not authenticated, redirect to login
  if (!user) {
    return <Navigate to="/login" />;
  }

  const stored = getStoredOnboardingState();
  const inferredComplete = inferOnboardingComplete(orgInfo);
  let effectiveState = stored;

  if (orgInfo) {
    if (stored === "complete" && !inferredComplete) {
      effectiveState = "pending";
      setStoredOnboardingState("pending");
    } else if (stored === null) {
      effectiveState = inferredComplete ? "complete" : "pending";
      setStoredOnboardingState(effectiveState);
    }
  }

  const shouldRunOnboarding = effectiveState !== "complete";

  if (!shouldRunOnboarding) {
    return <Navigate to="/dashboard" />;
  }

  const availableSteps = getWebOnboardingSteps().filter((step) =>
    canRunOnboardingStep(step, getWebCapabilities())
  );
  const firstActionableStep = availableSteps.find(
    (step) => step.id !== "complete"
  );

  // Otherwise, start onboarding from the first available runtime step.
  return (
    <Navigate
      to={
        (firstActionableStep?.route ?? "/onboarding/complete") as
          | "/onboarding/complete"
          | "/onboarding/connect-sources"
          | "/onboarding/create-org"
          | "/onboarding/invite-team"
      }
    />
  );
}
