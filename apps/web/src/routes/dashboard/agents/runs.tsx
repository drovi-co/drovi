import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/agents/runs")({
  component: lazyRouteComponent(
    () => import("@/modules/agents/pages/agents-runs-page"),
    "AgentsRunsPage"
  ),
});
