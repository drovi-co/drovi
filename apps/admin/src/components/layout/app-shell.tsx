import { useEffect, useMemo, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { MonitorUp } from "lucide-react";
import { AdminSidebar } from "./admin-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function getTitleForPath(pathname: string): string {
  if (pathname === "/dashboard") return "Overview";
  if (pathname === "/dashboard/orgs") return "Organizations";
  if (pathname === "/dashboard/users") return "Users";
  if (pathname === "/dashboard/connectors") return "Connectors";
  if (pathname === "/dashboard/jobs") return "Jobs";
  if (pathname === "/dashboard/exchange") return "Exchange";
  return "Admin";
}

export function AppShell(props: { children: React.ReactNode }) {
  const location = useLocation();
  const title = useMemo(
    () => getTitleForPath(location.pathname),
    [location.pathname]
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
    <SidebarProvider
      defaultOpen={false}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <div className="flex h-screen w-full bg-shell">
        <AdminSidebar />

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-14 items-center gap-3 border-b border-shell-border bg-shell px-4">
            <SidebarTrigger className="text-muted-foreground" variant="ghost" />
            <div className="flex flex-1 items-center justify-between gap-3">
              <div className="min-w-0 flex flex-col gap-0.5">
                <div className="truncate font-medium text-sm leading-none tracking-tight">
                  {title}
                </div>
                <div className="truncate text-muted-foreground text-xs leading-none">
                  Live, no-refresh operations view
                </div>
              </div>

              <Button
                className={cn(
                  "h-8 gap-2",
                  isFullscreen ? "border border-border" : ""
                )}
                onClick={() => void toggleFullscreen()}
                size="sm"
                type="button"
                variant="secondary"
              >
                <MonitorUp className="size-4" />
                {isFullscreen ? "Exit TV mode" : "TV mode"}
              </Button>
            </div>
          </div>

          <SidebarInset className="flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {props.children}
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
