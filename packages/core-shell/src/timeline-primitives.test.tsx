import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelinePrimitives } from "./timeline-primitives";

describe("TimelinePrimitives", () => {
  it("renders events and handles source action", () => {
    const onOpenSource = vi.fn();
    render(
      <TimelinePrimitives
        events={[
          {
            id: "tl_1",
            title: "Advice updated",
            description: "New clause language approved",
            timestampLabel: "Feb 12, 2026",
            sourceLabel: "Email",
            quote: "Use the revised indemnity language.",
          },
        ]}
        onOpenSource={onOpenSource}
      />
    );

    expect(screen.getByText("Advice updated")).toBeTruthy();
    expect(screen.getByText("New clause language approved")).toBeTruthy();
    expect(
      screen.getByText('"Use the revised indemnity language."')
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View source" }));
    expect(onOpenSource).toHaveBeenCalledTimes(1);
  });

  it("renders empty state", () => {
    render(<TimelinePrimitives emptyState="No history yet" events={[]} />);
    expect(screen.getByText("No history yet")).toBeTruthy();
  });
});
