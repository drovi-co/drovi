import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import type {
  ActionButton,
  FilterConfig,
  HeaderTab,
} from "@/components/layout/interactive-header";
import { authClient } from "@/lib/auth-client";
import { orgAPI } from "@/lib/api";
import {
  getStoredOnboardingState,
  inferOnboardingComplete,
  setStoredOnboardingState,
} from "@/lib/onboarding-state";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data || !session.data.user) {
      throw redirect({
        to: "/login",
      });
    }

    const stored = getStoredOnboardingState();
    if (stored === "pending") {
      throw redirect({ to: "/onboarding/create-org" });
    }

    if (stored === null || stored === "complete") {
      try {
        const orgInfo = await orgAPI.getOrgInfo();
        const inferredComplete = inferOnboardingComplete(orgInfo);
        setStoredOnboardingState(inferredComplete ? "complete" : "pending");
        if (!inferredComplete) {
          throw redirect({ to: "/onboarding/create-org" });
        }
      } catch {
        // If we cannot confirm onboarding state, proceed to dashboard.
      }
    }

    return { session };
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
  if (pathname === "/dashboard/actuations") {
    breadcrumbs.push({ label: "Actuations" });
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
  if (pathname === "/dashboard/builder") {
    breadcrumbs.push({ label: "Continuum Builder" });
    return breadcrumbs;
  }

  // Continuum Exchange
  if (pathname === "/dashboard/exchange") {
    breadcrumbs.push({ label: "Continuum Exchange" });
    return breadcrumbs;
  }

  // Today section
  if (pathname === "/dashboard/reality-stream") {
    breadcrumbs.push({ label: "Reality Stream" });
    return breadcrumbs;
  }

  // Calendar section
  if (pathname === "/dashboard/schedule") {
    breadcrumbs.push({ label: "Schedule" });
    return breadcrumbs;
  }

  // Continuums
  if (pathname === "/dashboard/continuums") {
    breadcrumbs.push({ label: "Continuums" });
    return breadcrumbs;
  }

  // Simulations
  if (pathname === "/dashboard/simulations") {
    breadcrumbs.push({ label: "Simulations" });
    return breadcrumbs;
  }

  // Trust & Audit
  if (pathname === "/dashboard/trust") {
    breadcrumbs.push({ label: "Trust & Audit" });
    return breadcrumbs;
  }

  // Patterns
  if (pathname === "/dashboard/patterns") {
    breadcrumbs.push({ label: "Patterns" });
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

  // Tasks section
  if (pathname === "/dashboard/tasks") {
    breadcrumbs.push({ label: "Tasks" });
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
    onPrimaryAction?: () => void;
  }
): RouteHeaderConfig {
  // Console page will handle its own header with search bar
  // Other pages get default config
  if (!handlers.onPrimaryAction) {
    return {};
  }

  return {
    primaryAction: {
      id: "primary",
      label: "New Continuum",
      icon: Plus,
      onClick: handlers.onPrimaryAction,
    },
  };
}

function DashboardLayout() {
  // Admin section is intentionally hidden for now.
  const navigate = useNavigate();
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  // Get header configuration based on current route
  const headerConfig = getHeaderConfig(location.pathname, {
    onPrimaryAction: () => navigate({ to: "/dashboard/builder" }),
  });

  return (
    <AppShell
      actions={headerConfig.actions}
      breadcrumbs={breadcrumbs}
      filters={headerConfig.filters}
      primaryAction={headerConfig.primaryAction}
      tabs={headerConfig.tabs}
    >
      <Outlet />
    </AppShell>
  );
}
