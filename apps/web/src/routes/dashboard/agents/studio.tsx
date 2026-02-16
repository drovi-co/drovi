import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/agents/studio")({
  component: lazyRouteComponent(
    () => import("@/modules/agents/pages/agents-studio-page"),
    "AgentsStudioPage"
  ),
});
