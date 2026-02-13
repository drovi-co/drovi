import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/team/invitations")({
  component: lazyRouteComponent(
    () => import("@/modules/teams/pages/team-invitations-page"),
    "InvitationsPage"
  ),
});
