"use client";

import { Link, useLocation } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircle2,
  Inbox,
  Link2,
  ListTodo,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  badge?: number;
}

interface NavSection {
  items: NavItem[];
}

// Navigation structure matching the plan
const mainNavItems: NavSection = {
  items: [
    { icon: Sparkles, label: "Today", href: "/dashboard/today" },
    { icon: Inbox, label: "Smart Inbox", href: "/dashboard/inbox" },
    { icon: ListTodo, label: "Tasks", href: "/dashboard/tasks" },
    { icon: Calendar, label: "Calendar", href: "/dashboard/calendar" },
  ],
};

const intelligenceNavItems: NavSection = {
  items: [
    { icon: CheckCircle2, label: "Commitments", href: "/dashboard/commitments" },
    { icon: BookOpen, label: "Decisions", href: "/dashboard/decisions" },
    { icon: Users, label: "People", href: "/dashboard/contacts" },
    { icon: Search, label: "Search", href: "/dashboard/search" },
    { icon: BarChart3, label: "Analytics", href: "/dashboard/analytics" },
  ],
};

const bottomNavItems: NavSection = {
  items: [
    { icon: Link2, label: "Sources", href: "/dashboard/sources" },
    { icon: Settings, label: "Settings", href: "/dashboard/settings" },
  ],
};

interface IconRailItemProps {
  item: NavItem;
  isActive: boolean;
}

function IconRailItem({ item, isActive }: IconRailItemProps) {
  const Icon = item.icon;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Link
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-lg",
            "transition-all duration-200",
            "hover:bg-muted",
            isActive && "bg-primary/10 text-primary"
          )}
          to={item.href}
        >
          {/* Active indicator bar */}
          {isActive && (
            <motion.div
              className="absolute left-0 h-6 w-[3px] rounded-r-full bg-primary"
              layoutId="activeIndicator"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}

          <Icon
            className={cn(
              "h-5 w-5",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          />

          {/* Badge for counts */}
          {item.badge && item.badge > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        <p>{item.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

interface IconRailProps {
  logo?: ReactNode;
  inboxCount?: number;
  className?: string;
}

export function IconRail({ logo, inboxCount, className }: IconRailProps) {
  const location = useLocation();
  const pathname = location.pathname;

  // Update inbox badge count
  const mainItems = mainNavItems.items.map((item) =>
    item.href === "/dashboard/inbox" ? { ...item, badge: inboxCount } : item
  );

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/dashboard/";
    }
    return pathname.startsWith(href);
  };

  return (
    <TooltipProvider>
      <nav
        className={cn(
          "flex h-full w-12 flex-col items-center border-r border-sidebar-border bg-sidebar py-3",
          className
        )}
      >
        {/* Logo */}
        <div className="mb-4 flex h-10 w-10 items-center justify-center">
          {logo || (
            <Link
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold text-sm"
              to="/dashboard"
            >
              D
            </Link>
          )}
        </div>

        {/* Main navigation */}
        <div className="flex flex-col gap-1">
          {mainItems.map((item) => (
            <IconRailItem
              isActive={isActive(item.href)}
              item={item}
              key={item.href}
            />
          ))}
        </div>

        {/* Separator */}
        <div className="my-3 h-px w-6 bg-border" />

        {/* Intelligence navigation */}
        <div className="flex flex-col gap-1">
          {intelligenceNavItems.items.map((item) => (
            <IconRailItem
              isActive={isActive(item.href)}
              item={item}
              key={item.href}
            />
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom navigation */}
        <div className="flex flex-col gap-1">
          {bottomNavItems.items.map((item) => (
            <IconRailItem
              isActive={isActive(item.href)}
              item={item}
              key={item.href}
            />
          ))}
        </div>
      </nav>
    </TooltipProvider>
  );
}
