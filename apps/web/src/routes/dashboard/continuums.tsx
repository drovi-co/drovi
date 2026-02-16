import { createFileRoute } from "@tanstack/react-router";

import { AgentsMigrationPage } from "@/modules/agents/pages/agents-migration-page";

export const Route = createFileRoute("/dashboard/continuums")({
  component: ContinuumsMigrationRoute,
});

function ContinuumsMigrationRoute() {
  return <AgentsMigrationPage surface="continuums" />;
}
