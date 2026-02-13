import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EvidenceLens } from "./evidence-lens";

describe("EvidenceLens", () => {
  it("renders evidence items and triggers source open callback", () => {
    const onOpenSource = vi.fn();

    render(
      <EvidenceLens
        items={[
          {
            id: "ev_1",
            title: "Client asked for timeline confirmation",
            quote: "Can you confirm this by Friday?",
            sourceLabel: "Email",
            confidence: 0.91,
          },
        ]}
        onOpenSource={onOpenSource}
      />
    );

    expect(
      screen.getByText("Client asked for timeline confirmation")
    ).toBeTruthy();
    expect(screen.getByText('"Can you confirm this by Friday?"')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open source" }));
    expect(onOpenSource).toHaveBeenCalledTimes(1);
  });

  it("shows empty state", () => {
    render(<EvidenceLens emptyState="Nothing to inspect" items={[]} />);
    expect(screen.getByText("Nothing to inspect")).toBeTruthy();
  });
});
