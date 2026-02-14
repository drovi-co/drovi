import { SidebarShell } from "@memorystack/core-shell";
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
    <SidebarShell
      banner={<ApiStatusBanner />}
      contentClassName="flex-1 overflow-hidden overflow-y-auto px-6 py-4 [&:has(>[data-no-shell-padding])]:p-0"
      sidebar={<AppSidebar />}
      topBar={
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
      }
    >
      {children}
    </SidebarShell>
  );
}

// Export all layout components for easy importing
export { AppSidebar } from "./app-sidebar";
export { NavMain } from "./nav-main";
export { NavUser } from "./nav-user";
export { SiteHeader } from "./site-header";
export { TeamSwitcher } from "./team-switcher";
