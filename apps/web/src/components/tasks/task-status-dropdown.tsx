// =============================================================================
// TASK STATUS DROPDOWN
// =============================================================================
//
// Reusable status dropdown component for changing task status.
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
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import { STATUS_CONFIG, STATUS_ORDER, type TaskStatus } from "./task-types";

// =============================================================================
// PROPS
// =============================================================================

interface TaskStatusDropdownProps {
  taskId: string;
  organizationId: string;
  currentStatus: TaskStatus;
  /** Compact mode shows only icon */
  compact?: boolean;
  /** Disable the dropdown */
  disabled?: boolean;
  /** Called after successful status change */
  onStatusChange?: (newStatus: TaskStatus) => void;
  /** Custom trigger element */
  trigger?: React.ReactNode;
  /** Align dropdown menu */
  align?: "start" | "center" | "end";
}

// =============================================================================
// COMPONENT
// =============================================================================

export function TaskStatusDropdown({
  taskId,
  organizationId,
  currentStatus,
  compact = false,
  disabled = false,
  onStatusChange,
  trigger,
  align = "start",
}: TaskStatusDropdownProps) {
  const queryClient = useQueryClient();
  const config = STATUS_CONFIG[currentStatus];
  const Icon = config.icon;

  const updateStatusMutation = useMutation({
    ...trpc.tasks.updateStatus.mutationOptions(),
    onMutate: async ({ status: newStatus }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["tasks"] });

      // Return context for rollback
      return { previousStatus: currentStatus };
    },
    onSuccess: (_, { status: newStatus }) => {
      toast.success(`Status changed to ${STATUS_CONFIG[newStatus].label}`);
      onStatusChange?.(newStatus);
    },
    onError: (error, _, context) => {
      toast.error("Failed to update status");
      // Rollback handled by refetch
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const handleStatusChange = (newStatus: TaskStatus) => {
    if (newStatus === currentStatus) return;

    updateStatusMutation.mutate({
      organizationId,
      taskId,
      status: newStatus,
    });
  };

  const defaultTrigger = compact ? (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={disabled || updateStatusMutation.isPending}
    >
      <Icon className={cn("h-4 w-4", config.color)} />
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 h-7"
      disabled={disabled || updateStatusMutation.isPending}
    >
      <Icon className={cn("h-3.5 w-3.5", config.color)} />
      <span className="text-xs">{config.label}</span>
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger ?? defaultTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} onClick={(e) => e.stopPropagation()}>
        {STATUS_ORDER.map((status) => {
          const statusConfig = STATUS_CONFIG[status];
          const StatusIcon = statusConfig.icon;
          const isSelected = status === currentStatus;

          return (
            <DropdownMenuItem
              key={status}
              onClick={() => handleStatusChange(status)}
              className={cn(isSelected && "bg-accent")}
            >
              <StatusIcon className={cn("h-4 w-4 mr-2", statusConfig.color)} />
              <span>{statusConfig.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =============================================================================
// STATUS BADGE (Read-only display)
// =============================================================================

interface TaskStatusBadgeProps {
  status: TaskStatus;
  className?: string;
  showIcon?: boolean;
  showLabel?: boolean;
}

export function TaskStatusBadge({
  status,
  className,
  showIcon = true,
  showLabel = true,
}: TaskStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium",
        config.bgColor,
        config.color,
        className
      )}
    >
      {showIcon && <Icon className="h-3.5 w-3.5" />}
      {showLabel && <span>{config.label}</span>}
    </div>
  );
}
