// =============================================================================
// TASK KANBAN BOARD
// =============================================================================
//
// Full drag-and-drop kanban board using @dnd-kit.
// Supports dragging tasks between columns with optimistic updates.
//

import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, GripVertical, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { type Priority, PriorityIcon } from "@/components/ui/priority-icon";
import { type Status, StatusIcon } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import {
  formatDueDate,
  SOURCE_TYPE_CONFIG,
  STATUS_CONFIG,
  type TaskData,
  type TaskPriority,
  type TaskStatus,
} from "./task-types";

// =============================================================================
// PROPS
// =============================================================================

interface TaskKanbanBoardProps {
  tasks: TaskData[];
  organizationId: string;
  onTaskClick: (taskId: string) => void;
  /** Columns to show (defaults to all except cancelled) */
  columns?: TaskStatus[];
  /** Allow creating new tasks inline */
  allowCreate?: boolean;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TaskKanbanBoard({
  tasks,
  organizationId,
  onTaskClick,
  columns = ["backlog", "todo", "in_progress", "in_review", "done"],
  allowCreate = false,
}: TaskKanbanBoardProps) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<TaskStatus | null>(null);

  // Optimistic updates: track pending status changes
  const [optimisticMoves, setOptimisticMoves] = useState<
    Record<string, TaskStatus>
  >({});

  // Group tasks by status with optimistic updates applied
  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, TaskData[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
      cancelled: [],
    };

    for (const task of tasks) {
      // Apply optimistic status if exists
      const effectiveStatus = optimisticMoves[task.id] ?? task.status;
      grouped[effectiveStatus].push({
        ...task,
        status: effectiveStatus,
      });
    }

    return grouped;
  }, [tasks, optimisticMoves]);

  // Get the active task for drag overlay (with optimistic status applied)
  const activeTask = useMemo(() => {
    const task = tasks.find((t) => t.id === activeId);
    if (!task) return null;
    const effectiveStatus = optimisticMoves[task.id] ?? task.status;
    return { ...task, status: effectiveStatus };
  }, [tasks, activeId, optimisticMoves]);

  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Update status mutation with optimistic updates
  const updateStatusMutation = useMutation(
    trpc.tasks.updateStatus.mutationOptions({
      onMutate: async ({ taskId, status }) => {
        // Apply optimistic update immediately
        setOptimisticMoves((prev) => ({
          ...prev,
          [taskId]: status,
        }));
        return undefined;
      },
      onSuccess: (_, { taskId }) => {
        // Clear optimistic state - the query will have the real data
        setOptimisticMoves((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
        queryClient.invalidateQueries({ queryKey: [["tasks"]] });
      },
      onError: (_, { taskId }) => {
        // Revert optimistic update on error
        setOptimisticMoves((prev) => {
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
        toast.error("Failed to move task");
      },
    })
  );

  // Drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;

      if (!over) {
        setOverColumnId(null);
        return;
      }

      const overId = over.id as string;

      // Check if over a column directly
      if (columns.includes(overId as TaskStatus)) {
        setOverColumnId(overId as TaskStatus);
        return;
      }

      // Check if over a task - get that task's column
      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) {
        setOverColumnId(overTask.status);
        return;
      }

      setOverColumnId(null);
    },
    [columns, tasks]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveId(null);
      setOverColumnId(null);

      if (!over) return;

      const activeTaskId = active.id as string;
      const overId = over.id as string;

      // Get the active task
      const activeTask = tasks.find((t) => t.id === activeTaskId);
      if (!activeTask) return;

      let newStatus: TaskStatus;

      // Check if dropped on a column directly
      if (columns.includes(overId as TaskStatus)) {
        newStatus = overId as TaskStatus;
      } else {
        // Dropped on another task - get its status
        const overTask = tasks.find((t) => t.id === overId);
        if (!overTask) return;
        newStatus = overTask.status;
      }

      // Only update if status changed
      if (activeTask.status !== newStatus) {
        updateStatusMutation.mutate({
          organizationId,
          taskId: activeTaskId,
          status: newStatus,
        });
      }
    },
    [columns, tasks, organizationId, updateStatusMutation]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverColumnId(null);
  }, []);

  return (
    <DndContext
      collisionDetection={rectIntersection}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <div className="flex h-full gap-4 overflow-x-auto p-4">
        {columns.map((status) => (
          <DroppableColumn
            allowCreate={allowCreate}
            isDragging={activeId !== null}
            isOver={overColumnId === status}
            key={status}
            onTaskClick={onTaskClick}
            status={status}
            tasks={tasksByStatus[status]}
          />
        ))}
      </div>

      {/* Drag Overlay */}
      <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
        {activeTask ? (
          <KanbanCard isDragging onClick={() => {}} task={activeTask} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// =============================================================================
// DROPPABLE COLUMN
// =============================================================================

// Items to show per column by default
const ITEMS_PER_COLUMN = 10;

interface DroppableColumnProps {
  status: TaskStatus;
  tasks: TaskData[];
  onTaskClick: (taskId: string) => void;
  isOver: boolean;
  isDragging: boolean;
  allowCreate: boolean;
}

function DroppableColumn({
  status,
  tasks,
  onTaskClick,
  isOver,
  isDragging,
  allowCreate,
}: DroppableColumnProps) {
  const { setNodeRef, isOver: isDirectlyOver } = useDroppable({
    id: status,
  });

  // Pagination state
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_COLUMN);

  const config = STATUS_CONFIG[status];
  const iconStatus = mapStatusToIcon(status);

  // Get visible tasks for pagination
  const visibleTasks = useMemo(
    () => tasks.slice(0, visibleCount),
    [tasks, visibleCount]
  );
  const hasMore = tasks.length > visibleCount;
  const remainingCount = tasks.length - visibleCount;

  // Task IDs for sortable context (only visible ones)
  const taskIds = useMemo(() => visibleTasks.map((t) => t.id), [visibleTasks]);

  // Show drop indicator when dragging and hovering over this column
  const showDropIndicator = isDragging && (isOver || isDirectlyOver);

  const handleShowMore = useCallback(() => {
    setVisibleCount((prev) => prev + ITEMS_PER_COLUMN);
  }, []);

  return (
    <div
      className={cn(
        "flex w-[320px] min-w-[320px] max-w-[320px] flex-col rounded-lg transition-all duration-200",
        "border-2 bg-card",
        showDropIndicator
          ? "border-secondary bg-secondary/10 shadow-[0_0_20px_rgba(108,112,214,0.3)]"
          : "border-border",
        isDragging && !showDropIndicator && "border-border border-dashed"
      )}
      ref={setNodeRef}
    >
      {/* Column Header */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b px-3 py-2.5 transition-colors",
          showDropIndicator ? "border-secondary/50" : "border-border"
        )}
      >
        <StatusIcon size="md" status={iconStatus} />
        <span className="font-medium text-foreground text-sm">
          {config.label}
        </span>
        <span className="ml-auto text-muted-foreground text-sm">
          {tasks.length}
        </span>
      </div>

      {/* Column Content - use overflow-y-auto instead of ScrollArea for better control */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="min-h-[200px] space-y-2 p-2">
          <SortableContext
            items={taskIds}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence mode="popLayout">
              {visibleTasks.map((task) => (
                <SortableKanbanCard
                  key={task.id}
                  onClick={() => onTaskClick(task.id)}
                  task={task}
                />
              ))}
            </AnimatePresence>
          </SortableContext>

          {/* Drop zone indicator */}
          {showDropIndicator && (
            <motion.div
              animate={{ opacity: 1, height: 60 }}
              className={cn(
                "rounded-lg border-2 border-secondary border-dashed",
                "flex items-center justify-center bg-secondary/10"
              )}
              exit={{ opacity: 0, height: 0 }}
              initial={{ opacity: 0, height: 0 }}
            >
              <span className="font-medium text-secondary text-sm">
                Drop here
              </span>
            </motion.div>
          )}

          {tasks.length === 0 && !showDropIndicator && (
            <div className="flex h-24 items-center justify-center text-muted-foreground text-sm">
              No tasks
            </div>
          )}

          {/* Show More Button */}
          {hasMore && (
            <button
              className={cn(
                "flex w-full items-center justify-center gap-1.5 px-3 py-2",
                "text-[12px] text-secondary hover:text-secondary",
                "bg-muted hover:bg-accent",
                "rounded-lg border border-border hover:border-border",
                "cursor-pointer transition-colors"
              )}
              onClick={handleShowMore}
              type="button"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              <span>
                Show {Math.min(remainingCount, ITEMS_PER_COLUMN)} more (
                {remainingCount})
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Add Task Button */}
      {allowCreate && (
        <div className="shrink-0 border-border border-t p-2">
          <Button
            className="w-full justify-start gap-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            size="sm"
            variant="ghost"
          >
            <Plus className="h-4 w-4" />
            Add task
          </Button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SORTABLE KANBAN CARD
// =============================================================================

interface SortableKanbanCardProps {
  task: TaskData;
  onClick: () => void;
}

function SortableKanbanCard({ task, onClick }: SortableKanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging) {
    // Return a placeholder when dragging
    return (
      <div
        className="h-[80px] rounded-lg border-2 border-secondary/50 border-dashed bg-secondary/5"
        ref={setNodeRef}
        style={style}
      />
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <KanbanCard
        dragHandleProps={listeners}
        isDragging={false}
        onClick={onClick}
        task={task}
      />
    </div>
  );
}

// =============================================================================
// KANBAN CARD
// =============================================================================

interface KanbanCardProps {
  task: TaskData;
  isDragging?: boolean;
  onClick: () => void;
  dragHandleProps?: Record<string, unknown>;
}

function KanbanCard({
  task,
  isDragging = false,
  onClick,
  dragHandleProps,
}: KanbanCardProps) {
  const sourceConfig = SOURCE_TYPE_CONFIG[task.sourceType];
  const dueInfo = formatDueDate(task.dueDate);
  const iconPriority = mapPriorityToIcon(task.priority);

  // Get initials for avatar fallback
  const getInitials = (name: string | null, email: string): string => {
    if (name) {
      const parts = name.split(" ");
      if (parts.length >= 2) {
        return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
  };

  return (
    <div
      className={cn(
        "group cursor-pointer rounded-lg border border-border bg-muted p-3",
        "overflow-hidden transition-all duration-150",
        "hover:border-border hover:bg-accent",
        isDragging &&
          "rotate-2 scale-105 border-secondary bg-accent shadow-xl ring-2 ring-secondary/30"
      )}
      onClick={onClick}
    >
      {/* Header: Title with drag handle */}
      <div className="flex items-start gap-2 overflow-hidden">
        <div
          className={cn(
            "mt-0.5 shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-100",
            isDragging && "cursor-grabbing opacity-100"
          )}
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          <h3 className="line-clamp-2 break-words font-medium text-[13px] text-foreground leading-snug">
            {task.title}
          </h3>
        </div>
      </div>

      {/* Description - always show if present */}
      {task.description && (
        <p className="mt-2 ml-6 line-clamp-2 break-words text-[12px] text-muted-foreground leading-relaxed">
          {task.description}
        </p>
      )}

      {/* Labels */}
      {task.labels.length > 0 && (
        <div className="mt-3 ml-6 flex flex-wrap gap-1 overflow-hidden">
          {task.labels.slice(0, 2).map((label) => (
            <span
              className="inline-flex max-w-[120px] items-center gap-1 truncate rounded-full px-1.5 py-0.5 font-medium text-[10px]"
              key={label.id}
              style={{
                backgroundColor: `${label.color}20`,
                color: label.color,
              }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              <span className="truncate">{label.name}</span>
            </span>
          ))}
          {task.labels.length > 2 && (
            <span className="px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{task.labels.length - 2}
            </span>
          )}
        </div>
      )}

      {/* Footer: Priority, Source, Due Date, Assignee */}
      <div className="mt-3 ml-6 flex items-center gap-2 overflow-hidden">
        <div className="shrink-0">
          <PriorityIcon priority={iconPriority} size="sm" />
        </div>
        <span className={cn("truncate text-[11px]", sourceConfig.color)}>
          {sourceConfig.label}
        </span>

        <div className="min-w-0 flex-1" />

        {dueInfo && (
          <span
            className={cn(
              "shrink-0 whitespace-nowrap text-[11px]",
              dueInfo.className
            )}
          >
            {dueInfo.text}
          </span>
        )}

        {/* Assignee Avatar */}
        {task.assignee && (
          <Avatar className="h-5 w-5 shrink-0">
            {task.assignee.image && (
              <AvatarImage
                alt={task.assignee.name ?? ""}
                src={task.assignee.image}
              />
            )}
            <AvatarFallback className="bg-secondary text-[9px] text-white">
              {getInitials(task.assignee.name, task.assignee.email)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function mapStatusToIcon(status: TaskStatus): Status {
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

function mapPriorityToIcon(priority: TaskPriority): Priority {
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
// EXPORTS
// =============================================================================

export { KanbanCard };
