import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@memorystack/ui-core/sidebar";
import {
  Activity,
  BookOpen,
  Bot,
  Calendar,
  CheckCircle2,
  FileText,
  Inbox,
  Link2,
  ListTodo,
  Network,
  Settings,
  Shield,
  Sparkles,
  Store,
  Terminal,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { useT } from "@/i18n";
import { type NavItem, NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { TeamSwitcher } from "./team-switcher";

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const t = useT();

  // Console - Primary Intelligence View (Datadog-like)
  const consoleNavItems: NavItem[] = [
    {
      title: t("nav.items.console"),
      url: "/dashboard/console",
      icon: Terminal,
    },
    {
      title: t("nav.items.realityStream"),
      url: "/dashboard/reality-stream",
      icon: Activity,
    },
    {
      title: t("nav.items.graph"),
      url: "/dashboard/graph",
      icon: Network,
    },
  ];

  // Memory & Intelligence items
  const memoryNavItems: NavItem[] = [
    {
      title: t("nav.items.commitments"),
      url: "/dashboard/commitments",
      icon: CheckCircle2,
    },
    {
      title: t("nav.items.decisions"),
      url: "/dashboard/decisions",
      icon: BookOpen,
    },
    {
      title: t("nav.items.tasks"),
      url: "/dashboard/tasks",
      icon: ListTodo,
    },
    {
      title: t("nav.items.schedule"),
      url: "/dashboard/schedule",
      icon: Calendar,
    },
    {
      title: t("nav.items.drive"),
      url: "/dashboard/drive",
      icon: FileText,
    },
  ];

  // People and discovery
  const discoveryNavItems: NavItem[] = [
    {
      title: t("nav.items.people"),
      url: "/dashboard/contacts",
      icon: Users,
    },
    {
      title: t("nav.items.patterns"),
      url: "/dashboard/patterns",
      icon: Sparkles,
    },
  ];

  // AgentOS surfaces
  const agentNavItems: NavItem[] = [
    {
      title: t("nav.items.agentWorkforces"),
      url: "/dashboard/agents/workforces",
      icon: Bot,
    },
    {
      title: t("nav.items.agentStudio"),
      url: "/dashboard/agents/studio",
      icon: Wrench,
    },
    {
      title: t("nav.items.agentRuns"),
      url: "/dashboard/agents/runs",
      icon: Activity,
    },
    {
      title: t("nav.items.agentCatalog"),
      url: "/dashboard/agents/catalog",
      icon: Store,
    },
    {
      title: t("nav.items.agentInbox"),
      url: "/dashboard/agents/inbox",
      icon: Inbox,
    },
  ];

  const executionNavItems: NavItem[] = [
    {
      title: t("nav.items.simulations"),
      url: "/dashboard/simulations",
      icon: Activity,
    },
    {
      title: t("nav.items.actuations"),
      url: "/dashboard/actuations",
      icon: Zap,
    },
    {
      title: t("nav.items.trustAudit"),
      url: "/dashboard/trust",
      icon: Shield,
    },
  ];

  // Sources items
  const sourcesNavItems: NavItem[] = [
    {
      title: t("nav.items.connectedSources"),
      url: "/dashboard/sources",
      icon: Link2,
    },
  ];

  // Team management items
  const teamNavItems: NavItem[] = [
    {
      title: t("nav.items.team"),
      url: "/dashboard/team",
      icon: Users,
      items: [
        {
          title: t("nav.items.members"),
          url: "/dashboard/team/members",
        },
        {
          title: t("nav.items.invitations"),
          url: "/dashboard/team/invitations",
        },
        {
          title: t("nav.items.settings"),
          url: "/dashboard/team/settings",
        },
      ],
    },
    {
      title: t("nav.items.settings"),
      url: "/dashboard/settings",
      icon: Settings,
    },
  ];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center">
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={consoleNavItems} label={t("nav.groups.console")} />
        <NavMain items={memoryNavItems} label={t("nav.groups.memory")} />
        <NavMain items={discoveryNavItems} label={t("nav.groups.discovery")} />
        <NavMain items={agentNavItems} label={t("nav.groups.continuums")} />
        <NavMain items={executionNavItems} label={t("nav.groups.execution")} />
        <NavMain items={sourcesNavItems} label={t("nav.groups.sources")} />
        <NavMain items={teamNavItems} label={t("nav.groups.management")} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
