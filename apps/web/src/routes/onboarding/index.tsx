import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/onboarding/")({
  component: lazyRouteComponent(
    () => import("@/modules/onboarding/pages/onboarding-index-page"),
    "OnboardingIndexPage"
  ),
});
