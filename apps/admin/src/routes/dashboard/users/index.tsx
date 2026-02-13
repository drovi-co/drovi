import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/users/")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/users-page"),
    "AdminUsersPage"
  ),
});
