import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/console")({
  component: lazyRouteComponent(
    () => import("@/modules/console/pages/console-page"),
    "ConsolePage"
  ),
});
