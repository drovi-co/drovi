import { createFileRoute } from "@tanstack/react-router";

import { AgentsMigrationPage } from "@/modules/agents/pages/agents-migration-page";

export const Route = createFileRoute("/dashboard/builder")({
  component: BuilderMigrationRoute,
});

function BuilderMigrationRoute() {
  return <AgentsMigrationPage surface="builder" />;
}
