import {
  BarChart3,
  Bell,
  BookOpen,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileText,
  Inbox,
  Link2,
  ListTodo,
  Mail,
  Search,
  Settings,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";

import { NotificationCenter } from "@/components/notifications/notification-center";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar";
import { type NavItem, NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { TeamSwitcher } from "./team-switcher";

// Intelligence navigation items (Drovi - Multi-Source)
const intelligenceNavItems: NavItem[] = [
  {
    title: "Today",
    url: "/dashboard/today",
    icon: Sparkles,
  },
  {
    title: "Smart Inbox",
    url: "/dashboard/inbox",
    icon: Inbox,
  },
  {
    title: "Tasks",
    url: "/dashboard/tasks",
    icon: ListTodo,
  },
  {
    title: "Calendar",
    url: "/dashboard/calendar",
    icon: Calendar,
  },
];

// Memory & Intelligence items
const memoryNavItems: NavItem[] = [
  {
    title: "Commitments",
    url: "/dashboard/commitments",
    icon: CheckCircle2,
  },
  {
    title: "Decisions",
    url: "/dashboard/decisions",
    icon: BookOpen,
  },
];

// People & Search items
const discoveryNavItems: NavItem[] = [
  {
    title: "People",
    url: "/dashboard/contacts",
    icon: Users,
  },
  {
    title: "Search",
    url: "/dashboard/search",
    icon: Search,
  },
  {
    title: "Analytics",
    url: "/dashboard/analytics",
    icon: BarChart3,
  },
];

// Sources & Settings items
const sourcesNavItems: NavItem[] = [
  {
    title: "Connected Sources",
    url: "/dashboard/sources",
    icon: Link2,
  },
  {
    title: "Email Accounts",
    url: "/dashboard/email-accounts",
    icon: Mail,
  },
  {
    title: "Notifications",
    url: "/dashboard/notifications",
    icon: Bell,
  },
];

// Team management items
const teamNavItems: NavItem[] = [
  {
    title: "Team",
    url: "/dashboard/team",
    icon: Users,
    items: [
      {
        title: "Members",
        url: "/dashboard/team/members",
      },
      {
        title: "Invitations",
        url: "/dashboard/team/invitations",
      },
      {
        title: "Settings",
        url: "/dashboard/team/settings",
      },
    ],
  },
  {
    title: "Billing",
    url: "/dashboard/billing",
    icon: CreditCard,
  },
  {
    title: "Settings",
    url: "/dashboard/settings",
    icon: Settings,
  },
];

// Admin items (only shown to admins)
const adminNavItems: NavItem[] = [
  {
    title: "Admin",
    url: "/admin",
    icon: Shield,
    items: [
      {
        title: "Users",
        url: "/admin/users",
      },
      {
        title: "Organizations",
        url: "/admin/organizations",
      },
      {
        title: "Audit Logs",
        url: "/admin/audit",
      },
    ],
  },
  {
    title: "Audit Log",
    url: "/dashboard/audit-log",
    icon: FileText,
  },
];

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  showAdmin?: boolean;
}

export function AppSidebar({ showAdmin = false, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2">
          <TeamSwitcher />
          <NotificationCenter />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={intelligenceNavItems} label="Intelligence" />
        <NavMain items={memoryNavItems} label="Memory" />
        <NavMain items={discoveryNavItems} label="Discovery" />
        <NavMain items={sourcesNavItems} label="Sources" />
        <NavMain items={teamNavItems} label="Management" />
        {showAdmin && <NavMain items={adminNavItems} label="Administration" />}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
