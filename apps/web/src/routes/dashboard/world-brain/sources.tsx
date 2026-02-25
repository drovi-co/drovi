import { createFileRoute } from "@tanstack/react-router";
import { WorldBrainLandingPage } from "./index";

export const Route = createFileRoute("/dashboard/world-brain/sources")({
  component: WorldBrainSourcesPage,
});

function WorldBrainSourcesPage() {
  return <WorldBrainLandingPage panel="sources" />;
}
