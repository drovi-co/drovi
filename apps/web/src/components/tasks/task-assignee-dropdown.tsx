// =============================================================================
// TASK ASSIGNEE DROPDOWN
// =============================================================================
//
// Reusable assignee dropdown component for assigning tasks to organization members.
// Used in task rows, task cards, inbox rows, commitment/decision cards.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, User, UserMinus } from "lucide-react";
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
    onSuccess: (_, { assigneeId }) => {
      const newAssignee = assigneeId
        ? members.find((m) => m.userId === assigneeId)
        : null;

      if (assigneeId) {
        toast.success(
          `Assigned to ${newAssignee?.user?.name ?? newAssignee?.user?.email ?? "user"}`
        );
      } else {
        toast.success("Unassigned task");
      }

      // Invalidate all tasks-related queries using tRPC's query key structure
      // tRPC uses nested array keys like [["tasks", "list"], { input }]
      queryClient.invalidateQueries({ queryKey: [["tasks"]] });

      // Call the callback after cache invalidation
      onAssigneeChange?.(
        newAssignee
          ? {
              id: newAssignee.userId,
              name: newAssignee.user?.name ?? null,
              email: newAssignee.user?.email ?? "",
              image: newAssignee.user?.image ?? null,
            }
          : null
      );
    },
    onError: () => {
      toast.error("Failed to update assignee");
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
      className="h-7 w-7"
      disabled={disabled || assignMutation.isPending}
      size="icon"
      variant="ghost"
    >
      {currentAssignee ? (
        <Avatar className="h-5 w-5">
          {currentAssignee.image && (
            <AvatarImage
              alt={currentAssignee.name ?? ""}
              src={currentAssignee.image}
            />
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
      className="h-7 gap-2"
      disabled={disabled || assignMutation.isPending}
      size="sm"
      variant="outline"
    >
      {currentAssignee ? (
        <>
          <Avatar className="h-4 w-4">
            {currentAssignee.image && (
              <AvatarImage
                alt={currentAssignee.name ?? ""}
                src={currentAssignee.image}
              />
            )}
            <AvatarFallback className="text-[8px]">
              {getInitials(currentAssignee.name, currentAssignee.email)}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[100px] truncate text-xs">
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
      <DropdownMenuContent
        align={align}
        className="w-56"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Unassign option */}
        {currentAssignee && (
          <>
            <DropdownMenuItem onClick={() => handleAssign(null)}>
              <UserMinus className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Unassign</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}

        {/* Team members */}
        {members.length === 0 ? (
          <div className="px-2 py-4 text-center text-muted-foreground text-sm">
            No team members found
          </div>
        ) : (
          members.map((member) => {
            const isSelected = member.userId === currentAssignee?.id;
            return (
              <DropdownMenuItem
                className={cn(isSelected && "bg-accent")}
                key={member.userId}
                onClick={() => handleAssign(member.userId)}
              >
                <Avatar className="mr-2 h-6 w-6">
                  {member.user?.image && (
                    <AvatarImage
                      alt={member.user.name ?? ""}
                      src={member.user.image}
                    />
                  )}
                  <AvatarFallback className="text-[10px]">
                    {getInitials(
                      member.user?.name ?? null,
                      member.user?.email ?? ""
                    )}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {member.user?.name ?? member.user?.email}
                  </div>
                  {member.user?.name && (
                    <div className="truncate text-muted-foreground text-xs">
                      {member.user.email}
                    </div>
                  )}
                </div>
                {isSelected && <Check className="ml-2 h-4 w-4 shrink-0" />}
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
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-muted",
            sizes[size]
          )}
        >
          <User
            className={cn(
              "text-muted-foreground",
              size === "sm"
                ? "h-3 w-3"
                : size === "md"
                  ? "h-3.5 w-3.5"
                  : "h-4 w-4"
            )}
          />
        </div>
        {showName && (
          <span className="text-muted-foreground text-sm">Unassigned</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Avatar className={sizes[size]}>
        {assignee.image && (
          <AvatarImage alt={assignee.name ?? ""} src={assignee.image} />
        )}
        <AvatarFallback className={textSizes[size]}>
          {getInitials(assignee.name, assignee.email)}
        </AvatarFallback>
      </Avatar>
      {showName && (
        <span className="truncate text-sm">
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
