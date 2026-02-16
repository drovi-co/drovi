import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/users/$userId")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/user-detail-page"),
    "AdminUserDetailPage"
  ),
});
