import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/tickets/")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/tickets-page"),
    "AdminTicketsPage"
  ),
});
