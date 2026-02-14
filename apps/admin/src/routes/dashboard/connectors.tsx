import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/connectors")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/connectors-page"),
    "AdminConnectorsPage"
  ),
});
