import { createFileRoute } from "@tanstack/react-router";
import { TrustPage } from "@/modules/trust/pages/trust-page";

export const Route = createFileRoute("/dashboard/trust")({
  component: TrustPage,
});
