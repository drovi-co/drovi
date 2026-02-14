import { SidebarShell } from "@memorystack/core-shell";
import { Button } from "@memorystack/ui-core/button";
import { SidebarTrigger } from "@memorystack/ui-core/sidebar";
import { useLocation } from "@tanstack/react-router";
import { MonitorUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { AdminSidebar } from "./admin-sidebar";

function getTitleKeyForPath(pathname: string): string {
  if (pathname === "/dashboard") return "admin.nav.items.overview";
  if (pathname === "/dashboard/orgs") return "admin.nav.items.organizations";
  if (pathname === "/dashboard/users") return "admin.nav.items.users";
  if (pathname === "/dashboard/connectors") return "admin.nav.items.connectors";
  if (pathname === "/dashboard/jobs") return "admin.nav.items.jobs";
  if (pathname === "/dashboard/governance") return "admin.nav.items.governance";
  if (pathname === "/dashboard/exchange") return "admin.nav.items.exchange";
  if (pathname === "/dashboard/tickets") return "admin.nav.items.tickets";
  return "admin.shell.titleFallback";
}

export function AppShell(props: { children: React.ReactNode }) {
  const location = useLocation();
  const t = useT();
  const title = useMemo(
    () => t(getTitleKeyForPath(location.pathname)),
    [location.pathname, t]
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Ignore (browser restriction).
    }
  };

  return (
    <SidebarShell
      contentClassName="flex-1 overflow-y-auto px-6 py-5"
      defaultSidebarOpen={false}
      sidebar={<AdminSidebar />}
      topBar={
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-shell-border border-b bg-shell px-4">
          <SidebarTrigger className="text-muted-foreground" variant="ghost" />
          <div className="flex flex-1 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="truncate font-medium text-sm leading-none tracking-tight">
                {title}
              </div>
              <div className="truncate text-muted-foreground text-xs leading-none">
                {t("admin.shell.subtitle")}
              </div>
            </div>

            <Button
              className={cn(
                "h-8 gap-2",
                isFullscreen ? "border border-border" : ""
              )}
              onClick={() => toggleFullscreen()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <MonitorUp className="size-4" />
              {isFullscreen
                ? t("admin.shell.exitTvMode")
                : t("admin.shell.tvMode")}
            </Button>
          </div>
        </div>
      }
    >
      {props.children}
    </SidebarShell>
  );
}
