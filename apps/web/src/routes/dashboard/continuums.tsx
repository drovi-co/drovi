import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/continuums")({
  component: lazyRouteComponent(
    () => import("@/modules/continuums/pages/continuums-page"),
    "ContinuumsPage"
  ),
});
