import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/orgs/")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/orgs-page"),
    "AdminOrgsPage"
  ),
});
