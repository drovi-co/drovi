import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n";
import type { TaskPriority, TaskStatus } from "./task-types";
import { TaskVirtualList } from "./task-virtual-list";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 40,
    getVirtualItems: () => [{ key: "row-0", index: 0, size: 40, start: 0 }],
  }),
}));

function renderWithI18n(node: ReactNode) {
  return render(<I18nProvider initialLocale="en">{node}</I18nProvider>);
}

function renderSubject(overrides?: {
  onStatusChange?: (id: string, status: TaskStatus) => void;
  onPriorityChange?: (id: string, priority: TaskPriority) => void;
  onStar?: (id: string) => void;
  onArchive?: (id: string) => void;
}) {
  const onStatusChange = overrides?.onStatusChange ?? vi.fn();
  const onPriorityChange = overrides?.onPriorityChange ?? vi.fn();
  const onStar = overrides?.onStar ?? vi.fn();
  const onArchive = overrides?.onArchive ?? vi.fn();

  renderWithI18n(
    <TaskVirtualList
      className="h-10"
      groupByStatus={false}
      onArchive={onArchive}
      onPriorityChange={onPriorityChange}
      onSelectTask={() => undefined}
      onStar={onStar}
      onStatusChange={onStatusChange}
      onTaskClick={() => undefined}
      selectedIds={new Set()}
      selectedTaskId={null}
      tasks={[
        {
          id: "t_1",
          title: "Prepare weekly report",
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
          evidenceCount: 1,
          confidence: 0.7,
          supersessionState: "active",
        },
      ]}
    />
  );

  return {
    onStatusChange,
    onPriorityChange,
    onStar,
    onArchive,
  };
}

describe("TaskVirtualList", () => {
  it("invokes star and archive callbacks", () => {
    const { onStar, onArchive } = renderSubject();

    fireEvent.click(screen.getByRole("button", { name: /star/i }));
    fireEvent.click(screen.getByRole("button", { name: /archive/i }));

    expect(onStar).toHaveBeenCalledWith("t_1");
    expect(onArchive).toHaveBeenCalledWith("t_1");
  });

  it("invokes priority callback when a priority option is chosen", async () => {
    const { onPriorityChange } = renderSubject();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /change priority/i }));
    const items = await screen.findAllByRole("menuitem");
    await user.click(items[0] as HTMLElement);

    expect(onPriorityChange).toHaveBeenCalledWith("t_1", "urgent");
  });

  it("invokes status callback when a status option is chosen", async () => {
    const { onStatusChange } = renderSubject();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /change status/i }));
    const items = await screen.findAllByRole("menuitem");
    await user.click(items[0] as HTMLElement);

    expect(onStatusChange).toHaveBeenCalledWith("t_1", "backlog");
  });
});
