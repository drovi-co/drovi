import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommitmentRow } from "@/components/commitments";
import { DecisionRow } from "@/components/decisions";
import { TaskVirtualList } from "@/components/tasks";
import { I18nProvider } from "@/i18n";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 40,
    getVirtualItems: () => [{ key: "row-0", index: 0, size: 40, start: 0 }],
  }),
}));

function renderWithI18n(node: ReactNode) {
  return render(<I18nProvider initialLocale="en">{node}</I18nProvider>);
}

describe("proof visibility on core rows", () => {
  it("shows proof tokens for commitment rows", () => {
    renderWithI18n(
      <CommitmentRow
        commitment={{
          id: "c_1",
          title: "Prepare continuity briefing",
          status: "pending",
          priority: "medium",
          direction: "owed_by_me",
          confidence: 0.91,
          dueDate: new Date("2026-02-20T00:00:00.000Z"),
          evidenceCount: 2,
          lastVerifiedAt: new Date("2026-02-18T00:00:00.000Z"),
          supersessionState: "active",
        }}
      />
    );

    expect(screen.getByText("E2")).toBeTruthy();
    expect(screen.getByText("S•")).toBeTruthy();
  });

  it("shows proof tokens for decision rows", () => {
    renderWithI18n(
      <DecisionRow
        decision={{
          id: "d_1",
          title: "Adopt private briefing process",
          statement: "Move all pilot kickoff to private briefing format.",
          decidedAt: new Date("2026-02-15T00:00:00.000Z"),
          confidence: 0.88,
          evidenceCount: 4,
          lastVerifiedAt: new Date("2026-02-16T00:00:00.000Z"),
          supersessionState: "superseding",
        }}
      />
    );

    expect(screen.getByText("E4")).toBeTruthy();
    expect(screen.getByText("S↑")).toBeTruthy();
  });

  it("shows proof tokens for task rows", () => {
    renderWithI18n(
      <TaskVirtualList
        className="h-10"
        groupByStatus={false}
        onPriorityChange={() => undefined}
        onSelectTask={() => undefined}
        onStatusChange={() => undefined}
        onTaskClick={() => undefined}
        selectedIds={new Set()}
        selectedTaskId={null}
        tasks={[
          {
            id: "t_1",
            title: "Publish weekly continuity briefing",
            description: null,
            status: "todo",
            priority: "medium",
            sourceType: "conversation",
            dueDate: null,
            completedAt: null,
            assignee: null,
            labels: [],
            metadata: null,
            createdAt: new Date("2026-02-16T00:00:00.000Z"),
            updatedAt: new Date("2026-02-17T00:00:00.000Z"),
            evidenceCount: 3,
            confidence: 0.83,
            supersessionState: "active",
          },
        ]}
      />
    );

    expect(screen.getByText("E3")).toBeTruthy();
    expect(screen.getByText("C83")).toBeTruthy();
    expect(screen.getByText("S•")).toBeTruthy();
  });
});
