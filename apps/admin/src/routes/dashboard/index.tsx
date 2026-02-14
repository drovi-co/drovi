import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/overview-page"),
    "AdminOverviewPage"
  ),
});
