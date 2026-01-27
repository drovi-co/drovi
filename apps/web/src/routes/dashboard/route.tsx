import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import {
  Bell,
  Calendar,
  CheckCircle2,
  Filter,
  Inbox,
  Mail,
  MessageSquare,
  Plus,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { UpgradeModal } from "@/components/billing/upgrade-modal";
import { PresenceProvider, ActivitySidebar } from "@/components/collaboration";
import { useCommandBar } from "@/components/email/command-bar";
import type {
  ActionButton,
  FilterConfig,
  HeaderTab,
} from "@/components/layout/interactive-header";
import { AppShell } from "@/components/layout/app-shell";
import { authClient, useSession, useActiveOrganization } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

// Invite code storage helpers (imported from login page)
const INVITE_CODE_KEY = "drovi_invite_code";

function getStoredInviteCode(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(INVITE_CODE_KEY);
}

function clearStoredInviteCode() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(INVITE_CODE_KEY);
}

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/login",
      });
    }

    // Check if user has an active organization
    const activeOrgResult = await authClient.organization.getActiveMember();

    // If no active organization, try to get list of orgs
    if (!activeOrgResult.data) {
      const orgsResult = await authClient.organization.list();

      // If user has no organizations, redirect to onboarding
      if (!orgsResult.data || orgsResult.data.length === 0) {
        throw redirect({
          to: "/onboarding/create-org",
        });
      }

      // If user has organizations but none active, set the first one as active
      if (orgsResult.data.length > 0) {
        await authClient.organization.setActive({
          organizationId: orgsResult.data[0].id,
        });
      }
    }

    // Check if user is admin
    const isAdmin = session.data.user.role === "admin";

    // Get customer state for billing info (only if Polar plugin is enabled)
    let customerState = null;
    if ("customer" in authClient && authClient.customer) {
      const result = await (
        authClient.customer as { state: () => Promise<{ data: unknown }> }
      ).state();
      customerState = result.data;
    }

    return { session, customerState, isAdmin };
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

  // Notifications
  if (pathname === "/dashboard/notifications") {
    breadcrumbs.push({ label: "Notifications" });
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

  // Unified Inbox section
  if (pathname === "/dashboard/inbox") {
    breadcrumbs.push({ label: "Smart Inbox" });
    return breadcrumbs;
  }

  // Thread detail page (under /dashboard/email/thread for route compatibility)
  if (pathname.startsWith("/dashboard/email/thread")) {
    breadcrumbs.push({ label: "Smart Inbox", href: "/dashboard/inbox" });
    breadcrumbs.push({ label: "Thread" });
    return breadcrumbs;
  }

  // Search section
  if (pathname === "/dashboard/search") {
    breadcrumbs.push({ label: "Search" });
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

  // Analytics section
  if (pathname === "/dashboard/analytics") {
    breadcrumbs.push({ label: "Analytics" });
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

interface CustomerState {
  activeSubscriptions?: Array<{
    id: string;
    product?: { name?: string };
    status?: string;
  }>;
}

// =============================================================================
// HEADER CONFIGURATION BY ROUTE
// =============================================================================
// This configures the interactive header based on the current route, creating
// an Octolane-style header with tabs, filters, and actions.

interface RouteHeaderConfig {
  tabs?: HeaderTab[];
  filters?: FilterConfig[];
  actions?: ActionButton[];
  primaryAction?: ActionButton;
}

function getHeaderConfig(
  pathname: string,
  handlers: {
    onCompose?: () => void;
    onTabChange?: (tabId: string) => void;
    onSourceFilter?: (value: string) => void;
    onActivityToggle?: () => void;
  }
): RouteHeaderConfig {
  // Common action for activity feed (available on all dashboard pages)
  const activityAction: ActionButton = {
    id: "activity",
    label: "Activity",
    icon: Bell,
    onClick: handlers.onActivityToggle,
  };

  // Smart Inbox page - Conversation-centric tabs
  if (pathname === "/dashboard/inbox") {
    return {
      tabs: [
        { id: "all", label: "All", icon: Inbox },
        { id: "unread", label: "Unread", icon: Mail },
        { id: "starred", label: "Starred", icon: Star },
        { id: "done", label: "Done", icon: CheckCircle2 },
      ],
      filters: [
        {
          id: "source",
          label: "Source",
          icon: Filter,
          options: [
            { value: "all", label: "All sources" },
            { value: "email", label: "Email", icon: Mail },
            { value: "slack", label: "Slack", icon: MessageSquare },
            { value: "calendar", label: "Calendar", icon: Calendar },
          ],
          onSelect: handlers.onSourceFilter,
        },
      ],
      actions: [activityAction],
      primaryAction: {
        id: "compose",
        label: "Compose",
        icon: Plus,
        onClick: handlers.onCompose,
      },
    };
  }

  // Default - just the activity action
  return {
    actions: [activityAction],
  };
}

function DashboardLayout() {
  const { isAdmin, customerState } = Route.useRouteContext() as {
    isAdmin: boolean;
    customerState: CustomerState | null;
  };
  const location = useLocation();
  const navigate = useNavigate();
  const breadcrumbs = getBreadcrumbs(location.pathname);
  const trpc = useTRPC();
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const inviteCodeProcessed = useRef(false);
  const { openCompose } = useCommandBar();

  // Get organization ID for presence tracking
  const organizationId = activeOrg?.id ?? "";

  // Activity sidebar state
  const [activitySidebarOpen, setActivitySidebarOpen] = useState(false);

  // Read tab from URL search params (for inbox page)
  const searchParams = new URLSearchParams(location.search);
  const tabFromUrl = searchParams.get("tab") ?? "all";

  // Handle source filter changes
  const handleSourceFilter = useCallback((value: string) => {
    if (location.pathname === "/dashboard/inbox") {
      navigate({
        to: "/dashboard/inbox",
        search: (prev) => {
          if (value === "all") {
            // Remove sources from search params
            const { sources, ...rest } = prev as Record<string, unknown>;
            return rest;
          }
          return { ...prev, sources: value };
        },
      });
    }
  }, [location.pathname, navigate]);

  // Get header configuration based on current route
  const headerConfig = getHeaderConfig(location.pathname, {
    onCompose: openCompose,
    onSourceFilter: handleSourceFilter,
    onActivityToggle: () => setActivitySidebarOpen((prev) => !prev),
  });

  // Handle tab changes - update URL search params
  const handleTabChange = useCallback((tabId: string) => {
    // Only update URL if we're on the inbox page
    if (location.pathname === "/dashboard/inbox") {
      const validTabs = ["all", "unread", "starred", "done"] as const;
      const tab = validTabs.includes(tabId as typeof validTabs[number])
        ? (tabId as typeof validTabs[number])
        : "all";
      navigate({
        to: "/dashboard/inbox",
        search: tab === "all" ? {} : { tab },
      });
    }
  }, [location.pathname, navigate]);

  // Mutation to mark invite code as used
  const useInviteCodeMutation = useMutation(
    trpc.waitlist.useCode.mutationOptions({
      onSuccess: () => {
        clearStoredInviteCode();
      },
      onError: () => {
        // Silently clear the code even on error (code might already be used)
        clearStoredInviteCode();
      },
    })
  );

  // Check and use invite code after signup
  useEffect(() => {
    if (inviteCodeProcessed.current) return;

    const storedCode = getStoredInviteCode();
    if (storedCode && session?.user?.id) {
      inviteCodeProcessed.current = true;
      useInviteCodeMutation.mutate({
        code: storedCode,
        userId: session.user.id,
      });
    }
  }, [session?.user?.id, useInviteCodeMutation]);

  // Query trial/credit status
  const { data: creditStatus } = useQuery(
    trpc.credits.getStatus.queryOptions()
  );

  // Check if user has an active subscription
  const hasActiveSubscription =
    (customerState?.activeSubscriptions?.length ?? 0) > 0;

  // Determine if we should show the upgrade modal
  // Show when trial is expired AND user has no active subscription
  // Skip in development mode to avoid blocking the app during testing
  const shouldShowUpgradeModal =
    !import.meta.env.DEV &&
    creditStatus?.trialStatus === "expired" &&
    !hasActiveSubscription;

  // Calculate trial days used (7 day trial - days remaining)
  const trialDaysUsed = creditStatus?.trialDaysRemaining
    ? 7 - creditStatus.trialDaysRemaining
    : 7;

  return (
    <PresenceProvider
      organizationId={organizationId}
      enabled={Boolean(organizationId)}
    >
      <AppShell
        activeTab={tabFromUrl}
        actions={headerConfig.actions}
        breadcrumbs={breadcrumbs}
        filters={headerConfig.filters}
        onTabChange={handleTabChange}
        primaryAction={headerConfig.primaryAction}
        showAdmin={isAdmin}
        tabs={headerConfig.tabs}
      >
        <Outlet />
      </AppShell>

      {/* Hard paywall modal - cannot be dismissed */}
      {shouldShowUpgradeModal && <UpgradeModal trialDaysUsed={trialDaysUsed} />}

      {/* Activity sidebar - togglable via header action */}
      <ActivitySidebar
        organizationId={organizationId}
        isOpen={activitySidebarOpen}
        onClose={() => setActivitySidebarOpen(false)}
      />
    </PresenceProvider>
  );
}
