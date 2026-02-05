import { createFileRoute, Navigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/onboarding/")({
  component: OnboardingIndex,
});

function OnboardingIndex() {
  const { data: session, isPending } = authClient.useSession();
  const { data: orgs } = authClient.useListOrganizations();

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

  const shouldRunOnboarding =
    typeof window !== "undefined" &&
    window.localStorage.getItem("drovi:onboarding") === "pending";

  // If user has organizations and onboarding is not pending, redirect to dashboard
  if (orgs && orgs.length > 0 && !shouldRunOnboarding) {
    return <Navigate to="/dashboard" />;
  }

  // Otherwise, start onboarding
  return <Navigate to="/onboarding/create-org" />;
}
