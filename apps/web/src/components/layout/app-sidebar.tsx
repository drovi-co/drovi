import {
  Activity,
  BookOpen,
  Calendar,
  CheckCircle2,
  FileText,
  Link2,
  ListTodo,
  Mail,
  Network,
  Shield,
  Settings,
  Sparkles,
  Store,
  Terminal,
  Users,
  Zap,
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
    title: "Reality Stream",
    url: "/dashboard/reality-stream",
    icon: Activity,
  },
  {
    title: "Graph",
    url: "/dashboard/graph",
    icon: Network,
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
  {
    title: "Tasks",
    url: "/dashboard/tasks",
    icon: ListTodo,
  },
  {
    title: "Schedule",
    url: "/dashboard/schedule",
    icon: Calendar,
  },
];

// People and discovery
const discoveryNavItems: NavItem[] = [
  {
    title: "People",
    url: "/dashboard/contacts",
    icon: Users,
  },
  {
    title: "Patterns",
    url: "/dashboard/patterns",
    icon: Sparkles,
  },
];

// Continuums and execution
const continuumNavItems: NavItem[] = [
  {
    title: "Continuums",
    url: "/dashboard/continuums",
    icon: Sparkles,
  },
  {
    title: "Builder",
    url: "/dashboard/builder",
    icon: FileText,
  },
  {
    title: "Exchange",
    url: "/dashboard/exchange",
    icon: Store,
  },
];

const executionNavItems: NavItem[] = [
  {
    title: "Simulations",
    url: "/dashboard/simulations",
    icon: Activity,
  },
  {
    title: "Actuations",
    url: "/dashboard/actuations",
    icon: Zap,
  },
  {
    title: "Trust & Audit",
    url: "/dashboard/trust",
    icon: Shield,
  },
];

// Sources items
const sourcesNavItems: NavItem[] = [
  {
    title: "Connected Sources",
    url: "/dashboard/sources",
    icon: Link2,
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

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center">
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={consoleNavItems} label="Console" />
        <NavMain items={memoryNavItems} label="Memory" />
        <NavMain items={discoveryNavItems} label="Discovery" />
        <NavMain items={continuumNavItems} label="Continuums" />
        <NavMain items={executionNavItems} label="Execution" />
        <NavMain items={sourcesNavItems} label="Sources" />
        <NavMain items={teamNavItems} label="Management" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
