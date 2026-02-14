import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/exchange")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/exchange-page"),
    "AdminExchangePage"
  ),
});
