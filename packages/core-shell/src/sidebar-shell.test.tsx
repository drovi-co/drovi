import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarShell } from "./sidebar-shell";

describe("SidebarShell", () => {
  it("renders sidebar, top bar, and content", () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
      writable: true,
    });

    render(
      <SidebarShell
        banner={<div>banner</div>}
        sidebar={<div>sidebar</div>}
        topBar={<div>topbar</div>}
      >
        <div>content</div>
      </SidebarShell>
    );

    expect(screen.getByText("banner")).toBeTruthy();
    expect(screen.getByText("sidebar")).toBeTruthy();
    expect(screen.getByText("topbar")).toBeTruthy();
    expect(screen.getByText("content")).toBeTruthy();
  });
});
