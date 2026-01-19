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
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { GripVertical, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PriorityIcon, type Priority } from "@/components/ui/priority-icon";
import { StatusIcon, type Status } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import {
  formatDueDate,
  PRIORITY_CONFIG,
  SOURCE_TYPE_CONFIG,
  STATUS_CONFIG,
  STATUS_ORDER,
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
  const [overId, setOverId] = useState<string | null>(null);

  // Group tasks by status
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
      grouped[task.status].push(task);
    }

    return grouped;
  }, [tasks]);

  // Get the active task for drag overlay
  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeId),
    [tasks, activeId]
  );

  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Update status mutation with optimistic updates
  const trpcMutationOptions = trpc.tasks.updateStatus.mutationOptions();

  const updateStatusMutation = useMutation({
    mutationKey: trpcMutationOptions.mutationKey,
    mutationFn: trpcMutationOptions.mutationFn,
    onMutate: async ({ taskId, status: newStatus }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["tasks"] });

      // Snapshot the previous value
      const previousTasks = queryClient.getQueryData(["tasks"]);

      // Optimistically update the cache
      queryClient.setQueryData(["tasks"], (old: { tasks: TaskData[] } | undefined) => {
        if (!old) return old;
        return {
          ...old,
          tasks: old.tasks.map((t) =>
            t.id === taskId ? { ...t, status: newStatus } : t
          ),
        };
      });

      return { previousTasks };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousTasks) {
        queryClient.setQueryData(["tasks"], context.previousTasks);
      }
      toast.error("Failed to move task");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  // Drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    setOverId(over?.id as string | null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      setActiveId(null);
      setOverId(null);

      if (!over) return;

      const activeTaskId = active.id as string;
      const overId = over.id as string;

      // Check if dropped on a column header
      const isColumn = columns.includes(overId as TaskStatus);
      let newStatus: TaskStatus;

      if (isColumn) {
        newStatus = overId as TaskStatus;
      } else {
        // Dropped on another task - get its status
        const overTask = tasks.find((t) => t.id === overId);
        if (!overTask) return;
        newStatus = overTask.status;
      }

      // Get the active task
      const activeTask = tasks.find((t) => t.id === activeTaskId);
      if (!activeTask) return;

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
    setOverId(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-4 p-4 h-full overflow-x-auto">
        {columns.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={tasksByStatus[status]}
            onTaskClick={onTaskClick}
            isOver={overId === status}
            allowCreate={allowCreate}
            organizationId={organizationId}
          />
        ))}
      </div>

      {/* Drag Overlay */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <KanbanCard task={activeTask} isDragging onClick={() => {}} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// =============================================================================
// KANBAN COLUMN
// =============================================================================

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: TaskData[];
  onTaskClick: (taskId: string) => void;
  isOver: boolean;
  allowCreate: boolean;
  organizationId: string;
}

// Map task status to StatusIcon status
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

// Map task priority to PriorityIcon priority
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

function KanbanColumn({
  status,
  tasks,
  onTaskClick,
  isOver,
  allowCreate,
  organizationId,
}: KanbanColumnProps) {
  const config = STATUS_CONFIG[status];
  const iconStatus = mapStatusToIcon(status);

  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  return (
    <div
      className={cn(
        "flex flex-col w-[320px] min-w-[320px] rounded-lg transition-colors",
        "bg-[#1a1b26] border border-[#2a2b3d]",
        isOver && "border-[#5e6ad2]/50 bg-[#5e6ad2]/5"
      )}
    >
      {/* Column Header */}
      <div
        id={status}
        className="flex items-center gap-2 px-3 py-2.5 border-b border-[#2a2b3d]"
      >
        <StatusIcon status={iconStatus} size="md" />
        <span className="text-sm font-medium text-[#eeeffc]">{config.label}</span>
        <span className="text-sm text-[#858699] ml-auto">{tasks.length}</span>
      </div>

      {/* Column Content */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2 min-h-[200px]">
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            <AnimatePresence mode="popLayout">
              {tasks.map((task) => (
                <SortableKanbanCard
                  key={task.id}
                  task={task}
                  onClick={() => onTaskClick(task.id)}
                />
              ))}
            </AnimatePresence>
          </SortableContext>

          {tasks.length === 0 && (
            <div className="flex items-center justify-center h-24 text-sm text-[#4c4f6b]">
              No tasks
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Add Task Button */}
      {allowCreate && (
        <div className="p-2 border-t border-[#2a2b3d]">
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

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: isDragging ? 0.5 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
    >
      <KanbanCard
        task={task}
        isDragging={isDragging}
        onClick={onClick}
        dragHandleProps={listeners}
      />
    </motion.div>
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
        "transition-all duration-150",
        "hover:border-[#3a3b4d] hover:bg-[#252736]",
        isDragging && "shadow-lg border-[#5e6ad2] ring-2 ring-[#5e6ad2]/20 bg-[#252736]"
      )}
      onClick={onClick}
    >
      {/* Header: Title with drag handle */}
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab shrink-0",
            isDragging && "opacity-100 cursor-grabbing"
          )}
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4 text-[#4c4f6b]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-medium text-[#eeeffc] leading-snug">
            {task.title}
          </h3>
        </div>
      </div>

      {/* Description - always show if present */}
      {task.description && (
        <p className="text-[12px] text-[#858699] mt-2 ml-6 leading-relaxed">
          {task.description}
        </p>
      )}

      {/* Labels */}
      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3 ml-6">
          {task.labels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: `${label.color}20`,
                color: label.color,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
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
      <div className="flex items-center gap-2 mt-3 ml-6">
        <PriorityIcon priority={iconPriority} size="sm" />
        <span className={cn("text-[11px]", sourceConfig.color)}>
          {sourceConfig.label}
        </span>

        <div className="flex-1" />

        {dueInfo && (
          <span className={cn("text-[11px]", dueInfo.className)}>
            {dueInfo.text}
          </span>
        )}

        {/* Assignee Avatar */}
        {task.assignee && (
          <Avatar className="h-5 w-5">
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
// EXPORTS
// =============================================================================

export { KanbanCard };
