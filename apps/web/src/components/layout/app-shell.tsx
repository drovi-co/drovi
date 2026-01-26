import { CommandBar, useCommandBar } from "@/components/email/command-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import type {
  ActionButton,
  BreadcrumbItemData,
  FilterConfig,
  HeaderTab,
} from "./interactive-header";
import { InteractiveHeader } from "./interactive-header";

// =============================================================================
// TYPES
// =============================================================================

export interface AppShellProps {
  children: React.ReactNode;
  /** Breadcrumb navigation items */
  breadcrumbs?: BreadcrumbItemData[];
  /** Show admin menu items */
  showAdmin?: boolean;
  /** Header tabs for view switching (replaces in-page tabs) */
  tabs?: HeaderTab[];
  /** Currently active tab */
  activeTab?: string;
  /** Callback when tab changes */
  onTabChange?: (tabId: string) => void;
  /** Filter buttons in header */
  filters?: FilterConfig[];
  /** Action buttons in header */
  actions?: ActionButton[];
  /** Primary action button (CTA) */
  primaryAction?: ActionButton;
  /** Custom header content */
  headerChildren?: React.ReactNode;
}

// =============================================================================
// APP SHELL COMPONENT
// =============================================================================

export function AppShell({
  children,
  breadcrumbs = [],
  showAdmin = false,
  tabs,
  activeTab,
  onTabChange,
  filters,
  actions,
  primaryAction,
  headerChildren,
}: AppShellProps) {
  const { open: commandBarOpen, setOpen: setCommandBarOpen } = useCommandBar();

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      {/* Shell background wrapper - creates unified sidebar + header visual */}
      <div className="flex h-screen w-full bg-shell">
        <AppSidebar showAdmin={showAdmin} />

        {/* Main content area with header */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Interactive Header - shares shell background */}
          <InteractiveHeader
            actions={actions}
            activeTab={activeTab}
            breadcrumbs={breadcrumbs}
            filters={filters}
            onTabChange={onTabChange}
            primaryAction={primaryAction}
            tabs={tabs}
          >
            {headerChildren}
          </InteractiveHeader>

          {/* Content area with rounded corner */}
          <SidebarInset className="flex-1 overflow-hidden">
            <div className="flex-1 overflow-hidden overflow-y-auto px-6 py-4 [&:has(>[data-no-shell-padding])]:p-0">
              {children}
            </div>
          </SidebarInset>
        </div>
      </div>

      {/* Global Command Bar - available on all dashboard pages via Cmd+K */}
      <CommandBar onOpenChange={setCommandBarOpen} open={commandBarOpen} />
    </SidebarProvider>
  );
}

// Export all layout components for easy importing
export { AppSidebar } from "./app-sidebar";
export { NavMain } from "./nav-main";
export { NavUser } from "./nav-user";
export { SiteHeader } from "./site-header";
export { TeamSwitcher } from "./team-switcher";
