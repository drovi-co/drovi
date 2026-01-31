import {
  BookOpen,
  Calendar,
  CheckCircle2,
  FileText,
  Link2,
  ListTodo,
  Mail,
  Network,
  Settings,
  Shield,
  Terminal,
  Users,
} from "lucide-react";
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

// Console - Primary Intelligence View (Datadog-like)
const consoleNavItems: NavItem[] = [
  {
    title: "Console",
    url: "/dashboard/console",
    icon: Terminal,
  },
  {
    title: "Graph",
    url: "/dashboard/graph",
    icon: Network,
  },
];

// Intelligence navigation items (Drovi - Multi-Source)
const intelligenceNavItems: NavItem[] = [
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

// People items
const discoveryNavItems: NavItem[] = [
  {
    title: "People",
    url: "/dashboard/contacts",
    icon: Users,
  },
];

// Sources items
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
      <SidebarHeader className="h-14 justify-center">
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={consoleNavItems} label="Console" />
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
