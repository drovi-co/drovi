import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/agents/workforces")({
  component: lazyRouteComponent(
    () => import("@/modules/agents/pages/agents-workforces-page"),
    "AgentsWorkforcesPage"
  ),
});
