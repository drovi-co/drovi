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
import { useT } from "@/i18n";
import { useAuthStore } from "@/lib/auth";
import { orgAPI } from "@/lib/api";
import {
  getStoredOnboardingState,
  inferOnboardingComplete,
  setStoredOnboardingState,
} from "@/lib/onboarding-state";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
  beforeLoad: async () => {
    const store = useAuthStore.getState();
    if (!store.user) {
      await store.checkAuth();
    }

    const user = useAuthStore.getState().user;
    if (!user) {
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
        // If we cannot confirm onboarding state, default to onboarding.
        setStoredOnboardingState("pending");
        throw redirect({ to: "/onboarding/create-org" });
      }
    }

    return { user };
  },
});

function getBreadcrumbs(
  pathname: string,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string
) {
  const breadcrumbs: Array<{ label: string; href?: string }> = [];

  // Dashboard root
  if (pathname === "/dashboard") {
    breadcrumbs.push({ label: t("pages.dashboard.home.breadcrumb") });
    return breadcrumbs;
  }

  // Settings
  if (pathname === "/dashboard/settings") {
    breadcrumbs.push({ label: t("nav.items.settings") });
    return breadcrumbs;
  }

  // Billing
  if (pathname === "/dashboard/actuations") {
    breadcrumbs.push({ label: t("nav.items.actuations") });
    return breadcrumbs;
  }

  // Console (primary view)
  if (pathname === "/dashboard/console") {
    breadcrumbs.push({ label: t("nav.items.console") });
    return breadcrumbs;
  }

  // Graph
  if (pathname === "/dashboard/graph") {
    breadcrumbs.push({ label: t("nav.items.graph") });
    return breadcrumbs;
  }

  // AI Chat
  if (pathname === "/dashboard/builder") {
    breadcrumbs.push({ label: t("nav.items.builder") });
    return breadcrumbs;
  }

  // Continuum Exchange
  if (pathname === "/dashboard/exchange") {
    breadcrumbs.push({ label: t("nav.items.exchange") });
    return breadcrumbs;
  }

  // Today section
  if (pathname === "/dashboard/reality-stream") {
    breadcrumbs.push({ label: t("nav.items.realityStream") });
    return breadcrumbs;
  }

  // Calendar section
  if (pathname === "/dashboard/schedule") {
    breadcrumbs.push({ label: t("nav.items.schedule") });
    return breadcrumbs;
  }

  // Continuums
  if (pathname === "/dashboard/continuums") {
    breadcrumbs.push({ label: t("nav.items.continuums") });
    return breadcrumbs;
  }

  // Simulations
  if (pathname === "/dashboard/simulations") {
    breadcrumbs.push({ label: t("nav.items.simulations") });
    return breadcrumbs;
  }

  // Trust & Audit
  if (pathname === "/dashboard/trust") {
    breadcrumbs.push({ label: t("nav.items.trustAudit") });
    return breadcrumbs;
  }

  // Patterns
  if (pathname === "/dashboard/patterns") {
    breadcrumbs.push({ label: t("nav.items.patterns") });
    return breadcrumbs;
  }

  // Decisions section
  if (pathname === "/dashboard/decisions") {
    breadcrumbs.push({ label: t("nav.items.decisions") });
    return breadcrumbs;
  }

  // Commitments section
  if (pathname === "/dashboard/commitments") {
    breadcrumbs.push({ label: t("nav.items.commitments") });
    return breadcrumbs;
  }

  // Contacts section
  if (pathname === "/dashboard/contacts") {
    breadcrumbs.push({ label: t("nav.items.people") });
    return breadcrumbs;
  }

  // Tasks section
  if (pathname === "/dashboard/tasks") {
    breadcrumbs.push({ label: t("nav.items.tasks") });
    return breadcrumbs;
  }

  // Contact detail page
  if (pathname.startsWith("/dashboard/contacts/")) {
    breadcrumbs.push({ label: t("nav.items.people"), href: "/dashboard/contacts" });
    breadcrumbs.push({ label: t("pages.dashboard.contacts.profile") });
    return breadcrumbs;
  }

  // Sources section
  if (pathname === "/dashboard/sources") {
    breadcrumbs.push({ label: t("nav.items.connectedSources") });
    return breadcrumbs;
  }


  // Team section
  if (pathname.startsWith("/dashboard/team")) {
    if (pathname === "/dashboard/team") {
      breadcrumbs.push({ label: t("nav.items.team") });
    } else {
      breadcrumbs.push({ label: t("nav.items.team"), href: "/dashboard/team" });

      if (pathname === "/dashboard/team/members") {
        breadcrumbs.push({ label: t("nav.items.members") });
      } else if (pathname === "/dashboard/team/invitations") {
        breadcrumbs.push({ label: t("nav.items.invitations") });
      } else if (pathname === "/dashboard/team/settings") {
        breadcrumbs.push({ label: t("nav.items.settings") });
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
      label: "pages.dashboard.home.primaryAction.newContinuum",
      icon: Plus,
      onClick: handlers.onPrimaryAction,
    },
  };
}

function DashboardLayout() {
  // Admin section is intentionally hidden for now.
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname, t);

  // Get header configuration based on current route
  const headerConfig = getHeaderConfig(location.pathname, {
    onPrimaryAction: () => navigate({ to: "/dashboard/builder" }),
  });

  return (
    <AppShell
      actions={headerConfig.actions}
      breadcrumbs={breadcrumbs}
      filters={headerConfig.filters}
      primaryAction={
        headerConfig.primaryAction
          ? {
              ...headerConfig.primaryAction,
              label: t(headerConfig.primaryAction.label),
            }
          : undefined
      }
      tabs={headerConfig.tabs}
    >
      <Outlet />
    </AppShell>
  );
}
