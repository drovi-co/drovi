import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/tickets/$ticketId")({
  component: lazyRouteComponent(
    () => import("@/modules/adminops/pages/ticket-detail-page"),
    "AdminTicketDetailPage"
  ),
});
