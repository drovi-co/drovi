// =============================================================================
// TASK ASSIGNEE DROPDOWN
// =============================================================================
//
// Reusable assignee dropdown component for assigning tasks to organization members.
// Used in task rows, task cards, inbox rows, commitment/decision cards.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, User, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import type { TaskAssignee } from "./task-types";

// =============================================================================
// PROPS
// =============================================================================

interface TaskAssigneeDropdownProps {
  taskId: string;
  organizationId: string;
  currentAssignee: TaskAssignee | null;
  /** Compact mode shows only avatar */
  compact?: boolean;
  /** Disable the dropdown */
  disabled?: boolean;
  /** Called after successful assignee change */
  onAssigneeChange?: (newAssignee: TaskAssignee | null) => void;
  /** Custom trigger element */
  trigger?: React.ReactNode;
  /** Align dropdown menu */
  align?: "start" | "center" | "end";
}

// =============================================================================
// COMPONENT
// =============================================================================

export function TaskAssigneeDropdown({
  taskId,
  organizationId,
  currentAssignee,
  compact = false,
  disabled = false,
  onAssigneeChange,
  trigger,
  align = "start",
}: TaskAssigneeDropdownProps) {
  const queryClient = useQueryClient();

  // Fetch organization members
  const { data: membersData } = useQuery({
    ...trpc.organizations.getMembers.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  const members = membersData?.members ?? [];

  const assignMutation = useMutation({
    ...trpc.tasks.assign.mutationOptions(),
    onMutate: async ({ assigneeId }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      return { previousAssignee: currentAssignee };
    },
    onSuccess: (_, { assigneeId }) => {
      const newAssignee = assigneeId
        ? members.find((m) => m.userId === assigneeId)
        : null;

      if (assigneeId) {
        toast.success(`Assigned to ${newAssignee?.user?.name ?? newAssignee?.user?.email ?? "user"}`);
      } else {
        toast.success("Unassigned task");
      }
      onAssigneeChange?.(newAssignee ? {
        id: newAssignee.userId,
        name: newAssignee.user?.name ?? null,
        email: newAssignee.user?.email ?? "",
        image: newAssignee.user?.image ?? null,
      } : null);
    },
    onError: () => {
      toast.error("Failed to update assignee");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const handleAssign = (userId: string | null) => {
    if (userId === currentAssignee?.id) return;

    assignMutation.mutate({
      organizationId,
      taskId,
      assigneeId: userId,
    });
  };

  const defaultTrigger = compact ? (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      disabled={disabled || assignMutation.isPending}
    >
      {currentAssignee ? (
        <Avatar className="h-5 w-5">
          {currentAssignee.image && (
            <AvatarImage src={currentAssignee.image} alt={currentAssignee.name ?? ""} />
          )}
          <AvatarFallback className="text-[10px]">
            {getInitials(currentAssignee.name, currentAssignee.email)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <User className="h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  ) : (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 h-7"
      disabled={disabled || assignMutation.isPending}
    >
      {currentAssignee ? (
        <>
          <Avatar className="h-4 w-4">
            {currentAssignee.image && (
              <AvatarImage src={currentAssignee.image} alt={currentAssignee.name ?? ""} />
            )}
            <AvatarFallback className="text-[8px]">
              {getInitials(currentAssignee.name, currentAssignee.email)}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs truncate max-w-[100px]">
            {currentAssignee.name ?? currentAssignee.email}
          </span>
        </>
      ) : (
        <>
          <User className="h-3.5 w-3.5" />
          <span className="text-xs">Assign</span>
        </>
      )}
    </Button>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger ?? defaultTrigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56" onClick={(e) => e.stopPropagation()}>
        {/* Unassign option */}
        {currentAssignee && (
          <>
            <DropdownMenuItem onClick={() => handleAssign(null)}>
              <UserMinus className="h-4 w-4 mr-2 text-muted-foreground" />
              <span>Unassign</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Team members */}
        {members.length === 0 ? (
          <div className="px-2 py-4 text-sm text-muted-foreground text-center">
            No team members found
          </div>
        ) : (
          members.map((member) => {
            const isSelected = member.userId === currentAssignee?.id;
            return (
              <DropdownMenuItem
                key={member.userId}
                onClick={() => handleAssign(member.userId)}
                className={cn(isSelected && "bg-accent")}
              >
                <Avatar className="h-6 w-6 mr-2">
                  {member.user?.image && (
                    <AvatarImage src={member.user.image} alt={member.user.name ?? ""} />
                  )}
                  <AvatarFallback className="text-[10px]">
                    {getInitials(member.user?.name, member.user?.email ?? "")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">
                    {member.user?.name ?? member.user?.email}
                  </div>
                  {member.user?.name && (
                    <div className="text-xs text-muted-foreground truncate">
                      {member.user.email}
                    </div>
                  )}
                </div>
                {isSelected && <Check className="h-4 w-4 shrink-0 ml-2" />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =============================================================================
// ASSIGNEE AVATAR (Read-only display)
// =============================================================================

interface TaskAssigneeAvatarProps {
  assignee: TaskAssignee | null;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
}

export function TaskAssigneeAvatar({
  assignee,
  size = "md",
  showName = false,
  className,
}: TaskAssigneeAvatarProps) {
  const sizes = {
    sm: "h-5 w-5",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  };

  const textSizes = {
    sm: "text-[8px]",
    md: "text-[10px]",
    lg: "text-xs",
  };

  if (!assignee) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className={cn(
          "rounded-full bg-muted flex items-center justify-center",
          sizes[size]
        )}>
          <User className={cn(
            "text-muted-foreground",
            size === "sm" ? "h-3 w-3" : size === "md" ? "h-3.5 w-3.5" : "h-4 w-4"
          )} />
        </div>
        {showName && (
          <span className="text-sm text-muted-foreground">Unassigned</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Avatar className={sizes[size]}>
        {assignee.image && (
          <AvatarImage src={assignee.image} alt={assignee.name ?? ""} />
        )}
        <AvatarFallback className={textSizes[size]}>
          {getInitials(assignee.name, assignee.email)}
        </AvatarFallback>
      </Avatar>
      {showName && (
        <span className="text-sm truncate">
          {assignee.name ?? assignee.email}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}
