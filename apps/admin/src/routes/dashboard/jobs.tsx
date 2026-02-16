import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/jobs")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/jobs-page"),
    "AdminJobsPage"
  ),
});
