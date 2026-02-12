import { SidebarInset, SidebarProvider } from "@memorystack/ui-core/sidebar";
import { ApiStatusBanner } from "./api-status-banner";
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
  tabs,
  activeTab,
  onTabChange,
  filters,
  actions,
  primaryAction,
  headerChildren,
}: AppShellProps) {
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
        <AppSidebar />

        {/* Main content area with header */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <ApiStatusBanner />
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
    </SidebarProvider>
  );
}

// Export all layout components for easy importing
export { AppSidebar } from "./app-sidebar";
export { NavMain } from "./nav-main";
export { NavUser } from "./nav-user";
export { SiteHeader } from "./site-header";
export { TeamSwitcher } from "./team-switcher";
