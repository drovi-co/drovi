// =============================================================================
// TASK DETAIL PAGE (Linear-style)
// =============================================================================
//
// Full-page task detail view with two-column layout:
// - Left: Title, description, activity feed
// - Right: Properties sidebar (status, priority, assignee, labels, due date)
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Send,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PriorityIcon, type Priority } from "@/components/ui/priority-icon";
import { StatusIcon, type Status } from "@/components/ui/status-icon";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { trpc, queryClient } from "@/utils/trpc";

import {
  TaskAssigneeDropdown,
  TaskLabelPicker,
  CompactActivityFeed,
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  SOURCE_TYPE_CONFIG,
  formatDueDate,
  type TaskData,
  type TaskStatus,
  type TaskPriority,
  type TaskSourceType,
} from "@/components/tasks";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/tasks/$taskId")({
  component: TaskDetailPage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function TaskDetailPage() {
  const navigate = useNavigate();
  const { taskId } = useParams({ from: "/dashboard/tasks/$taskId" });
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const queryClientInstance = useQueryClient();

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [newComment, setNewComment] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Fetch task details
  const {
    data: taskData,
    isLoading,
    refetch,
  } = useQuery({
    ...trpc.tasks.getById.queryOptions({
      organizationId,
      taskId,
    }),
    enabled: !!organizationId && !!taskId,
  });

  // Fetch activity
  const { data: activityData } = useQuery({
    ...trpc.tasks.getActivity.queryOptions({
      organizationId,
      taskId,
    }),
    enabled: !!organizationId && !!taskId,
  });

  // Mutations
  const updateMutation = useMutation({
    ...trpc.tasks.update.mutationOptions(),
    onSuccess: () => {
      refetch();
      queryClientInstance.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => {
      toast.error("Failed to update task");
    },
  });

  const updateStatusMutation = useMutation({
    ...trpc.tasks.updateStatus.mutationOptions(),
    onSuccess: () => {
      toast.success("Status updated");
      refetch();
      queryClientInstance.invalidateQueries({ queryKey: ["tasks"] });
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
      queryClientInstance.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: () => {
      toast.error("Failed to update priority");
    },
  });

  const addCommentMutation = useMutation({
    ...trpc.tasks.addComment.mutationOptions(),
    onSuccess: () => {
      setNewComment("");
      queryClientInstance.invalidateQueries({ queryKey: ["tasks", "activity"] });
    },
    onError: () => {
      toast.error("Failed to add comment");
    },
  });

  const deleteMutation = useMutation({
    ...trpc.tasks.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Task deleted");
      navigate({ to: "/dashboard/tasks" });
    },
    onError: () => {
      toast.error("Failed to delete task");
    },
  });

  // Transform task data
  const task: TaskData | null = taskData
    ? {
        id: taskData.id,
        title: taskData.title,
        description: taskData.description,
        status: taskData.status as TaskStatus,
        priority: taskData.priority as TaskPriority,
        sourceType: taskData.sourceType as TaskSourceType,
        dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
        completedAt: taskData.completedAt ? new Date(taskData.completedAt) : null,
        assignee: taskData.assignee ?? null,
        labels: taskData.labels ?? [],
        metadata: taskData.metadata ?? null,
        createdAt: new Date(taskData.createdAt),
        updatedAt: new Date(taskData.updatedAt),
      }
    : null;

  // Initialize form values when task loads
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
    }
  }, [task?.title, task?.description]);

  // Focus title input when editing
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // Focus description textarea when editing
  useEffect(() => {
    if (editingDescription && descriptionRef.current) {
      descriptionRef.current.focus();
    }
  }, [editingDescription]);

  // Handlers
  const handleBack = useCallback(() => {
    navigate({ to: "/dashboard/tasks" });
  }, [navigate]);

  const handleSaveTitle = useCallback(() => {
    if (task && title !== task.title && title.trim()) {
      updateMutation.mutate({
        organizationId,
        taskId: task.id,
        title: title.trim(),
      });
    }
    setEditingTitle(false);
  }, [task, title, updateMutation, organizationId]);

  const handleSaveDescription = useCallback(() => {
    if (task && description !== (task.description ?? "")) {
      updateMutation.mutate({
        organizationId,
        taskId: task.id,
        description: description || null,
      });
    }
    setEditingDescription(false);
  }, [task, description, updateMutation, organizationId]);

  const handleStatusChange = useCallback(
    (newStatus: TaskStatus) => {
      if (!task) return;
      updateStatusMutation.mutate({
        organizationId,
        taskId: task.id,
        status: newStatus,
      });
    },
    [task, updateStatusMutation, organizationId]
  );

  const handlePriorityChange = useCallback(
    (newPriority: TaskPriority) => {
      if (!task) return;
      updatePriorityMutation.mutate({
        organizationId,
        taskId: task.id,
        priority: newPriority,
      });
    },
    [task, updatePriorityMutation, organizationId]
  );

  const handleDueDateChange = useCallback(
    (date: Date | undefined) => {
      if (!task) return;
      updateMutation.mutate({
        organizationId,
        taskId: task.id,
        dueDate: date ?? null,
      });
    },
    [task, updateMutation, organizationId]
  );

  const handleAddComment = useCallback(() => {
    if (!task || !newComment.trim()) return;
    addCommentMutation.mutate({
      organizationId,
      taskId: task.id,
      comment: newComment.trim(),
    });
  }, [task, newComment, addCommentMutation, organizationId]);

  const handleDelete = useCallback(() => {
    if (!task) return;
    if (window.confirm("Are you sure you want to delete this task?")) {
      deleteMutation.mutate({
        organizationId,
        taskId: task.id,
      });
    }
  }, [task, deleteMutation, organizationId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingTitle) {
          setTitle(task?.title ?? "");
          setEditingTitle(false);
          return;
        }
        if (editingDescription) {
          setDescription(task?.description ?? "");
          setEditingDescription(false);
          return;
        }
        handleBack();
        return;
      }

      // Don't trigger shortcuts when editing
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Status shortcuts (1-6)
      const statusKeys: Record<string, TaskStatus> = {
        "1": "backlog",
        "2": "todo",
        "3": "in_progress",
        "4": "in_review",
        "5": "done",
        "6": "cancelled",
      };
      if (statusKeys[e.key] && task) {
        handleStatusChange(statusKeys[e.key]);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleBack, task, editingTitle, editingDescription, handleStatusChange]);

  // Loading state
  if (isLoading) {
    return <TaskDetailSkeleton />;
  }

  // Not found state
  if (!task) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-medium">Task not found</h2>
          <p className="text-sm text-muted-foreground mt-1">
            This task may have been deleted or you don't have access.
          </p>
          <Button className="mt-4" onClick={handleBack}>
            Back to Tasks
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[task.status];
  const priorityConfig = PRIORITY_CONFIG[task.priority];
  const sourceConfig = SOURCE_TYPE_CONFIG[task.sourceType];
  const dueInfo = formatDueDate(task.dueDate);

  // Map status to StatusIcon status
  const iconStatus: Status =
    task.status === "backlog"
      ? "backlog"
      : task.status === "todo"
        ? "todo"
        : task.status === "in_progress" || task.status === "in_review"
          ? "in_progress"
          : task.status === "done"
            ? "done"
            : "canceled";

  // Map priority to PriorityIcon priority
  const iconPriority: Priority =
    task.priority === "urgent"
      ? "urgent"
      : task.priority === "high"
        ? "high"
        : task.priority === "medium"
          ? "medium"
          : task.priority === "low"
            ? "low"
            : "none";

  return (
    <div data-no-shell-padding className="h-full">
      <div className="h-[calc(100vh-var(--header-height))] flex flex-col bg-[#1a1b26]">
        {/* Top Navigation Bar */}
        <div className="border-b border-[#2a2b3d] bg-[#1a1b26] shrink-0 z-20">
          <div className="flex items-center gap-3 px-4 py-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleBack}
                    className="h-8 w-8 hover:bg-[#2a2b3d]"
                  >
                    <ArrowLeft className="h-4 w-4 text-[#858699]" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Back (Esc)</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[#858699]">Tasks</span>
              <span className="text-[#4c4f6b]">/</span>
              <span className="text-[#eeeffc] font-medium truncate max-w-[300px]">
                {task.title}
              </span>
            </div>

            <div className="flex-1" />

            {/* Actions */}
            <div className="flex items-center gap-1">
              {/* Source link */}
              {task.metadata?.sourceUrl && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:bg-[#2a2b3d]"
                        onClick={() => window.open(task.metadata?.sourceUrl, "_blank")}
                      >
                        <ExternalLink className="h-4 w-4 text-[#858699]" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View source</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* More actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-[#2a2b3d]">
                    <MoreHorizontal className="h-4 w-4 text-[#858699]" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={handleDelete}
                    className="text-red-500 focus:text-red-500"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column - Main Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Title */}
              <div>
                {editingTitle ? (
                  <Input
                    ref={titleInputRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSaveTitle();
                      }
                      if (e.key === "Escape") {
                        setTitle(task.title);
                        setEditingTitle(false);
                      }
                    }}
                    className="text-2xl font-semibold bg-transparent border-none px-0 h-auto py-1 text-[#eeeffc] focus-visible:ring-0 focus-visible:ring-offset-0"
                    placeholder="Task title..."
                  />
                ) : (
                  <h1
                    className="text-2xl font-semibold text-[#eeeffc] cursor-pointer hover:text-[#eeeffc]/80 transition-colors py-1"
                    onClick={() => setEditingTitle(true)}
                  >
                    {task.title}
                  </h1>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="text-sm font-medium text-[#858699] mb-2 block">
                  Description
                </label>
                {editingDescription ? (
                  <Textarea
                    ref={descriptionRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={handleSaveDescription}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setDescription(task.description ?? "");
                        setEditingDescription(false);
                      }
                      // Allow Cmd+Enter to save
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleSaveDescription();
                      }
                    }}
                    rows={6}
                    placeholder="Add a description..."
                    className="bg-[#21232e] border-[#2a2b3d] text-[#eeeffc] placeholder:text-[#4c4f6b] focus:border-[#5e6ad2] resize-none"
                  />
                ) : (
                  <div
                    className="min-h-[120px] p-4 rounded-lg border border-[#2a2b3d] bg-[#21232e] text-sm text-[#d2d3e0] cursor-pointer hover:border-[#3a3b4d] transition-colors whitespace-pre-wrap"
                    onClick={() => setEditingDescription(true)}
                  >
                    {task.description || (
                      <span className="text-[#4c4f6b]">Click to add description...</span>
                    )}
                  </div>
                )}
              </div>

              {/* Source Preview */}
              {task.metadata?.sourceSnippet && (
                <div>
                  <label className="text-sm font-medium text-[#858699] mb-2 block">
                    Source Preview
                  </label>
                  <div className="p-4 rounded-lg border border-[#2a2b3d] bg-[#21232e]/50 text-sm text-[#858699] whitespace-pre-wrap">
                    {task.metadata.sourceSnippet}
                  </div>
                </div>
              )}

              {/* Activity / Comments */}
              <div className="pt-6 border-t border-[#2a2b3d]">
                <div className="flex items-center gap-2 mb-4">
                  <MessageSquare className="h-4 w-4 text-[#858699]" />
                  <span className="text-sm font-medium text-[#eeeffc]">Activity</span>
                </div>

                {/* Add Comment */}
                <div className="flex gap-3 mb-6">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-[#5e6ad2] text-white text-xs">
                      ME
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 flex gap-2">
                    <Input
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment..."
                      className="flex-1 bg-[#21232e] border-[#2a2b3d] text-[#eeeffc] placeholder:text-[#4c4f6b] focus:border-[#5e6ad2]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleAddComment();
                        }
                      }}
                    />
                    <Button
                      size="icon"
                      onClick={handleAddComment}
                      disabled={!newComment.trim() || addCommentMutation.isPending}
                      className="bg-[#5e6ad2] hover:bg-[#5e6ad2]/90"
                    >
                      {addCommentMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Activity Feed */}
                <CompactActivityFeed
                  taskId={task.id}
                  organizationId={organizationId}
                />
              </div>

              {/* Timestamps */}
              <div className="pt-4 border-t border-[#2a2b3d] text-xs text-[#4c4f6b] space-y-1">
                <div>Created: {format(task.createdAt, "MMM d, yyyy 'at' h:mm a")}</div>
                <div>Updated: {format(task.updatedAt, "MMM d, yyyy 'at' h:mm a")}</div>
              </div>
            </div>
          </div>

          {/* Right Column - Properties Sidebar */}
          <div className="w-[280px] shrink-0 border-l border-[#2a2b3d] bg-[#1a1b26] overflow-y-auto p-4">
            <div className="space-y-4">
              {/* Status */}
              <PropertyRow label="Status">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#2a2b3d] transition-colors w-full">
                      <StatusIcon status={iconStatus} size="sm" />
                      <span className="text-sm text-[#d2d3e0]">{statusConfig.label}</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map((status) => {
                      const config = STATUS_CONFIG[status];
                      const statusIcon: Status =
                        status === "backlog"
                          ? "backlog"
                          : status === "todo"
                            ? "todo"
                            : status === "in_progress" || status === "in_review"
                              ? "in_progress"
                              : status === "done"
                                ? "done"
                                : "canceled";
                      return (
                        <DropdownMenuItem
                          key={status}
                          onClick={() => handleStatusChange(status)}
                          className={cn(status === task.status && "bg-accent")}
                        >
                          <StatusIcon status={statusIcon} size="sm" className="mr-2" />
                          {config.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </PropertyRow>

              {/* Priority */}
              <PropertyRow label="Priority">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#2a2b3d] transition-colors w-full">
                      <PriorityIcon priority={iconPriority} size="sm" />
                      <span className="text-sm text-[#d2d3e0]">{priorityConfig.label}</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {(Object.keys(PRIORITY_CONFIG) as TaskPriority[]).map((priority) => {
                      const config = PRIORITY_CONFIG[priority];
                      const priorityIcon: Priority =
                        priority === "urgent"
                          ? "urgent"
                          : priority === "high"
                            ? "high"
                            : priority === "medium"
                              ? "medium"
                              : priority === "low"
                                ? "low"
                                : "none";
                      return (
                        <DropdownMenuItem
                          key={priority}
                          onClick={() => handlePriorityChange(priority)}
                          className={cn(priority === task.priority && "bg-accent")}
                        >
                          <PriorityIcon priority={priorityIcon} size="sm" className="mr-2" />
                          {config.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </PropertyRow>

              {/* Assignee */}
              <PropertyRow label="Assignee">
                <TaskAssigneeDropdown
                  taskId={task.id}
                  organizationId={organizationId}
                  currentAssignee={task.assignee}
                  trigger={
                    <button className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#2a2b3d] transition-colors w-full">
                      {task.assignee ? (
                        <>
                          <Avatar className="h-5 w-5">
                            {task.assignee.image && (
                              <AvatarImage
                                src={task.assignee.image}
                                alt={task.assignee.name ?? ""}
                              />
                            )}
                            <AvatarFallback className="text-[9px] bg-[#5e6ad2] text-white">
                              {getInitials(task.assignee.name, task.assignee.email)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-[#d2d3e0] truncate">
                            {task.assignee.name ?? task.assignee.email}
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="h-5 w-5 rounded-full border border-[#4c4f6b] border-dashed flex items-center justify-center">
                            <User className="h-3 w-3 text-[#4c4f6b]" />
                          </div>
                          <span className="text-sm text-[#4c4f6b]">No assignee</span>
                        </>
                      )}
                    </button>
                  }
                />
              </PropertyRow>

              {/* Labels */}
              <PropertyRow label="Labels">
                <div className="px-2 py-1.5">
                  {task.labels.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {task.labels.map((label) => (
                        <span
                          key={label.id}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: `${label.color}20`, color: label.color }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: label.color }}
                          />
                          {label.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <TaskLabelPicker
                    taskId={task.id}
                    organizationId={organizationId}
                    selectedLabels={task.labels}
                    trigger={
                      <button className="flex items-center gap-1.5 text-sm text-[#4c4f6b] hover:text-[#858699] transition-colors">
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add label</span>
                      </button>
                    }
                  />
                </div>
              </PropertyRow>

              {/* Due Date */}
              <PropertyRow label="Due date">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <Calendar className="h-4 w-4 text-[#858699]" />
                  <input
                    type="date"
                    value={task.dueDate ? format(task.dueDate, "yyyy-MM-dd") : ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) {
                        handleDueDateChange(new Date(value));
                      } else {
                        handleDueDateChange(undefined);
                      }
                    }}
                    className={cn(
                      "text-sm bg-transparent border-none outline-none cursor-pointer",
                      task.dueDate ? (dueInfo?.className ?? "text-[#d2d3e0]") : "text-[#4c4f6b]"
                    )}
                  />
                  {task.dueDate && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 ml-auto text-[#4c4f6b] hover:text-[#858699]"
                      onClick={() => handleDueDateChange(undefined)}
                    >
                      ×
                    </Button>
                  )}
                </div>
              </PropertyRow>

              {/* Source Type */}
              <PropertyRow label="Source">
                <div className="px-2 py-1.5">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-xs",
                      sourceConfig.bgColor,
                      sourceConfig.color
                    )}
                  >
                    {sourceConfig.label}
                  </Badge>
                </div>
              </PropertyRow>

              {/* Keyboard shortcuts hint */}
              <div className="pt-4 border-t border-[#2a2b3d]">
                <div className="text-xs text-[#4c4f6b] space-y-1">
                  <div className="flex items-center justify-between">
                    <span>Set status</span>
                    <span className="font-mono">1-6</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Go back</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-[#2a2b3d] text-[#858699]">Esc</kbd>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-[#4c4f6b] uppercase tracking-wide mb-1 block">
        {label}
      </label>
      {children}
    </div>
  );
}

function TaskDetailSkeleton() {
  return (
    <div className="h-full bg-[#1a1b26]">
      <div className="flex flex-col h-[calc(100vh-var(--header-height))]">
        {/* Header skeleton */}
        <div className="border-b border-[#2a2b3d] p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 bg-[#2a2b3d]" />
            <Skeleton className="h-4 w-48 bg-[#2a2b3d]" />
          </div>
        </div>

        {/* Content skeleton */}
        <div className="flex flex-1">
          <div className="flex-1 p-6">
            <div className="max-w-2xl mx-auto space-y-6">
              <Skeleton className="h-8 w-3/4 bg-[#2a2b3d]" />
              <Skeleton className="h-32 w-full bg-[#2a2b3d]" />
              <Skeleton className="h-24 w-full bg-[#2a2b3d]" />
            </div>
          </div>
          <div className="w-[280px] border-l border-[#2a2b3d] p-4 space-y-4">
            <Skeleton className="h-10 w-full bg-[#2a2b3d]" />
            <Skeleton className="h-10 w-full bg-[#2a2b3d]" />
            <Skeleton className="h-10 w-full bg-[#2a2b3d]" />
            <Skeleton className="h-10 w-full bg-[#2a2b3d]" />
          </div>
        </div>
      </div>
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
