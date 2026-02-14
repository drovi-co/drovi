import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/orgs/$orgId")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/org-detail-page"),
    "AdminOrgDetailPage"
  ),
});
