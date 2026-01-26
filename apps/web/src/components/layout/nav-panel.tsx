"use client";

import { Link, useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Bell,
  BookOpen,
  Calendar,
  CheckCircle2,
  Hash,
  Inbox,
  Link2,
  ListTodo,
  Mail,
  MessageCircle,
  Search,
  Settings,
  Sparkles,
  Users,
  FileText,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  badge?: number;
  isExternal?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Navigation sections matching the design
const navSections: NavSection[] = [
  {
    title: "VIEWS",
    items: [
      { icon: Sparkles, label: "Today", href: "/dashboard/today" },
      { icon: Inbox, label: "Smart Inbox", href: "/dashboard/inbox" },
      { icon: ListTodo, label: "Tasks", href: "/dashboard/tasks" },
      { icon: Calendar, label: "Calendar", href: "/dashboard/calendar" },
    ],
  },
  {
    title: "INTELLIGENCE",
    items: [
      { icon: CheckCircle2, label: "Commitments", href: "/dashboard/commitments" },
      { icon: BookOpen, label: "Decisions", href: "/dashboard/decisions" },
      { icon: Users, label: "People", href: "/dashboard/contacts" },
      { icon: Search, label: "Search", href: "/dashboard/search" },
      { icon: BarChart3, label: "Analytics", href: "/dashboard/analytics" },
    ],
  },
  {
    title: "SOURCES",
    items: [
      { icon: Mail, label: "Email", href: "/dashboard/inbox?source=email" },
      { icon: Hash, label: "Slack", href: "/dashboard/inbox?source=slack" },
      { icon: Calendar, label: "Calendar", href: "/dashboard/inbox?source=calendar" },
      { icon: MessageCircle, label: "WhatsApp", href: "/dashboard/inbox?source=whatsapp" },
      { icon: FileText, label: "Notion", href: "/dashboard/inbox?source=notion" },
    ],
  },
];

const bottomNavItems: NavItem[] = [
  { icon: Link2, label: "Connected Sources", href: "/dashboard/sources" },
  { icon: Bell, label: "Notifications", href: "/dashboard/notifications" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

interface NavPanelItemProps {
  item: NavItem;
  isActive: boolean;
}

function NavPanelItem({ item, isActive }: NavPanelItemProps) {
  const Icon = item.icon;

  return (
    <Link
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-[13px]",
        "transition-colors duration-150",
        isActive
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
      to={item.href}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium",
            isActive
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}
    </Link>
  );
}

interface NavPanelProps {
  isOpen: boolean;
  onClose?: () => void;
  sourceCounts?: Record<string, number>;
  inboxCount?: number;
  className?: string;
}

export function NavPanel({
  isOpen,
  onClose,
  sourceCounts = {},
  inboxCount,
  className,
}: NavPanelProps) {
  const location = useLocation();
  const pathname = location.pathname;

  const isActive = (href: string) => {
    // Handle query params for source filtering
    if (href.includes("?source=")) {
      const sourceParam = href.split("source=")[1];
      const searchSource =
        typeof location.search === "object" && location.search !== null
          ? (location.search as Record<string, unknown>).source
          : undefined;
      return pathname === "/dashboard/inbox" && searchSource === sourceParam;
    }
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/dashboard/";
    }
    return pathname.startsWith(href);
  };

  // Update sections with counts
  const sectionsWithCounts = navSections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.href === "/dashboard/inbox") {
        return { ...item, badge: inboxCount };
      }
      // Add source counts for source items
      const sourceMatch = item.href.match(/source=(\w+)/);
      if (sourceMatch && sourceCounts[sourceMatch[1]]) {
        return { ...item, badge: sourceCounts[sourceMatch[1]] };
      }
      return item;
    }),
  }));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop for mobile */}
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-40 bg-black/20 md:hidden"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.nav
            animate={{ x: 0, opacity: 1 }}
            className={cn(
              "fixed left-12 top-0 z-50 h-full w-[220px] border-r border-sidebar-border bg-sidebar",
              "flex flex-col py-3",
              "md:relative md:left-0",
              className
            )}
            exit={{ x: -220, opacity: 0 }}
            initial={{ x: -220, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-3">
              {sectionsWithCounts.map((section, index) => (
                <div className={cn(index > 0 && "mt-6")} key={section.title}>
                  <h3 className="mb-2 px-3 text-[11px] font-medium tracking-wider text-muted-foreground">
                    {section.title}
                  </h3>
                  <div className="space-y-0.5">
                    {section.items.map((item) => (
                      <NavPanelItem
                        isActive={isActive(item.href)}
                        item={item}
                        key={item.href}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Add source button */}
              <div className="mt-4 px-3">
                <Button
                  asChild
                  className="w-full justify-start gap-2"
                  size="sm"
                  variant="ghost"
                >
                  <Link to="/dashboard/sources">
                    <Plus className="h-4 w-4" />
                    Connect Source
                  </Link>
                </Button>
              </div>
            </div>

            {/* Bottom section */}
            <div className="border-t border-sidebar-border px-3 pt-3">
              <div className="space-y-0.5">
                {bottomNavItems.map((item) => (
                  <NavPanelItem
                    isActive={isActive(item.href)}
                    item={item}
                    key={item.href}
                  />
                ))}
              </div>
            </div>
          </motion.nav>
        </>
      )}
    </AnimatePresence>
  );
}
