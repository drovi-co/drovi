import { createFileRoute } from "@tanstack/react-router";

import { AgentsMigrationPage } from "@/modules/agents/pages/agents-migration-page";

export const Route = createFileRoute("/dashboard/exchange")({
  component: ExchangeMigrationRoute,
});

function ExchangeMigrationRoute() {
  return <AgentsMigrationPage surface="exchange" />;
}
