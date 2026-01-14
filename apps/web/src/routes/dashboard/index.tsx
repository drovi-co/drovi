import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardIndex,
});

function DashboardIndex() {
  // Redirect to Inbox (Email) as the default page
  return <Navigate to="/dashboard/email" />;
}
