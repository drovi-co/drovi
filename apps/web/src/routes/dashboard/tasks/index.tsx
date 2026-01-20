// =============================================================================
// TASKS PAGE (Linear-style Task Management)
// =============================================================================
//
// The unified command center for all actionable items. Every conversation,
// commitment, and decision automatically appears here as a task. Users can
// organize, prioritize, and track progress on everything in one place.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Gavel,
  Handshake,
  Kanban,
  List,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SourceIcon } from "@/components/inbox/source-icon";
// Import shared task components
import {
  formatDueDate,
  PRIORITY_CONFIG,
  STATUS_CONFIG,
  type TaskData,
  TaskKanbanBoard,
  type TaskPriority,
  type TaskSourceType,
  type TaskStatus,
} from "@/components/tasks";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { type Priority, PriorityIcon } from "@/components/ui/priority-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { type Status, StatusIcon } from "@/components/ui/status-icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import type { SourceType } from "@/lib/source-config";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// FIXED COLUMN WIDTHS (matching inbox-row.tsx)
// =============================================================================

const COL = {
  checkbox: "w-7", // 28px
  priority: "w-7", // 28px
  source: "w-6", // 24px
  status: "w-7", // 28px
  taskId: "w-[120px]", // 120px - matches sender column in inbox
} as const;

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/tasks/")({
  component: TasksPage,
});

// =============================================================================
// TYPES
// =============================================================================

type ViewMode = "list" | "kanban";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function TasksPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | "all">(
    "all"
  );
  const [sourceTypeFilter, setSourceTypeFilter] = useState<
    TaskSourceType | "all"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch tasks - no limit since we have client-side pagination with "Show more"
  const {
    data: tasksData,
    isLoading: isLoadingTasks,
    refetch,
  } = useQuery({
    ...trpc.tasks.list.queryOptions({
      organizationId,
      status: statusFilter === "all" ? undefined : statusFilter,
      priority: priorityFilter === "all" ? undefined : priorityFilter,
      sourceType: sourceTypeFilter === "all" ? undefined : sourceTypeFilter,
      search: searchQuery || undefined,
      // Sort by due date (nearest first) so urgent tasks appear at top
      sortBy: "dueDate",
      sortOrder: "asc",
    }),
    enabled: !!organizationId,
  });

  // Fetch stats
  const { data: statsData } = useQuery({
    ...trpc.tasks.getStats.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Mutations - use proper tRPC query key pattern [["tasks"]] for invalidation
  const updateStatusMutation = useMutation({
    ...trpc.tasks.updateStatus.mutationOptions(),
    onSuccess: () => {
      toast.success("Status updated");
      refetch();
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });
    },
    onError: () => {
      toast.error("Failed to update status");
    },
  });

  const updatePriorityMutation = useMutation({
    ...trpc.tasks.updatePriority.mutationOptions(),
    onSuccess: () => {
      toast.success("Priority updated");
      refetch();
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });
    },
    onError: () => {
      toast.error("Failed to update priority");
    },
  });

  // Navigate to task detail page
  const handleOpenTask = useCallback(
    (taskId: string) => {
      navigate({ to: "/dashboard/tasks/$taskId", params: { taskId } });
    },
    [navigate]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // j/k navigation
      if (e.key === "j" || e.key === "k") {
        const tasksList = tasksData?.tasks ?? [];
        const currentIndex = tasksList.findIndex(
          (t) => t.id === selectedTaskId
        );
        if (e.key === "j" && currentIndex < tasksList.length - 1) {
          setSelectedTaskId(tasksList[currentIndex + 1]?.id ?? null);
        }
        if (e.key === "k" && currentIndex > 0) {
          setSelectedTaskId(tasksList[currentIndex - 1]?.id ?? null);
        }
      }

      // Enter to open detail page
      if (e.key === "Enter" && selectedTaskId) {
        e.preventDefault();
        handleOpenTask(selectedTaskId);
      }

      // r to refresh
      if (e.key === "r" && !e.metaKey && !e.ctrlKey) {
        refetch();
      }

      // v to toggle view
      if (e.key === "v") {
        setViewMode((v) => (v === "list" ? "kanban" : "list"));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tasksData, selectedTaskId, refetch, handleOpenTask]);

  // Handlers
  const handleStatusChange = useCallback(
    (taskId: string, newStatus: TaskStatus) => {
      updateStatusMutation.mutate({
        organizationId,
        taskId,
        status: newStatus,
      });
    },
    [updateStatusMutation, organizationId]
  );

  const handlePriorityChange = useCallback(
    (taskId: string, newPriority: TaskPriority) => {
      updatePriorityMutation.mutate({
        organizationId,
        taskId,
        priority: newPriority,
      });
    },
    [updatePriorityMutation, organizationId]
  );

  const handleStar = useCallback((_taskId: string) => {
    // Tasks don't have a native star feature
    // Show info message suggesting to use priority instead
    toast.info("Use priority levels to highlight important tasks");
  }, []);

  const handleArchive = useCallback(
    (taskId: string) => {
      // Archive by setting status to cancelled
      updateStatusMutation.mutate({
        organizationId,
        taskId,
        status: "cancelled",
      });
      toast.success("Task archived");
    },
    [updateStatusMutation, organizationId]
  );

  const handleSelectTask = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedIds(new Set(tasksData?.tasks?.map((t) => t.id) ?? []));
      } else {
        setSelectedIds(new Set());
      }
    },
    [tasksData]
  );

  // Transform tasks data
  const tasks: TaskData[] = (tasksData?.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    sourceType: t.sourceType as TaskSourceType,
    dueDate: t.dueDate ? new Date(t.dueDate) : null,
    completedAt: (t as { completedAt?: string | Date | null }).completedAt
      ? new Date(
          (t as { completedAt?: string | Date }).completedAt as string | Date
        )
      : null,
    assignee: t.assignee,
    labels: t.labels ?? [],
    metadata: t.metadata,
    createdAt: new Date(t.createdAt),
    updatedAt: new Date(t.updatedAt),
  }));

  // Group tasks by status for list view
  const tasksByStatus = tasks.reduce(
    (acc, task) => {
      if (!acc[task.status]) {
        acc[task.status] = [];
      }
      acc[task.status].push(task);
      return acc;
    },
    {} as Record<TaskStatus, TaskData[]>
  );

  const stats = statsData ?? {
    total: 0,
    byStatus: {} as Record<TaskStatus, number>,
    byPriority: {} as Record<TaskPriority, number>,
    bySourceType: {} as Record<TaskSourceType, number>,
    overdueCount: 0,
    dueThisWeek: 0,
  };

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          Select an organization to view tasks
        </p>
      </div>
    );
  }

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* Status Tabs */}
            <Tabs
              onValueChange={(v) => setStatusFilter(v as TaskStatus | "all")}
              value={statusFilter}
            >
              <TabsList className="h-8 gap-1 bg-transparent">
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="all"
                >
                  All
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.total}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="backlog"
                >
                  Backlog
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.byStatus?.backlog ?? 0}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="todo"
                >
                  Todo
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.byStatus?.todo ?? 0}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="in_progress"
                >
                  In Progress
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.byStatus?.in_progress ?? 0}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="done"
                >
                  Done
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.byStatus?.done ?? 0}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Source Type Filter */}
              <Select
                onValueChange={(v) =>
                  setSourceTypeFilter(v as TaskSourceType | "all")
                }
                value={sourceTypeFilter}
              >
                <SelectTrigger className="h-8 w-[130px] text-sm">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  <SelectItem value="conversation">Conversations</SelectItem>
                  <SelectItem value="commitment">Commitments</SelectItem>
                  <SelectItem value="decision">Decisions</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>

              {/* Priority Filter */}
              <Select
                onValueChange={(v) =>
                  setPriorityFilter(v as TaskPriority | "all")
                }
                value={priorityFilter}
              >
                <SelectTrigger className="h-8 w-[110px] text-sm">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priority</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="no_priority">No Priority</SelectItem>
                </SelectContent>
              </Select>

              {/* Search */}
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 w-[180px] pl-8 text-sm"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tasks..."
                  value={searchQuery}
                />
              </div>

              {/* View Toggle */}
              <div className="flex items-center gap-0.5 rounded-md border p-0.5">
                <Button
                  className="h-7 w-7"
                  onClick={() => setViewMode("list")}
                  size="icon"
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  className="h-7 w-7"
                  onClick={() => setViewMode("kanban")}
                  size="icon"
                  variant={viewMode === "kanban" ? "secondary" : "ghost"}
                >
                  <Kanban className="h-4 w-4" />
                </Button>
              </div>

              <Button
                className="h-8 w-8"
                onClick={() => refetch()}
                size="icon"
                variant="ghost"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              {/* Keyboard hints */}
              <div className="hidden items-center gap-2 text-muted-foreground text-xs lg:flex">
                <kbd className="rounded bg-muted px-1.5 py-0.5">j/k</kbd>
                <span>nav</span>
                <kbd className="rounded bg-muted px-1.5 py-0.5">v</kbd>
                <span>view</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {isLoadingTasks ? (
            <TaskListSkeleton />
          ) : viewMode === "list" ? (
            tasks.length === 0 ? (
              <TaskEmptyState />
            ) : (
              <TaskListView
                onArchive={handleArchive}
                onPriorityChange={handlePriorityChange}
                onSelectAll={handleSelectAll}
                onSelectTask={handleSelectTask}
                onStar={handleStar}
                onStatusChange={handleStatusChange}
                onTaskClick={(id) => {
                  setSelectedTaskId(id);
                  handleOpenTask(id);
                }}
                selectedIds={selectedIds}
                selectedTaskId={selectedTaskId}
                showGroupHeaders={statusFilter === "all"}
                tasks={tasks}
                tasksByStatus={tasksByStatus}
              />
            )
          ) : (
            <TaskKanbanBoard
              columns={["backlog", "todo", "in_progress", "in_review", "done"]}
              onTaskClick={(id) => {
                setSelectedTaskId(id);
                handleOpenTask(id);
              }}
              organizationId={organizationId}
              tasks={tasks}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// TASK LIST VIEW
// =============================================================================

// Items to show per section by default
const ITEMS_PER_SECTION = 10;

interface TaskListViewProps {
  tasks: TaskData[];
  tasksByStatus: Record<TaskStatus, TaskData[]>;
  selectedTaskId: string | null;
  selectedIds: Set<string>;
  onSelectTask: (id: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  onTaskClick: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onPriorityChange: (id: string, priority: TaskPriority) => void;
  onStar: (id: string) => void;
  onArchive: (id: string) => void;
  showGroupHeaders: boolean;
}

function TaskListView({
  tasks,
  tasksByStatus,
  selectedTaskId,
  selectedIds,
  onSelectTask,
  onSelectAll,
  onTaskClick,
  onStatusChange,
  onPriorityChange,
  onStar,
  onArchive,
  showGroupHeaders,
}: TaskListViewProps) {
  const statusOrder: TaskStatus[] = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
    "cancelled",
  ];

  // Collapsed state for each section (backlog collapsed by default)
  const [collapsedSections, setCollapsedSections] = useState<Set<TaskStatus>>(
    new Set(["backlog"])
  );

  // Expanded items count per section (for pagination)
  const [expandedCounts, setExpandedCounts] = useState<
    Record<TaskStatus, number>
  >({
    backlog: ITEMS_PER_SECTION,
    todo: ITEMS_PER_SECTION,
    in_progress: ITEMS_PER_SECTION,
    in_review: ITEMS_PER_SECTION,
    done: ITEMS_PER_SECTION,
    cancelled: ITEMS_PER_SECTION,
  });

  const toggleSection = useCallback((status: TaskStatus) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  const showMoreItems = useCallback((status: TaskStatus) => {
    setExpandedCounts((prev) => ({
      ...prev,
      [status]: prev[status] + ITEMS_PER_SECTION,
    }));
  }, []);

  // Pagination state for flat list view - MUST be before any early returns
  const [flatListVisibleCount, setFlatListVisibleCount] = useState(
    ITEMS_PER_SECTION * 2
  );

  const showMoreFlatList = useCallback(() => {
    setFlatListVisibleCount((prev) => prev + ITEMS_PER_SECTION * 2);
  }, []);

  if (showGroupHeaders) {
    return (
      <div>
        {statusOrder.map((status) => {
          const statusTasks = tasksByStatus[status] ?? [];
          if (statusTasks.length === 0) return null;

          const config = STATUS_CONFIG[status];
          const isCollapsed = collapsedSections.has(status);
          const visibleCount = expandedCounts[status];
          const visibleTasks = statusTasks.slice(0, visibleCount);
          const hasMore = statusTasks.length > visibleCount;
          const remainingCount = statusTasks.length - visibleCount;

          // Map status to StatusIcon status type
          const iconStatus: Status =
            status === "backlog"
              ? "backlog"
              : status === "todo"
                ? "todo"
                : status === "in_progress"
                  ? "in_progress"
                  : status === "in_review"
                    ? "in_progress"
                    : status === "done"
                      ? "done"
                      : "canceled";

          return (
            <div key={status}>
              {/* Group Header - Collapsible */}
              <button
                className={cn(
                  "sticky top-0 z-10 flex w-full items-center gap-2 px-3 py-2",
                  "border-border border-b bg-card",
                  "cursor-pointer font-medium text-sm",
                  "transition-colors hover:bg-muted"
                )}
                onClick={() => toggleSection(status)}
                type="button"
              >
                {/* Collapse/Expand Icon */}
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                {/* Status Icon */}
                <StatusIcon size="sm" status={iconStatus} />
                {/* Label */}
                <span className="text-foreground">{config.label}</span>
                {/* Count Badge */}
                <span className="ml-1 text-muted-foreground text-[12px]">
                  {statusTasks.length}
                </span>
              </button>

              {/* Tasks - Only show if not collapsed */}
              {!isCollapsed && (
                <>
                  {visibleTasks.map((task) => (
                    <TaskRow
                      isActive={selectedTaskId === task.id}
                      isSelected={selectedIds.has(task.id)}
                      key={task.id}
                      onArchive={onArchive}
                      onClick={() => onTaskClick(task.id)}
                      onPriorityChange={onPriorityChange}
                      onSelect={onSelectTask}
                      onStar={onStar}
                      onStatusChange={onStatusChange}
                      task={task}
                    />
                  ))}

                  {/* Show More Button */}
                  {hasMore && (
                    <button
                      className={cn(
                        "flex w-full items-center justify-center gap-2 px-4 py-2",
                        "text-secondary text-[13px] hover:text-secondary",
                        "bg-card hover:bg-muted",
                        "border-border border-b",
                        "cursor-pointer transition-colors"
                      )}
                      onClick={() => showMoreItems(status)}
                      type="button"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                      <span>
                        Show {Math.min(remainingCount, ITEMS_PER_SECTION)} more
                        ({remainingCount} remaining)
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Compute visible tasks for flat list view
  const visibleTasks = tasks.slice(0, flatListVisibleCount);
  const hasMoreTasks = tasks.length > flatListVisibleCount;
  const remainingTasks = tasks.length - flatListVisibleCount;

  return (
    <div>
      {/* List Header - matches inbox-row.tsx layout exactly */}
      <div
        className={cn(
          "flex h-8 items-center px-3",
          "border-border border-b bg-background",
          "font-medium text-muted-foreground text-[11px] uppercase tracking-wider"
        )}
      >
        {/* Checkbox */}
        <div
          className={cn(
            COL.checkbox,
            "flex shrink-0 items-center justify-center"
          )}
        >
          <IssueCheckbox
            checked={
              selectedIds.size === tasks.length && tasks.length > 0
                ? true
                : selectedIds.size > 0
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(checked) => onSelectAll(checked)}
            size="sm"
          />
        </div>
        {/* Priority */}
        <div className={cn(COL.priority, "shrink-0")} />
        {/* Source */}
        <div className={cn(COL.source, "shrink-0")} />
        {/* Status */}
        <div className={cn(COL.status, "shrink-0")} />
        {/* Task ID */}
        <div className={cn(COL.taskId, "shrink-0 px-1")}>Task</div>
        {/* Title */}
        <div className="flex-1 px-2">Title</div>
        {/* Right section - fixed width matches row layout */}
        <div className="flex w-[140px] shrink-0 items-center justify-end">
          <div className="flex items-center gap-1.5">
            <span className="w-14 whitespace-nowrap text-right">Due</span>
            <div className="w-7" />
            <div className="w-7" />
          </div>
        </div>
      </div>

      {/* Tasks */}
      {visibleTasks.map((task) => (
        <TaskRow
          isActive={selectedTaskId === task.id}
          isSelected={selectedIds.has(task.id)}
          key={task.id}
          onArchive={onArchive}
          onClick={() => onTaskClick(task.id)}
          onPriorityChange={onPriorityChange}
          onSelect={onSelectTask}
          onStar={onStar}
          onStatusChange={onStatusChange}
          task={task}
        />
      ))}

      {/* Show More Button */}
      {hasMoreTasks && (
        <button
          className={cn(
            "flex w-full items-center justify-center gap-2 px-4 py-3",
            "text-secondary text-[13px] hover:text-secondary",
            "bg-card hover:bg-muted",
            "border-border border-b",
            "cursor-pointer transition-colors"
          )}
          onClick={showMoreFlatList}
          type="button"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          <span>
            Show {Math.min(remainingTasks, ITEMS_PER_SECTION * 2)} more (
            {remainingTasks} remaining)
          </span>
        </button>
      )}

      {/* Total count footer */}
      <div className="border-border border-t px-4 py-2 text-center text-muted-foreground text-[11px]">
        Showing {visibleTasks.length} of {tasks.length} tasks
      </div>
    </div>
  );
}

// =============================================================================
// TASK ROW (Linear-style matching inbox-row.tsx EXACTLY)
// =============================================================================

// Map task status to status icon status
function mapStatus(status: TaskStatus): Status {
  switch (status) {
    case "backlog":
      return "backlog";
    case "todo":
      return "todo";
    case "in_progress":
      return "in_progress";
    case "in_review":
      return "in_progress";
    case "done":
      return "done";
    case "cancelled":
      return "canceled";
    default:
      return "todo";
  }
}

// Map task priority to priority icon priority
function mapPriority(priority: TaskPriority): Priority {
  switch (priority) {
    case "urgent":
      return "urgent";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    case "no_priority":
      return "none";
    default:
      return "none";
  }
}

// =============================================================================
// TASK SOURCE DISPLAY
// =============================================================================
// Smart source icon that shows:
// - For conversations: actual source (email, slack, whatsapp, calendar) from metadata
// - For commitments: handshake icon with blue color
// - For decisions: gavel icon with purple color
// - For manual: clipboard icon with gray color

interface TaskSourceDisplayProps {
  sourceType: TaskSourceType;
  metadata?: TaskData["metadata"];
  size?: "xs" | "sm" | "md";
}

// Source type colors for commitment/decision/manual
const TASK_SOURCE_COLORS = {
  commitment: "#3B82F6", // Blue - represents promises/agreements
  decision: "#8B5CF6", // Purple - represents choices/rulings
  manual: "#6B7280", // Gray - user-created tasks
} as const;

function TaskSourceDisplay({
  sourceType,
  metadata,
  size = "sm",
}: TaskSourceDisplayProps) {
  const sizeClasses = {
    xs: "size-3",
    sm: "size-4",
    md: "size-5",
  };

  // For conversations, use the actual source from metadata
  if (sourceType === "conversation") {
    const actualSource = metadata?.sourceAccountType as SourceType | undefined;
    if (
      actualSource &&
      [
        "email",
        "slack",
        "whatsapp",
        "calendar",
        "notion",
        "google_docs",
        "teams",
        "discord",
        "linear",
        "github",
      ].includes(actualSource)
    ) {
      return <SourceIcon size={size} sourceType={actualSource} />;
    }
    // Default to email if no metadata
    return <SourceIcon size={size} sourceType="email" />;
  }

  // For commitments, show handshake icon
  if (sourceType === "commitment") {
    return (
      <div className="flex shrink-0 items-center justify-center">
        <Handshake
          className={sizeClasses[size]}
          style={{ color: TASK_SOURCE_COLORS.commitment }}
        />
      </div>
    );
  }

  // For decisions, show gavel icon
  if (sourceType === "decision") {
    return (
      <div className="flex shrink-0 items-center justify-center">
        <Gavel
          className={sizeClasses[size]}
          style={{ color: TASK_SOURCE_COLORS.decision }}
        />
      </div>
    );
  }

  // For manual tasks, show clipboard icon
  return (
    <div className="flex shrink-0 items-center justify-center">
      <ClipboardList
        className={sizeClasses[size]}
        style={{ color: TASK_SOURCE_COLORS.manual }}
      />
    </div>
  );
}

// Generate task ID display (like T-XXXX)
function getTaskIdDisplay(task: TaskData): string {
  return `T-${task.id.slice(0, 4).toUpperCase()}`;
}

interface TaskRowProps {
  task: TaskData;
  isSelected: boolean;
  isActive: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onClick: () => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onPriorityChange: (id: string, priority: TaskPriority) => void;
  onStar?: (id: string) => void;
  onArchive?: (id: string) => void;
}

function TaskRow({
  task,
  isSelected,
  isActive,
  onSelect,
  onClick,
  onStatusChange,
  onPriorityChange,
  onStar,
  onArchive,
}: TaskRowProps) {
  const dueInfo = formatDueDate(task.dueDate);
  const iconStatus = mapStatus(task.status);
  const iconPriority = mapPriority(task.priority);

  return (
    <div
      className={cn(
        "group flex h-10 items-center",
        "cursor-pointer transition-colors duration-100",
        "border-border border-b",
        isSelected && "bg-accent",
        isActive &&
          "border-l-2 border-l-secondary bg-accent pl-[calc(0.75rem-2px)]",
        !isActive && "pl-3",
        "pr-3",
        !(isSelected || isActive) && "hover:bg-muted"
      )}
      onClick={onClick}
    >
      {/* Checkbox - fixed width */}
      <div
        className={cn(
          COL.checkbox,
          "flex shrink-0 items-center justify-center"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <IssueCheckbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect(task.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width */}
      <div
        className={cn(
          COL.priority,
          "flex h-7 shrink-0 items-center justify-center"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-[4px] p-1 transition-colors hover:bg-accent">
              <PriorityIcon priority={iconPriority} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {Object.entries(PRIORITY_CONFIG).map(([priority, config]) => (
              <DropdownMenuItem
                key={priority}
                onClick={() =>
                  onPriorityChange(task.id, priority as TaskPriority)
                }
              >
                <PriorityIcon
                  priority={mapPriority(priority as TaskPriority)}
                  size="sm"
                />
                <span className="ml-2">{config.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Source - fixed width, smart icon based on task type */}
      <div
        className={cn(COL.source, "flex shrink-0 items-center justify-center")}
      >
        <TaskSourceDisplay
          metadata={task.metadata}
          size="sm"
          sourceType={task.sourceType}
        />
      </div>

      {/* Status - fixed width */}
      <div
        className={cn(
          COL.status,
          "flex h-7 shrink-0 items-center justify-center"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="rounded-[4px] p-1 transition-colors hover:bg-accent">
              <StatusIcon size="sm" status={iconStatus} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <DropdownMenuItem
                key={status}
                onClick={() => onStatusChange(task.id, status as TaskStatus)}
              >
                <StatusIcon
                  size="sm"
                  status={mapStatus(status as TaskStatus)}
                />
                <span className="ml-2">{config.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Task ID - fixed width (matches sender column in inbox) */}
      <div className={cn(COL.taskId, "shrink-0 px-1")}>
        <span className="block truncate font-medium text-foreground text-[13px]">
          {getTaskIdDisplay(task)}
        </span>
      </div>

      {/* Title - flexible width, takes remaining space */}
      <div className="min-w-0 flex-1 px-2">
        <span className="block truncate font-normal text-muted-foreground text-[13px]">
          {task.title}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned (matches inbox exactly) */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        {/* Default state: Date + Assignee + Labels - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Date - fixed width, right aligned text */}
          <span
            className={cn(
              "w-14 whitespace-nowrap text-right font-normal text-[12px]",
              dueInfo?.className ?? "text-muted-foreground"
            )}
          >
            {dueInfo?.text ?? ""}
          </span>

          {/* Assignee - fixed width */}
          <div className="flex h-7 w-7 items-center justify-center">
            {task.assignee ? (
              <AssigneeIcon
                email={task.assignee.email}
                imageUrl={task.assignee.image ?? undefined}
                name={task.assignee.name ?? undefined}
                size="xs"
              />
            ) : (
              <AssigneeIcon size="xs" />
            )}
          </div>

          {/* Labels indicator or spacer */}
          <div className="flex w-7 items-center justify-center">
            {task.labels.length > 0 ? (
              <div className="flex items-center gap-0.5">
                {task.labels.slice(0, 2).map((label) => (
                  <span
                    className="h-2 w-2 rounded-full"
                    key={label.id}
                    style={{ backgroundColor: label.color }}
                    title={label.name}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section */}
        <div className="hidden items-center justify-end gap-0.5 group-hover:flex">
          <button
            aria-label="Star"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              "text-muted-foreground",
              "hover:bg-accent hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onStar?.(task.id);
            }}
            type="button"
          >
            <Star className="size-4" />
          </button>
          <button
            aria-label="Archive"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              "text-muted-foreground",
              "hover:bg-accent hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onArchive?.(task.id);
            }}
            type="button"
          >
            <Archive className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// LOADING & EMPTY STATES
// =============================================================================

function TaskListSkeleton() {
  return (
    <div>
      {[...Array(10)].map((_, i) => (
        <div className="flex h-10 items-center border-b px-3" key={i}>
          <div className="flex w-7 shrink-0 items-center justify-center">
            <Skeleton className="h-4 w-4 rounded" />
          </div>
          <div className="flex w-8 shrink-0 items-center justify-center">
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <div className="flex w-8 shrink-0 items-center justify-center">
            <Skeleton className="h-2 w-2 rounded-full" />
          </div>
          <div className="w-[100px] shrink-0 px-1">
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="min-w-0 flex-1 px-2">
            <Skeleton className="h-3 w-3/4" />
          </div>
          <div className="flex w-[100px] shrink-0 justify-end px-2">
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-lg">No tasks found</h3>
      <p className="mt-1 text-muted-foreground text-sm">
        Tasks are automatically created from conversations, commitments, and
        decisions
      </p>
    </div>
  );
}
