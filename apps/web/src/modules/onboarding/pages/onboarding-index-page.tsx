import {
  resolveOnboardingState,
  useOnboardingRoute,
} from "@memorystack/mod-onboarding";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { orgAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import {
  getStoredOnboardingState,
  inferOnboardingComplete,
  setStoredOnboardingState,
} from "@/lib/onboarding-state";
import { useWebRuntime } from "@/modules/runtime-provider";

export function OnboardingIndexPage() {
  const { user, isLoading: authLoading } = useAuthStore();
  const { onboardingSteps, capabilities } = useWebRuntime();
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
  const onboardingState = resolveOnboardingState({
    storedState: stored,
    inferredComplete,
  });

  if (orgInfo && onboardingState.shouldPersist) {
    setStoredOnboardingState(onboardingState.state);
  }

  const shouldRunOnboarding = onboardingState.state !== "complete";

  if (!shouldRunOnboarding) {
    return <Navigate to="/dashboard" />;
  }

  const nextRoute = useOnboardingRoute({
    steps: onboardingSteps,
    capabilities,
    completeRoute: "/onboarding/complete",
  });

  // Otherwise, start onboarding from the first available runtime step.
  return (
    <Navigate
      to={
        nextRoute as
          | "/onboarding/complete"
          | "/onboarding/connect-sources"
          | "/onboarding/create-org"
          | "/onboarding/invite-team"
      }
    />
  );
}
