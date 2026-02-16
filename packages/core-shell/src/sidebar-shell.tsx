import { SidebarInset, SidebarProvider } from "@memorystack/ui-core/sidebar";
import { cn } from "@memorystack/ui-core/utils";
import type { CSSProperties, ReactNode } from "react";

export interface SidebarShellProps {
  children: ReactNode;
  sidebar: ReactNode;
  topBar?: ReactNode;
  banner?: ReactNode;
  className?: string;
  contentClassName?: string;
  insetClassName?: string;
  defaultSidebarOpen?: boolean;
  style?: CSSProperties;
}

const DEFAULT_SHELL_STYLE: CSSProperties = {
  "--sidebar-width": "calc(var(--spacing) * 72)",
  "--header-height": "calc(var(--spacing) * 14)",
} as CSSProperties;

export function SidebarShell({
  children,
  sidebar,
  topBar,
  banner,
  className,
  contentClassName,
  insetClassName,
  defaultSidebarOpen,
  style,
}: SidebarShellProps) {
  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      style={{ ...DEFAULT_SHELL_STYLE, ...style }}
    >
      <div className={cn("flex h-screen w-full bg-shell", className)}>
        {sidebar}
        <div className="flex flex-1 flex-col overflow-hidden">
          {banner}
          {topBar}
          <SidebarInset
            className={cn("flex-1 overflow-hidden", insetClassName)}
          >
            <div
              className={cn(
                "flex-1 overflow-hidden overflow-y-auto px-6 py-4",
                contentClassName
              )}
            >
              {children}
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}
