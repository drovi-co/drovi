import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  component: () => null,
  beforeLoad: async () => {
    // Landing page lives on drovi.co (separate app)
    // App lives on app.drovi.co - always redirect to dashboard or login
    const session = await authClient.getSession();
    if (session.data?.user) {
      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/login" });
  },
});
