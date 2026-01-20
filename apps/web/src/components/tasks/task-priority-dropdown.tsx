// =============================================================================
// TASK PRIORITY DROPDOWN
// =============================================================================
//
// Reusable priority dropdown component for changing task priority.
// Used in task rows, task cards, inbox rows, commitment/decision cards.
//

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Priority, PriorityIcon } from "@/components/ui/priority-icon";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import {
  PRIORITY_CONFIG,
  PRIORITY_ORDER,
  type TaskPriority,
} from "./task-types";

// Map TaskPriority to PriorityIcon's Priority type
function mapTaskPriorityToIconPriority(taskPriority: TaskPriority): Priority {
  switch (taskPriority) {
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
  }
}

// =============================================================================
// PROPS
// =============================================================================

interface TaskPriorityDropdownProps {
  taskId: string;
  organizationId: string;
  currentPriority: TaskPriority;
  /** Compact mode shows only dot */
  compact?: boolean;
  /** Disable the dropdown */
  disabled?: boolean;
  /** Called after successful priority change */
  onPriorityChange?: (newPriority: TaskPriority) => void;
  /** Custom trigger element */
  trigger?: React.ReactNode;
  /** Align dropdown menu */
  align?: "start" | "center" | "end";
}

// =============================================================================
// COMPONENT
// =============================================================================

export function TaskPriorityDropdown({
  taskId,
  organizationId,
  currentPriority,
  compact = false,
  disabled = false,
  onPriorityChange,
  trigger,
  align = "start",
}: TaskPriorityDropdownProps) {
  const queryClient = useQueryClient();
  const config = PRIORITY_CONFIG[currentPriority];

  const updatePriorityMutation = useMutation({
    ...trpc.tasks.updatePriority.mutationOptions(),
    onMutate: async ({ priority: newPriority }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["tasks"] });

      // Return context for rollback
      return { previousPriority: currentPriority };
    },
    onSuccess: (_, { priority: newPriority }) => {
      toast.success(
        `Priority changed to ${PRIORITY_CONFIG[newPriority].label}`
      );
      onPriorityChange?.(newPriority);
    },
    onError: () => {
      toast.error("Failed to update priority");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const handlePriorityChange = (newPriority: TaskPriority) => {
    if (newPriority === currentPriority) return;

    updatePriorityMutation.mutate({
      organizationId,
      taskId,
      priority: newPriority,
    });
  };

  const iconPriority = mapTaskPriorityToIconPriority(currentPriority);

  const defaultTrigger = compact ? (
    <Button
      className="h-7 w-7"
      disabled={disabled || updatePriorityMutation.isPending}
      size="icon"
      variant="ghost"
    >
      <PriorityIcon priority={iconPriority} size="sm" />
    </Button>
  ) : (
    <Button
      className="h-7 gap-2"
      disabled={disabled || updatePriorityMutation.isPending}
      size="sm"
      variant="outline"
    >
      <PriorityIcon priority={iconPriority} size="sm" />
      <span className="text-xs">{config.label}</span>
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger ?? defaultTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} onClick={(e) => e.stopPropagation()}>
        {PRIORITY_ORDER.map((priority) => {
          const priorityConfig = PRIORITY_CONFIG[priority];
          const isSelected = priority === currentPriority;
          const menuIconPriority = mapTaskPriorityToIconPriority(priority);

          return (
            <DropdownMenuItem
              className={cn(isSelected && "bg-accent")}
              key={priority}
              onClick={() => handlePriorityChange(priority)}
            >
              <PriorityIcon
                className="mr-2"
                priority={menuIconPriority}
                size="sm"
              />
              <span>{priorityConfig.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =============================================================================
// PRIORITY INDICATOR (Read-only display)
// =============================================================================

interface TaskPriorityIndicatorProps {
  priority: TaskPriority;
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

export function TaskPriorityIndicator({
  priority,
  className,
  showLabel = false,
  size = "md",
}: TaskPriorityIndicatorProps) {
  const config = PRIORITY_CONFIG[priority];

  const dotSizes = {
    sm: "w-1.5 h-1.5",
    md: "w-2 h-2",
    lg: "w-2.5 h-2.5",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5",
        showLabel && "rounded-md px-2 py-0.5 font-medium text-xs",
        showLabel && config.bgColor,
        className
      )}
    >
      <div className={cn("rounded-full", dotSizes[size], config.dotColor)} />
      {showLabel && <span className={config.color}>{config.label}</span>}
    </div>
  );
}
