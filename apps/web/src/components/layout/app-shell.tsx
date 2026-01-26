"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { CommandBar, useCommandBar } from "@/components/email/command-bar";
import { useActiveOrganization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";
import { IconRail } from "./icon-rail";
import { MobileTabBar } from "./mobile-tab-bar";
import { NavPanel } from "./nav-panel";
import { NewAppHeader } from "./new-app-header";

interface AppShellProps {
  children: React.ReactNode;
  /** Show admin navigation items */
  showAdmin?: boolean;
  /** Hide the header (useful for full-screen pages) */
  hideHeader?: boolean;
  /** Custom class for the main content area */
  contentClassName?: string;
}

export function AppShell({
  children,
  showAdmin = false,
  hideHeader = false,
  contentClassName,
}: AppShellProps) {
  const { open: commandBarOpen, setOpen: setCommandBarOpen } = useCommandBar();
  const [navPanelOpen, setNavPanelOpen] = useState(true);
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const trpc = useTRPC();

  // Fetch inbox count for badge
  const { data: inboxStats } = useQuery({
    ...trpc.threads.getStats.queryOptions({
      organizationId,
    }),
    enabled: !!organizationId,
    refetchInterval: 60000, // Refresh every minute
  });

  const inboxCount = inboxStats?.unread ?? 0;

  // Calculate source counts for nav panel badges
  const sourceCounts: Record<string, number> = {};

  return (
    <div className="flex h-screen w-full flex-col bg-background">
      {/* Header - Fixed at top */}
      {!hideHeader && (
        <NewAppHeader
          className="shrink-0"
          onComposeClick={() => {
            // Use command bar's compose functionality
            setCommandBarOpen(true);
          }}
          onSearchClick={() => setCommandBarOpen(true)}
        />
      )}

      {/* Main layout area */}
      <div className="flex min-h-0 flex-1">
        {/* Icon Rail - Always visible on desktop */}
        <IconRail
          className="hidden md:flex"
          inboxCount={inboxCount}
        />

        {/* Nav Panel - Collapsible on desktop */}
        <NavPanel
          className="hidden md:flex"
          inboxCount={inboxCount}
          isOpen={navPanelOpen}
          onClose={() => setNavPanelOpen(false)}
          sourceCounts={sourceCounts}
        />

        {/* Main content area */}
        <main
          className={cn(
            "flex-1 overflow-hidden",
            "[&:has(>[data-no-shell-padding])]:p-0",
            contentClassName
          )}
        >
          {children}
        </main>
      </div>

      {/* Mobile Tab Bar - Only visible on mobile */}
      <MobileTabBar className="md:hidden" inboxCount={inboxCount} />

      {/* Global Command Bar - available on all dashboard pages via Cmd+K */}
      <CommandBar onOpenChange={setCommandBarOpen} open={commandBarOpen} />
    </div>
  );
}

// Export all layout components for easy importing
export { AppSidebar } from "./app-sidebar";
export { IconRail } from "./icon-rail";
export { MobileTabBar } from "./mobile-tab-bar";
export { NavMain } from "./nav-main";
export { NavPanel } from "./nav-panel";
export { NavUser } from "./nav-user";
export { NewAppHeader } from "./new-app-header";
export { SiteHeader } from "./site-header";
export { TeamSwitcher } from "./team-switcher";
