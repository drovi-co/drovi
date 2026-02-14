import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/team/members")({
  component: lazyRouteComponent(
    () => import("@/modules/teams/pages/team-members-page"),
    "MembersPage"
  ),
});
