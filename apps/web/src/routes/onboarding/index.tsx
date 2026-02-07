import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { orgAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import {
  getStoredOnboardingState,
  inferOnboardingComplete,
  setStoredOnboardingState,
} from "@/lib/onboarding-state";

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingIndex,
});

function OnboardingIndex() {
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

  // Otherwise, start onboarding
  return <Navigate to="/onboarding/create-org" />;
}
