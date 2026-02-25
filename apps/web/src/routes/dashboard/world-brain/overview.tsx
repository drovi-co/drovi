import { createFileRoute } from "@tanstack/react-router";
import { WorldBrainLandingPage } from "./index";

export const Route = createFileRoute("/dashboard/world-brain/overview")({
  component: WorldBrainOverviewPage,
});

function WorldBrainOverviewPage() {
  return <WorldBrainLandingPage panel="overview" />;
}
