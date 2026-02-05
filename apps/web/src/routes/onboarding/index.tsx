import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { orgAPI } from "@/lib/api";
import {
  getStoredOnboardingState,
  inferOnboardingComplete,
  setStoredOnboardingState,
} from "@/lib/onboarding-state";

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingIndex,
});

function OnboardingIndex() {
  const { data: session, isPending } = authClient.useSession();
  const { data: orgs } = authClient.useListOrganizations();
  const { data: orgInfo } = useQuery({
    queryKey: ["org-info"],
    queryFn: () => orgAPI.getOrgInfo(),
    enabled: !!session,
  });

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // If not authenticated, redirect to login
  if (!session) {
    return <Navigate to="/" />;
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

  // If user has organizations and onboarding is not pending, redirect to dashboard
  if (orgs && orgs.length > 0 && !shouldRunOnboarding) {
    return <Navigate to="/dashboard" />;
  }

  // Otherwise, start onboarding
  return <Navigate to="/onboarding/create-org" />;
}
