import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
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

  // Email/Inbox section
  if (pathname.startsWith("/dashboard/email")) {
    if (pathname === "/dashboard/email") {
      breadcrumbs.push({ label: "Inbox" });
    } else if (pathname.startsWith("/dashboard/email/thread")) {
      breadcrumbs.push({ label: "Inbox", href: "/dashboard/email" });
      breadcrumbs.push({ label: "Thread" });
    }
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

function DashboardLayout() {
  const { isAdmin } = Route.useRouteContext();
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  return (
    <AppShell breadcrumbs={breadcrumbs} showAdmin={isAdmin}>
      <Outlet />
    </AppShell>
  );
}
