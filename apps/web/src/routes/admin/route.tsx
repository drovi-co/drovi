import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
} from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({
        to: "/login",
      });
    }

    // Check if user is admin
    if (session.data.user.role !== "admin") {
      throw redirect({
        to: "/dashboard",
      });
    }

    return { session };
  },
});

const adminTabs = [
  { to: "/admin", label: "Dashboard", exact: true },
  { to: "/admin/waitlist", label: "Waitlist" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/organizations", label: "Organizations" },
  { to: "/admin/audit", label: "Audit Logs" },
  { to: "/admin/identity-merge", label: "Identity Merge" },
] as const;

function getBreadcrumbs(pathname: string) {
  const breadcrumbs: Array<{ label: string; href?: string }> = [];

  if (pathname === "/admin") {
    breadcrumbs.push({ label: "Admin" });
  } else if (pathname === "/admin/waitlist") {
    breadcrumbs.push({ label: "Waitlist" });
  } else if (pathname === "/admin/users") {
    breadcrumbs.push({ label: "Users" });
  } else if (pathname === "/admin/organizations") {
    breadcrumbs.push({ label: "Organizations" });
  } else if (pathname === "/admin/audit") {
    breadcrumbs.push({ label: "Audit Logs" });
  } else if (pathname === "/admin/identity-merge") {
    breadcrumbs.push({ label: "Identity Merge" });
  }

  return breadcrumbs;
}

function AdminLayout() {
  const location = useLocation();
  const breadcrumbs = getBreadcrumbs(location.pathname);

  return (
    <AppShell breadcrumbs={breadcrumbs} showAdmin>
      <div className="space-y-6">
        {/* Admin navigation tabs */}
        <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
          {adminTabs.map((tab) => {
            const isActive =
              "exact" in tab && tab.exact
                ? location.pathname === tab.to
                : location.pathname.startsWith(tab.to);

            return (
              <Link
                className={cn(
                  "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 font-medium text-sm ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                  isActive
                    ? "bg-background text-foreground shadow"
                    : "hover:bg-background/50 hover:text-foreground"
                )}
                key={tab.to}
                to={tab.to}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
        <Outlet />
      </div>
    </AppShell>
  );
}
