import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { useCommandBar } from "@/components/email/command-bar";
import { AppShell } from "@/components/layout/app-shell";
import type {
  ActionButton,
  FilterConfig,
  HeaderTab,
} from "@/components/layout/interactive-header";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/login",
      });
    }

    // Check if user is admin
    const isAdmin = session.data.user.role === "admin";

    return { session, isAdmin };
  },
});

function getBreadcrumbs(pathname: string) {
  const breadcrumbs: Array<{ label: string; href?: string }> = [];

  // Dashboard root
  if (pathname === "/dashboard") {
    breadcrumbs.push({ label: "Dashboard" });
    return breadcrumbs;
  }

  // Settings
  if (pathname === "/dashboard/settings") {
    breadcrumbs.push({ label: "Settings" });
    return breadcrumbs;
  }

  // Billing
  if (pathname === "/dashboard/billing") {
    breadcrumbs.push({ label: "Billing" });
    return breadcrumbs;
  }

  // Console (primary view)
  if (pathname === "/dashboard/console") {
    breadcrumbs.push({ label: "Console" });
    return breadcrumbs;
  }

  // Graph
  if (pathname === "/dashboard/graph") {
    breadcrumbs.push({ label: "Graph" });
    return breadcrumbs;
  }

  // AI Chat
  if (pathname === "/dashboard/ai") {
    breadcrumbs.push({ label: "AI Chat" });
    return breadcrumbs;
  }

  // Email Accounts
  if (pathname === "/dashboard/email-accounts") {
    breadcrumbs.push({ label: "Email Accounts" });
    return breadcrumbs;
  }

  // Today section
  if (pathname === "/dashboard/today") {
    breadcrumbs.push({ label: "Today" });
    return breadcrumbs;
  }

  // Calendar section
  if (pathname === "/dashboard/calendar") {
    breadcrumbs.push({ label: "Calendar" });
    return breadcrumbs;
  }

  // Thread detail page (under /dashboard/email/thread for route compatibility)
  if (pathname.startsWith("/dashboard/email/thread")) {
    breadcrumbs.push({ label: "Console", href: "/dashboard/console" });
    breadcrumbs.push({ label: "Thread" });
    return breadcrumbs;
  }

  // Decisions section
  if (pathname === "/dashboard/decisions") {
    breadcrumbs.push({ label: "Decisions" });
    return breadcrumbs;
  }

  // Commitments section
  if (pathname === "/dashboard/commitments") {
    breadcrumbs.push({ label: "Commitments" });
    return breadcrumbs;
  }

  // Contacts section
  if (pathname === "/dashboard/contacts") {
    breadcrumbs.push({ label: "Contacts" });
    return breadcrumbs;
  }

  // Contact detail page
  if (pathname.startsWith("/dashboard/contacts/")) {
    breadcrumbs.push({ label: "Contacts", href: "/dashboard/contacts" });
    breadcrumbs.push({ label: "Profile" });
    return breadcrumbs;
  }

  // Sources section
  if (pathname === "/dashboard/sources") {
    breadcrumbs.push({ label: "Connected Sources" });
    return breadcrumbs;
  }


  // Team section
  if (pathname.startsWith("/dashboard/team")) {
    if (pathname === "/dashboard/team") {
      breadcrumbs.push({ label: "Team" });
    } else {
      breadcrumbs.push({ label: "Team", href: "/dashboard/team" });

      if (pathname === "/dashboard/team/members") {
        breadcrumbs.push({ label: "Members" });
      } else if (pathname === "/dashboard/team/invitations") {
        breadcrumbs.push({ label: "Invitations" });
      } else if (pathname === "/dashboard/team/settings") {
        breadcrumbs.push({ label: "Settings" });
      }
    }

    return breadcrumbs;
  }

  return breadcrumbs;
}

// =============================================================================
// HEADER CONFIGURATION BY ROUTE
// =============================================================================

interface RouteHeaderConfig {
  tabs?: HeaderTab[];
  filters?: FilterConfig[];
  actions?: ActionButton[];
  primaryAction?: ActionButton;
}

function getHeaderConfig(
  _pathname: string,
  handlers: {
    onCompose?: () => void;
  }
): RouteHeaderConfig {
  // Console page will handle its own header with search bar
  // Other pages get default config
  return {
    primaryAction: {
      id: "compose",
      label: "Compose",
      icon: Plus,
      onClick: handlers.onCompose,
    },
  };
}

function DashboardLayout() {
  const { isAdmin } = Route.useRouteContext() as {
    isAdmin: boolean;
  };
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);
  const { openCompose } = useCommandBar();

  // Get header configuration based on current route
  const headerConfig = getHeaderConfig(location.pathname, {
    onCompose: openCompose,
  });

  return (
    <AppShell
      actions={headerConfig.actions}
      breadcrumbs={breadcrumbs}
      filters={headerConfig.filters}
      primaryAction={headerConfig.primaryAction}
      showAdmin={isAdmin}
      tabs={headerConfig.tabs}
    >
      <Outlet />
    </AppShell>
  );
}
