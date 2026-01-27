// =============================================================================
// INTERACTIVE HEADER
// =============================================================================
//
// Octolane-style header with clean, minimal design:
// - Small, non-bold text
// - Subtle icons
// - Clean pill-shaped tabs
// - Minimal filter/action buttons
//

import type { LucideIcon } from "lucide-react";
import { ChevronDown, Filter } from "lucide-react";
import type { ReactNode } from "react";

import { ModeToggle } from "@/components/mode-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface BreadcrumbItemData {
  label: string;
  href?: string;
  icon?: LucideIcon;
}

export interface HeaderTab {
  id: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
}

export interface FilterConfig {
  id: string;
  label: string;
  icon?: LucideIcon;
  options?: FilterOption[];
  onSelect?: (value: string) => void;
}

export interface FilterOption {
  value: string;
  label: string;
  icon?: LucideIcon;
}

export interface ActionButton {
  id: string;
  label: string;
  icon?: LucideIcon;
  variant?: "default" | "outline" | "ghost" | "secondary";
  onClick?: () => void;
}

export interface InteractiveHeaderProps {
  breadcrumbs?: BreadcrumbItemData[];
  tabs?: HeaderTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  filters?: FilterConfig[];
  actions?: ActionButton[];
  primaryAction?: ActionButton;
  className?: string;
  children?: ReactNode;
}

// =============================================================================
// HEADER TAB - Octolane-style pill tabs
// =============================================================================

interface HeaderTabButtonProps {
  tab: HeaderTab;
  active: boolean;
  onClick: () => void;
}

function HeaderTabButton({ tab, active, onClick }: HeaderTabButtonProps) {
  const Icon = tab.icon;

  return (
    <button
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-normal text-[13px] transition-all",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-shell-foreground hover:bg-background/40"
      )}
      onClick={onClick}
      type="button"
    >
      {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
      <span>{tab.label}</span>
      {tab.count !== undefined && (
        <span
          className={cn(
            "ml-0.5 min-w-[18px] rounded px-1 text-[11px] tabular-nums",
            active
              ? "bg-muted/80 text-muted-foreground"
              : "bg-background/50 text-muted-foreground"
          )}
        >
          {tab.count}
        </span>
      )}
    </button>
  );
}

// =============================================================================
// FILTER BUTTON - Clean, minimal style
// =============================================================================

interface FilterButtonProps {
  filter: FilterConfig;
}

function FilterButton({ filter }: FilterButtonProps) {
  const Icon = filter.icon ?? Filter;

  if (filter.options && filter.options.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 font-normal text-[13px]",
              "text-shell-foreground hover:bg-background/40",
              "outline-none transition-colors"
            )}
            type="button"
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>{filter.label}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[140px]">
          {filter.options.map((option) => {
            const OptionIcon = option.icon;
            return (
              <DropdownMenuItem
                className="text-[13px]"
                key={option.value}
                onClick={() => filter.onSelect?.(option.value)}
              >
                {OptionIcon && (
                  <OptionIcon className="mr-2 h-3.5 w-3.5" strokeWidth={1.5} />
                )}
                {option.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <button
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 font-normal text-[13px]",
        "text-shell-foreground hover:bg-background/40",
        "transition-colors"
      )}
      type="button"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
      <span>{filter.label}</span>
    </button>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function InteractiveHeader({
  breadcrumbs = [],
  tabs,
  activeTab,
  onTabChange,
  filters,
  actions,
  primaryAction,
  className,
  children,
}: InteractiveHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-3 px-4",
        "bg-shell text-shell-foreground",
        className
      )}
    >
      {/* Left section: Sidebar trigger + Breadcrumbs */}
      <div className="flex items-center gap-2">
        <SidebarTrigger className="-ml-1 h-7 w-7 text-shell-foreground hover:bg-background/40" />
        <Separator
          className="mr-1 h-4 bg-shell-border/60"
          orientation="vertical"
        />
        {breadcrumbs.length > 0 && (
          <Breadcrumb>
            <BreadcrumbList className="gap-1.5">
              {breadcrumbs.map((item, index) => {
                const Icon = item.icon;
                return (
                  <span className="contents" key={item.label}>
                    <BreadcrumbItem>
                      {index < breadcrumbs.length - 1 ? (
                        <BreadcrumbLink
                          className="flex items-center gap-1.5 font-normal text-[13px] text-shell-foreground hover:opacity-70"
                          href={item.href ?? "#"}
                        >
                          {Icon && (
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                          )}
                          {item.label}
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage className="flex items-center gap-1.5 font-normal text-[13px] text-shell-foreground">
                          {Icon && (
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                          )}
                          {item.label}
                        </BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                    {index < breadcrumbs.length - 1 && (
                      <BreadcrumbSeparator className="text-shell-foreground/30" />
                    )}
                  </span>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )}
      </div>

      {/* Center section: Tabs */}
      {tabs && tabs.length > 0 && (
        <div className="ml-3 flex items-center gap-0.5 rounded-lg bg-shell-border/20 p-0.5">
          {tabs.map((tab) => (
            <HeaderTabButton
              active={tab.id === activeTab}
              key={tab.id}
              onClick={() => onTabChange?.(tab.id)}
              tab={tab}
            />
          ))}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Custom children (for page-specific content) */}
      {children}

      {/* Filters section */}
      {filters && filters.length > 0 && (
        <div className="flex items-center gap-0.5">
          {filters.map((filter) => (
            <FilterButton filter={filter} key={filter.id} />
          ))}
        </div>
      )}

      {/* Actions section */}
      <div className="flex items-center gap-1">
        <ModeToggle />
        {actions?.map((action) => {
          const Icon = action.icon;
          return (
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 font-normal text-[13px]",
                "text-shell-foreground hover:bg-background/40",
                "transition-colors"
              )}
              key={action.id}
              onClick={action.onClick}
              type="button"
            >
              {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />}
              <span>{action.label}</span>
            </button>
          );
        })}
        {primaryAction && (
          <button
            className={cn(
              "ml-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 font-normal text-[13px]",
              "bg-foreground text-background",
              "transition-colors hover:bg-foreground/90"
            )}
            onClick={primaryAction.onClick}
            type="button"
          >
            {primaryAction.icon && (
              <primaryAction.icon className="h-3.5 w-3.5" strokeWidth={1.5} />
            )}
            <span>{primaryAction.label}</span>
          </button>
        )}
      </div>
    </header>
  );
}
