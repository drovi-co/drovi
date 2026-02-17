import type { ModuleNavItem, ResolvedDroviModule } from "@memorystack/mod-kit";
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
  type LucideIcon,
  Settings,
  Shield,
  Sparkles,
  Store,
  Terminal,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { useMemo, type ComponentProps } from "react";
import { useT } from "@/i18n";
import { useWebRuntime } from "@/modules/runtime-provider";
import { type NavItem, NavMain } from "./nav-main";
import { NavUser } from "./nav-user";
import { TeamSwitcher } from "./team-switcher";

interface RuntimeNavEntry {
  moduleId: string;
  module: ResolvedDroviModule;
  item: ModuleNavItem;
  group: string;
}

const GROUP_ORDER = [
  "console",
  "memory",
  "discovery",
  "agents",
  "execution",
  "sources",
  "management",
] as const;

const GROUP_LABEL_KEYS: Record<string, string> = {
  console: "nav.groups.console",
  memory: "nav.groups.memory",
  discovery: "nav.groups.discovery",
  agents: "nav.groups.continuums",
  execution: "nav.groups.execution",
  sources: "nav.groups.sources",
  management: "nav.groups.management",
};

const NAV_LABEL_KEYS: Record<string, string> = {
  "console.nav": "nav.items.console",
  "core.reality_stream": "nav.items.realityStream",
  "core.graph": "nav.items.graph",
  "core.commitments": "nav.items.commitments",
  "core.decisions": "nav.items.decisions",
  "core.tasks": "nav.items.tasks",
  "core.schedule": "nav.items.schedule",
  "drive.nav": "nav.items.drive",
  "core.people": "nav.items.people",
  "core.patterns": "nav.items.patterns",
  "agent.workforces": "nav.items.agentWorkforces",
  "agent.studio": "nav.items.agentStudio",
  "agent.runs": "nav.items.agentRuns",
  "agent.catalog": "nav.items.agentCatalog",
  "agent.inbox": "nav.items.agentInbox",
  "core.simulations": "nav.items.simulations",
  "core.actuations": "nav.items.actuations",
  "core.trust": "nav.items.trustAudit",
  "sources.nav": "nav.items.connectedSources",
  "teams.nav": "nav.items.team",
  "teams.members.nav": "nav.items.members",
  "teams.invitations.nav": "nav.items.invitations",
  "teams.settings.nav": "nav.items.settings",
  "core.settings": "nav.items.settings",
};

const ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  "book-open": BookOpen,
  bot: Bot,
  calendar: Calendar,
  "check-circle-2": CheckCircle2,
  "file-text": FileText,
  inbox: Inbox,
  "link-2": Link2,
  "list-todo": ListTodo,
  network: Network,
  settings: Settings,
  shield: Shield,
  sparkles: Sparkles,
  store: Store,
  terminal: Terminal,
  users: Users,
  wrench: Wrench,
  zap: Zap,
};

function compareNavEntries(a: RuntimeNavEntry, b: RuntimeNavEntry): number {
  const aOrder = typeof a.item.order === "number" ? a.item.order : 1000;
  const bOrder = typeof b.item.order === "number" ? b.item.order : 1000;
  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  return a.item.label.localeCompare(b.item.label);
}

function getNavGroup(item: ModuleNavItem, module: ResolvedDroviModule): string {
  if (typeof item.group === "string" && item.group.length > 0) {
    return item.group;
  }
  if (
    module.uiHints &&
    typeof module.uiHints.navGroup === "string" &&
    module.uiHints.navGroup.length > 0
  ) {
    return module.uiHints.navGroup;
  }
  return "management";
}

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const t = useT();
  const { modules, navLabels, hiddenNavItemIds } = useWebRuntime();

  const hiddenSet = useMemo(() => new Set(hiddenNavItemIds), [hiddenNavItemIds]);

  const groupedItems = useMemo(() => {
    const entries: RuntimeNavEntry[] = [];
    for (const module of modules) {
      for (const item of module.navItems) {
        if (hiddenSet.has(item.id)) {
          continue;
        }
        entries.push({
          moduleId: module.id,
          module,
          item,
          group: getNavGroup(item, module),
        });
      }
    }

    const byId = new Map(entries.map((entry) => [entry.item.id, entry]));
    const childrenByParent = new Map<string, RuntimeNavEntry[]>();
    for (const entry of entries) {
      if (!entry.item.parentId) {
        continue;
      }
      if (!byId.has(entry.item.parentId)) {
        continue;
      }
      const children = childrenByParent.get(entry.item.parentId) ?? [];
      children.push(entry);
      childrenByParent.set(entry.item.parentId, children);
    }

    const topLevel = entries
      .filter((entry) => !entry.item.parentId || !byId.has(entry.item.parentId))
      .sort(compareNavEntries);

    const groups = new Map<string, NavItem[]>();
    for (const entry of topLevel) {
      const defaultLabelKey = NAV_LABEL_KEYS[entry.item.id];
      const fallbackLabel = defaultLabelKey ? t(defaultLabelKey) : entry.item.label;
      const itemLabel = navLabels[entry.item.id] ?? fallbackLabel;
      const itemIcon = entry.item.icon ? ICONS[entry.item.icon] : undefined;
      const childEntries = (childrenByParent.get(entry.item.id) ?? []).sort(
        compareNavEntries
      );

      const navItem: NavItem = {
        id: entry.item.id,
        title: itemLabel,
        url: entry.item.to,
        icon: itemIcon,
        items:
          childEntries.length > 0
            ? childEntries.map((child) => {
                const childDefaultLabelKey = NAV_LABEL_KEYS[child.item.id];
                const childFallback = childDefaultLabelKey
                  ? t(childDefaultLabelKey)
                  : child.item.label;
                return {
                  id: child.item.id,
                  title: navLabels[child.item.id] ?? childFallback,
                  url: child.item.to,
                };
              })
            : undefined,
      };

      const current = groups.get(entry.group) ?? [];
      current.push(navItem);
      groups.set(entry.group, current);
    }

    const ordered = Array.from(groups.entries()).sort(([groupA], [groupB]) => {
      const aIndex = GROUP_ORDER.indexOf(groupA as (typeof GROUP_ORDER)[number]);
      const bIndex = GROUP_ORDER.indexOf(groupB as (typeof GROUP_ORDER)[number]);
      const normalizedA = aIndex === -1 ? Number.POSITIVE_INFINITY : aIndex;
      const normalizedB = bIndex === -1 ? Number.POSITIVE_INFINITY : bIndex;
      if (normalizedA !== normalizedB) {
        return normalizedA - normalizedB;
      }
      return groupA.localeCompare(groupB);
    });

    return ordered.map(([groupId, items]) => ({
      id: groupId,
      label: GROUP_LABEL_KEYS[groupId] ? t(GROUP_LABEL_KEYS[groupId]) : groupId,
      items,
    }));
  }, [hiddenSet, modules, navLabels, t]);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="gap-2 border-sidebar-border/70 border-b px-2 py-3">
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {groupedItems.map((group) => (
          <NavMain items={group.items} key={group.id} label={group.label} />
        ))}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
