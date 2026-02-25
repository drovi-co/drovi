import { createFileRoute } from "@tanstack/react-router";
import { WorldBrainLandingPage } from "./index";

export const Route = createFileRoute("/dashboard/world-brain/obligations")({
  component: WorldBrainObligationsPage,
});

function WorldBrainObligationsPage() {
  return <WorldBrainLandingPage panel="obligations" />;
}
