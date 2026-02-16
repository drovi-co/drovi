import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/agents/inbox")({
  component: lazyRouteComponent(
    () => import("@/modules/agents/pages/agents-inbox-page"),
    "AgentsInboxPage"
  ),
});
