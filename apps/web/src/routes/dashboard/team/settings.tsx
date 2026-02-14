import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/team/settings")({
  component: lazyRouteComponent(
    () => import("@/modules/teams/pages/team-settings-page"),
    "TeamSettingsPage"
  ),
});
