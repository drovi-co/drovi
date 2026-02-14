import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/governance")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/governance-page"),
    "AdminGovernancePage"
  ),
});
