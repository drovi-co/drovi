"use client";

import { Link, useLocation } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Calendar,
  Inbox,
  ListTodo,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { NavPanel } from "./nav-panel";

interface TabItem {
  icon: LucideIcon;
  label: string;
  href: string;
  badge?: number;
}

const mainTabs: TabItem[] = [
  { icon: Sparkles, label: "Today", href: "/dashboard/today" },
  { icon: Inbox, label: "Inbox", href: "/dashboard/inbox" },
  { icon: ListTodo, label: "Tasks", href: "/dashboard/tasks" },
  { icon: Calendar, label: "Calendar", href: "/dashboard/calendar" },
];

interface MobileTabBarProps {
  inboxCount?: number;
  className?: string;
}

export function MobileTabBar({ inboxCount, className }: MobileTabBarProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  // Update inbox badge count
  const tabsWithBadges = mainTabs.map((tab) =>
    tab.href === "/dashboard/inbox" ? { ...tab, badge: inboxCount } : tab
  );

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/dashboard/";
    }
    return pathname.startsWith(href);
  };

  // Check if current page is not in main tabs (show "More" as active)
  const isMoreActive = !mainTabs.some((tab) => isActive(tab.href));

  return (
    <nav
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
        "safe-area-inset-bottom",
        className
      )}
    >
      <div className="flex h-16 items-center justify-around px-2">
        {tabsWithBadges.map((tab) => {
          const active = isActive(tab.href);
          const Icon = tab.icon;

          return (
            <Link
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 py-2",
                "transition-colors duration-150",
                active ? "text-primary" : "text-muted-foreground"
              )}
              key={tab.href}
              to={tab.href}
            >
              {/* Active indicator dot */}
              {active && (
                <motion.div
                  className="absolute top-1 h-1 w-1 rounded-full bg-primary"
                  layoutId="mobileTabIndicator"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}

              <div className="relative">
                <Icon className="h-5 w-5" />
                {/* Badge */}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {tab.badge > 99 ? "99+" : tab.badge}
                  </span>
                )}
              </div>

              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}

        {/* More button - opens sheet with full navigation */}
        <Sheet onOpenChange={setMoreSheetOpen} open={moreSheetOpen}>
          <SheetTrigger asChild>
            <button
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 py-2",
                "transition-colors duration-150",
                isMoreActive ? "text-primary" : "text-muted-foreground"
              )}
              type="button"
            >
              {isMoreActive && (
                <motion.div
                  className="absolute top-1 h-1 w-1 rounded-full bg-primary"
                  layoutId="mobileTabIndicator"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-[10px] font-medium">More</span>
            </button>
          </SheetTrigger>
          <SheetContent className="w-[280px] p-0" side="left">
            <SheetHeader className="border-b border-border px-4 py-3">
              <SheetTitle className="text-left text-sm">Navigation</SheetTitle>
            </SheetHeader>
            <div className="h-full overflow-y-auto">
              {/* Full navigation panel */}
              <NavPanel
                className="relative left-0 h-full w-full border-0"
                inboxCount={inboxCount}
                isOpen={true}
                onClose={() => setMoreSheetOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
