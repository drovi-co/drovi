import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_AGENTS_NAMESPACE, modAgentsI18n } from "./messages";

export function createAgentsModule(): DroviModule {
  return {
    id: "mod-agents",
    title: "Agents",
    capabilities: ["agents.read", "agents.manage", "agents.run"],
    routes: [
      {
        id: "agents.workforces",
        path: "/dashboard/agents/workforces",
        slot: "dashboard",
      },
      {
        id: "agents.studio",
        path: "/dashboard/agents/studio",
        slot: "dashboard",
      },
      {
        id: "agents.runs",
        path: "/dashboard/agents/runs",
        slot: "dashboard",
      },
      {
        id: "agents.catalog",
        path: "/dashboard/agents/catalog",
        slot: "dashboard",
      },
      {
        id: "agents.inbox",
        path: "/dashboard/agents/inbox",
        slot: "dashboard",
      },
    ],
    navItems: [
      {
        id: "agent.workforces",
        label: "Workforces",
        to: "/dashboard/agents/workforces",
        icon: "bot",
        group: "agents",
        order: 10,
        requiresCapability: "agents.read",
      },
      {
        id: "agent.studio",
        label: "Studio",
        to: "/dashboard/agents/studio",
        icon: "wrench",
        group: "agents",
        order: 20,
        requiresCapability: "agents.manage",
      },
      {
        id: "agent.runs",
        label: "Runs",
        to: "/dashboard/agents/runs",
        icon: "activity",
        group: "agents",
        order: 30,
        requiresCapability: "agents.read",
      },
      {
        id: "agent.catalog",
        label: "Catalog",
        to: "/dashboard/agents/catalog",
        icon: "store",
        group: "agents",
        order: 40,
        requiresCapability: "agents.read",
      },
      {
        id: "agent.inbox",
        label: "Inbox",
        to: "/dashboard/agents/inbox",
        icon: "inbox",
        group: "agents",
        order: 50,
        requiresCapability: "agents.read",
      },
    ],
    commands: [
      {
        id: "agents.open_studio",
        title: "Open studio",
        action: "agents.open_studio",
        requiresCapability: "agents.manage",
      },
      {
        id: "agents.open_inbox",
        title: "Open inbox",
        action: "agents.open_inbox",
        requiresCapability: "agents.read",
      },
    ],
    i18n: {
      namespaces: [modAgentsI18n],
    },
    uiHints: {
      namespace: MOD_AGENTS_NAMESPACE,
      internalOnly: false,
    },
  };
}
