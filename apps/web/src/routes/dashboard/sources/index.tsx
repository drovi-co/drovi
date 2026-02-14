import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/sources/")({
  component: lazyRouteComponent(
    () => import("@/modules/sources/pages/sources-page"),
    "SourcesPage"
  ),
});
