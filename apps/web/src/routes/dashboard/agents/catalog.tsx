import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/agents/catalog")({
  component: lazyRouteComponent(
    () => import("@/modules/agents/pages/agents-catalog-page"),
    "AgentsCatalogPage"
  ),
});
