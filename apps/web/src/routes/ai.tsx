import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/ai")({
  component: () => <Navigate to="/dashboard/console" />,
});
