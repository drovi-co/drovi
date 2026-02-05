/**
 * Dashboard Root - Redirects to Console
 *
 * The Console is the primary intelligence view (Datadog-like).
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/")({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/console",
    });
  },
  component: () => null,
});
