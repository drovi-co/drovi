import type { ResolvedDroviModule } from "@memorystack/mod-kit";
import { describe, expect, it } from "vitest";
import {
  composeModuleRoutePlan,
  composeModuleRuntime,
  composeTanStackRouteTree,
} from "./compose";

const MODULES: ResolvedDroviModule[] = [
  {
    id: "mod-auth",
    title: "Auth",
    capabilities: ["auth.read"],
    routes: [
      {
        id: "auth.login",
        path: "/login",
        slot: "auth",
        enabledByDefault: true,
      },
      {
        id: "auth.reset",
        path: "/reset",
        slot: "auth",
        enabledByDefault: false,
      },
    ],
    navItems: [{ id: "auth.nav", label: "Login", to: "/login" }],
    commands: [{ id: "auth.cmd", title: "Open login", action: "auth.open" }],
    i18n: { namespaces: [] },
    uiHints: {},
  },
  {
    id: "mod-drive",
    title: "Drive",
    capabilities: ["drive.read"],
    routes: [
      {
        id: "drive.home",
        path: "/drive",
        slot: "dashboard",
        enabledByDefault: true,
      },
    ],
    navItems: [{ id: "drive.nav", label: "Drive", to: "/drive" }],
    commands: [{ id: "drive.upload", title: "Upload", action: "drive.upload" }],
    i18n: { namespaces: [] },
    uiHints: {},
  },
];

describe("composeModuleRoutePlan", () => {
  it("keeps module routes and slots for code-based router composition", () => {
    const plan = composeModuleRoutePlan({
      modules: MODULES,
    });
    expect(plan.entries.map((entry) => entry.routeId)).toEqual([
      "auth.login",
      "auth.reset",
      "drive.home",
    ]);
    expect(
      plan.entries.find((entry) => entry.routeId === "drive.home")?.slot
    ).toBe("dashboard");
  });
});

describe("composeModuleRuntime", () => {
  it("derives runtime registries used by nav and command bar", () => {
    const runtime = composeModuleRuntime({ modules: MODULES });
    expect(runtime.paths).toContain("/login");
    expect(runtime.paths).toContain("/drive");
    expect(runtime.navIds).toEqual(["auth.nav", "drive.nav"]);
    expect(runtime.commandIds).toEqual(["auth.cmd", "drive.upload"]);
  });
});

describe("composeTanStackRouteTree", () => {
  it("attaches routes to slot parents and skips disabled-by-default routes", () => {
    type FakeRoute = {
      id: string;
      children: string[];
    };

    const root: FakeRoute = { id: "root", children: [] };
    const authParent: FakeRoute = { id: "auth", children: [] };
    const dashboardParent: FakeRoute = { id: "dashboard", children: [] };

    const plan = composeModuleRoutePlan({ modules: MODULES });
    const composed = composeTanStackRouteTree<FakeRoute>({
      rootRoute: root,
      slotParents: {
        auth: authParent,
        dashboard: dashboardParent,
      },
      plan,
      createRoute(entry) {
        return {
          id: entry.routeId,
          children: [],
        };
      },
      addChildren(parent, children) {
        return {
          ...parent,
          children: [...parent.children, ...children.map((child) => child.id)],
        };
      },
    });

    expect(composed.id).toBe("root");
    expect(authParent.children).toEqual([]);
    expect(dashboardParent.children).toEqual([]);
    // `composeTanStackRouteTree` returns updated parent objects; in a real
    // router integration those are fed back into the tree builder.
    // This test checks the generated attachments instead.
    const attached = composeTanStackRouteTree<FakeRoute>({
      rootRoute: root,
      slotParents: { auth: root, dashboard: root },
      plan,
      createRoute(entry) {
        return { id: entry.routeId, children: [] };
      },
      addChildren(parent, children) {
        return {
          ...parent,
          children: [...parent.children, ...children.map((child) => child.id)],
        };
      },
    });
    expect(attached.children).toEqual(["auth.login", "drive.home"]);
  });
});
