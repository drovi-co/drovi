import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/lib/auth";
import { useWebRuntime, WebRuntimeProvider } from "./runtime-provider";

function RuntimeProbe() {
  const runtime = useWebRuntime();
  return (
    <div>
      <div data-testid="modules">{runtime.modules.map((m) => m.id).join(",")}</div>
      <div data-testid="theme">{runtime.themePackId}</div>
      <div data-testid="vocabulary-project">{runtime.vocabulary.project ?? ""}</div>
      <div data-testid="type-label-matter">
        {runtime.typeLabels["legal.matter"] ?? ""}
      </div>
      <div data-testid="nav-label-commitments">
        {runtime.navLabels["core.commitments"] ?? ""}
      </div>
      <div data-testid="hidden-nav">{runtime.hiddenNavItemIds.join(",")}</div>
    </div>
  );
}

describe("WebRuntimeProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses default module runtime when user is not authenticated", async () => {
    render(
      <WebRuntimeProvider>
        <RuntimeProbe />
      </WebRuntimeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("modules").textContent).toContain("mod-drive");
    });
    expect(screen.getByTestId("theme").textContent).toBe("institutional");
  });

  it("applies manifest-driven module gates, navigation and vocabulary", async () => {
    useAuthStore.setState({
      user: {
        user_id: "usr_1",
        org_id: "org_legal",
        org_name: "Drovi Legal",
        role: "pilot_owner",
        email: "jeremy@drovi.co",
        exp: new Date(Date.now() + 86_400_000).toISOString(),
      } as any,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });

    const manifest = {
      plugins: ["core", "legal"],
      uio_types: [],
      extension_types: [],
      capabilities: {
        "console.read": true,
        "sources.read": true,
      },
      ui_hints: {
        vertical: "legal",
        modules: {
          "mod-drive": {
            enabled: false,
          },
        },
        navigation: {
          labels: {
            "core.commitments": "Mandate Register",
          },
          hidden_nav_items: ["agent.catalog"],
        },
        vocabulary: {
          project: "Matter",
        },
        type_labels: {
          "legal.matter": "Matter",
        },
      },
      storage_rules: {
        canonical_spine_table: "unified_intelligence_object",
        extension_payload_table: "uio_extension_payload",
        typed_tables: {},
      },
    };

    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: {
          ETag: "manifest-etag-1",
          "Content-Type": "application/json",
        },
      });
    }) as typeof global.fetch;

    render(
      <WebRuntimeProvider>
        <RuntimeProbe />
      </WebRuntimeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("modules").textContent).not.toContain(
        "mod-drive"
      );
    });

    expect(screen.getByTestId("theme").textContent).toBe("legal");
    expect(screen.getByTestId("vocabulary-project").textContent).toBe("Matter");
    expect(screen.getByTestId("type-label-matter").textContent).toBe("Matter");
    expect(screen.getByTestId("nav-label-commitments").textContent).toBe(
      "Mandate Register"
    );
    expect(screen.getByTestId("hidden-nav").textContent).toContain(
      "agent.catalog"
    );
  });
});
