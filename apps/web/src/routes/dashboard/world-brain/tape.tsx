import { createFileRoute } from "@tanstack/react-router";
import { WorldBrainLandingPage } from "./index";

export const Route = createFileRoute("/dashboard/world-brain/tape")({
  component: WorldBrainTapePage,
});

function WorldBrainTapePage() {
  return <WorldBrainLandingPage panel="tape" />;
}
