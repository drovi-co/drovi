import { createFileRoute } from "@tanstack/react-router";
import { WorldBrainLandingPage } from "./index";

export const Route = createFileRoute("/dashboard/world-brain/counterfactuals")({
  component: WorldBrainCounterfactualsPage,
});

function WorldBrainCounterfactualsPage() {
  return <WorldBrainLandingPage panel="counterfactuals" />;
}
