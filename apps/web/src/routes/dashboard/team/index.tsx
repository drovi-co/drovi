import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/team/")({
  component: lazyRouteComponent(
    () => import("@/modules/teams/pages/team-page"),
    "TeamPage"
  ),
});
