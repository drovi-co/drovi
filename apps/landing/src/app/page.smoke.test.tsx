import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/landing/navigation", () => ({
  Navigation: ({ onRequestAccess }: { onRequestAccess?: () => void }) => (
    <button onClick={onRequestAccess} type="button">
      nav-request
    </button>
  ),
}));
vi.mock("@/components/landing/hero", () => ({
  Hero: ({
    onWatchDemo,
    onRequestAccess,
  }: {
    onWatchDemo?: () => void;
    onRequestAccess?: () => void;
  }) => (
    <div>
      <button onClick={onWatchDemo} type="button">
        watch-demo
      </button>
      <button onClick={onRequestAccess} type="button">
        hero-request
      </button>
    </div>
  ),
}));
vi.mock("@/components/landing/problem-solution", () => ({
  ProblemSolution: () => <div>problem-solution</div>,
}));
vi.mock("@/components/landing/how-it-works", () => ({
  HowItWorks: () => <div>how-it-works</div>,
}));
vi.mock("@/components/landing/agents", () => ({ Agents: () => <div>agents</div> }));
vi.mock("@/components/landing/features", () => ({
  Features: () => <div>features</div>,
}));
vi.mock("@/components/landing/world-brain-signal", () => ({
  WorldBrainSignal: () => <div>world-brain-signal</div>,
}));
vi.mock("@/components/landing/world-brain-capabilities", () => ({
  WorldBrainCapabilities: () => <div>world-brain-capabilities</div>,
}));
vi.mock("@/components/landing/testimonial", () => ({
  Testimonial: () => <div>testimonial</div>,
}));
vi.mock("@/components/landing/pricing", () => ({
  Pricing: ({ onRequestAccess }: { onRequestAccess?: () => void }) => (
    <button onClick={onRequestAccess} type="button">
      pricing-request
    </button>
  ),
}));
vi.mock("@/components/landing/cta", () => ({
  CTA: ({ onRequestAccess }: { onRequestAccess?: () => void }) => (
    <button onClick={onRequestAccess} type="button">
      cta-request
    </button>
  ),
}));
vi.mock("@/components/landing/footer", () => ({ Footer: () => <div>footer</div> }));
vi.mock("@/components/waitlist/waitlist-dialog", () => ({
  WaitlistDialog: ({ open }: { open?: boolean }) => (
    <div data-open={open ? "true" : "false"} data-testid="waitlist-dialog" />
  ),
}));
vi.mock("@/components/landing/demo-modal", () => ({
  DemoModal: ({ open }: { open?: boolean }) => (
    <div data-open={open ? "true" : "false"} data-testid="demo-modal" />
  ),
}));

import LandingPage from "./page";

describe("Landing page smoke", () => {
  it("toggles watch-demo and request-access modal states", async () => {
    const user = userEvent.setup();
    render(<LandingPage />);

    expect(screen.getByTestId("demo-modal").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("waitlist-dialog").getAttribute("data-open")).toBe(
      "false"
    );

    await user.click(screen.getByRole("button", { name: "watch-demo" }));
    expect(screen.getByTestId("demo-modal").getAttribute("data-open")).toBe("true");

    await user.click(screen.getByRole("button", { name: "hero-request" }));
    expect(screen.getByTestId("demo-modal").getAttribute("data-open")).toBe("false");
    expect(screen.getByTestId("waitlist-dialog").getAttribute("data-open")).toBe(
      "true"
    );
  });
});
