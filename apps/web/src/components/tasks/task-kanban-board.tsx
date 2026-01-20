// =============================================================================
// TASK KANBAN BOARD
// =============================================================================
//
// Full drag-and-drop kanban board using @dnd-kit.
// Supports dragging tasks between columns with optimistic updates.
//

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  rectIntersection,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, GripVertical, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PriorityIcon, type Priority } from "@/components/ui/priority-icon";
import { StatusIcon, type Status } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import {
  formatDueDate,
  SOURCE_TYPE_CONFIG,
  STATUS_CONFIG,
  type TaskData,
  type TaskStatus,
  type TaskPriority,
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
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, TaskStatus>>({});

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
  const updateStatusMutation = useMutation({
    ...trpc.tasks.updateStatus.mutationOptions(),
    onMutate: async ({ taskId, status }) => {
      // Apply optimistic update immediately
      setOptimisticMoves((prev) => ({
        ...prev,
        [taskId]: status,
      }));
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
  });

  // Drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
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
  }, [columns, tasks]);

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
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 p-4 h-full overflow-x-auto">
        {columns.map((status) => (
          <DroppableColumn
            key={status}
            status={status}
            tasks={tasksByStatus[status]}
            onTaskClick={onTaskClick}
            isOver={overColumnId === status}
            isDragging={activeId !== null}
            allowCreate={allowCreate}
          />
        ))}
      </div>

      {/* Drag Overlay */}
      <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
        {activeTask ? (
          <KanbanCard task={activeTask} isDragging onClick={() => {}} />
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
  const visibleTasks = useMemo(() => tasks.slice(0, visibleCount), [tasks, visibleCount]);
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
      ref={setNodeRef}
      className={cn(
        "flex flex-col w-[320px] min-w-[320px] max-w-[320px] rounded-lg transition-all duration-200",
        "bg-[#1a1b26] border-2",
        showDropIndicator
          ? "border-[#5e6ad2] bg-[#5e6ad2]/10 shadow-[0_0_20px_rgba(94,106,210,0.3)]"
          : "border-[#2a2b3d]",
        isDragging && !showDropIndicator && "border-dashed border-[#3a3b4d]"
      )}
    >
      {/* Column Header */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2.5 border-b transition-colors shrink-0",
          showDropIndicator ? "border-[#5e6ad2]/50" : "border-[#2a2b3d]"
        )}
      >
        <StatusIcon status={iconStatus} size="md" />
        <span className="text-sm font-medium text-[#eeeffc]">{config.label}</span>
        <span className="text-sm text-[#858699] ml-auto">{tasks.length}</span>
      </div>

      {/* Column Content - use overflow-y-auto instead of ScrollArea for better control */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="p-2 space-y-2 min-h-[200px]">
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            <AnimatePresence mode="popLayout">
              {visibleTasks.map((task) => (
                <SortableKanbanCard
                  key={task.id}
                  task={task}
                  onClick={() => onTaskClick(task.id)}
                />
              ))}
            </AnimatePresence>
          </SortableContext>

          {/* Drop zone indicator */}
          {showDropIndicator && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 60 }}
              exit={{ opacity: 0, height: 0 }}
              className={cn(
                "rounded-lg border-2 border-dashed border-[#5e6ad2]",
                "bg-[#5e6ad2]/10 flex items-center justify-center"
              )}
            >
              <span className="text-sm text-[#5e6ad2] font-medium">
                Drop here
              </span>
            </motion.div>
          )}

          {tasks.length === 0 && !showDropIndicator && (
            <div className="flex items-center justify-center h-24 text-sm text-[#4c4f6b]">
              No tasks
            </div>
          )}

          {/* Show More Button */}
          {hasMore && (
            <button
              type="button"
              onClick={handleShowMore}
              className={cn(
                "w-full flex items-center justify-center gap-1.5 py-2 px-3",
                "text-[12px] text-[#5e6ad2] hover:text-[#7c85e0]",
                "bg-[#21232e] hover:bg-[#252736]",
                "rounded-lg border border-[#2a2b3d] hover:border-[#3a3b4d]",
                "transition-colors cursor-pointer"
              )}
            >
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Show {Math.min(remainingCount, ITEMS_PER_COLUMN)} more ({remainingCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Add Task Button */}
      {allowCreate && (
        <div className="p-2 border-t border-[#2a2b3d] shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-[#858699] hover:text-[#eeeffc] hover:bg-[#2a2b3d]"
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
        ref={setNodeRef}
        style={style}
        className="h-[80px] rounded-lg border-2 border-dashed border-[#5e6ad2]/50 bg-[#5e6ad2]/5"
      />
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <KanbanCard
        task={task}
        isDragging={false}
        onClick={onClick}
        dragHandleProps={listeners}
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
        "group p-3 bg-[#21232e] rounded-lg border border-[#2a2b3d] cursor-pointer",
        "transition-all duration-150 overflow-hidden",
        "hover:border-[#3a3b4d] hover:bg-[#252736]",
        isDragging && "shadow-xl border-[#5e6ad2] ring-2 ring-[#5e6ad2]/30 bg-[#252736] rotate-2 scale-105"
      )}
      onClick={onClick}
    >
      {/* Header: Title with drag handle */}
      <div className="flex items-start gap-2 overflow-hidden">
        <div
          className={cn(
            "mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab shrink-0",
            isDragging && "opacity-100 cursor-grabbing"
          )}
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4 text-[#4c4f6b]" />
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">
          <h3 className="text-[13px] font-medium text-[#eeeffc] leading-snug line-clamp-2 break-words">
            {task.title}
          </h3>
        </div>
      </div>

      {/* Description - always show if present */}
      {task.description && (
        <p className="text-[12px] text-[#858699] mt-2 ml-6 leading-relaxed line-clamp-2 break-words">
          {task.description}
        </p>
      )}

      {/* Labels */}
      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3 ml-6 overflow-hidden">
          {task.labels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium max-w-[120px] truncate"
              style={{
                backgroundColor: `${label.color}20`,
                color: label.color,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: label.color }}
              />
              <span className="truncate">{label.name}</span>
            </span>
          ))}
          {task.labels.length > 2 && (
            <span className="text-[10px] px-1.5 py-0.5 text-[#4c4f6b]">
              +{task.labels.length - 2}
            </span>
          )}
        </div>
      )}

      {/* Footer: Priority, Source, Due Date, Assignee */}
      <div className="flex items-center gap-2 mt-3 ml-6 overflow-hidden">
        <div className="shrink-0">
          <PriorityIcon priority={iconPriority} size="sm" />
        </div>
        <span className={cn("text-[11px] truncate", sourceConfig.color)}>
          {sourceConfig.label}
        </span>

        <div className="flex-1 min-w-0" />

        {dueInfo && (
          <span className={cn("text-[11px] shrink-0 whitespace-nowrap", dueInfo.className)}>
            {dueInfo.text}
          </span>
        )}

        {/* Assignee Avatar */}
        {task.assignee && (
          <Avatar className="h-5 w-5 shrink-0">
            {task.assignee.image && (
              <AvatarImage src={task.assignee.image} alt={task.assignee.name ?? ""} />
            )}
            <AvatarFallback className="text-[9px] bg-[#5e6ad2] text-white">
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
    case "backlog": return "backlog";
    case "todo": return "todo";
    case "in_progress": return "in_progress";
    case "in_review": return "in_progress";
    case "done": return "done";
    case "cancelled": return "canceled";
    default: return "todo";
  }
}

function mapPriorityToIcon(priority: TaskPriority): Priority {
  switch (priority) {
    case "urgent": return "urgent";
    case "high": return "high";
    case "medium": return "medium";
    case "low": return "low";
    case "no_priority": return "none";
    default: return "none";
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { KanbanCard };
