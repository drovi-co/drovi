// =============================================================================
// TASK DETAIL PAGE (Linear-style)
// =============================================================================
//
// Full-page task detail view with two-column layout:
// - Left: Title, description, activity feed
// - Right: Properties sidebar (status, priority, assignee, labels, due date)
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { format } from "date-fns";
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
import {
  CompactActivityFeed,
  formatDueDate,
  PRIORITY_CONFIG,
  SOURCE_TYPE_CONFIG,
  STATUS_CONFIG,
  TaskAssigneeDropdown,
  type TaskData,
  TaskLabelPicker,
  type TaskPriority,
  type TaskSourceType,
  type TaskStatus,
} from "@/components/tasks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { type Priority, PriorityIcon } from "@/components/ui/priority-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { type Status, StatusIcon } from "@/components/ui/status-icon";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

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

  // Mutations - use proper tRPC query key pattern [["tasks"]] for invalidation
  const updateMutation = useMutation({
    ...trpc.tasks.update.mutationOptions(),
    onSuccess: () => {
      refetch();
      // tRPC uses nested array keys like [["tasks", "list"], { input }]
      queryClientInstance.invalidateQueries({ queryKey: [["tasks"]] });
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
      queryClientInstance.invalidateQueries({ queryKey: [["tasks"]] });
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
      queryClientInstance.invalidateQueries({ queryKey: [["tasks"]] });
    },
    onError: () => {
      toast.error("Failed to update priority");
    },
  });

  const addCommentMutation = useMutation({
    ...trpc.tasks.addComment.mutationOptions(),
    onSuccess: () => {
      setNewComment("");
      queryClientInstance.invalidateQueries({ queryKey: [["tasks"]] });
    },
    onError: () => {
      toast.error("Failed to add comment");
    },
  });

  const deleteMutation = useMutation({
    ...trpc.tasks.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Task deleted");
      queryClientInstance.invalidateQueries({ queryKey: [["tasks"]] });
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
        completedAt: taskData.completedAt
          ? new Date(taskData.completedAt)
          : null,
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
        description: description || undefined,
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
    if (!(task && newComment.trim())) return;
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
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="font-medium text-lg">Task not found</h2>
          <p className="mt-1 text-muted-foreground text-sm">
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
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col bg-card">
        {/* Top Navigation Bar */}
        <div className="z-20 shrink-0 border-border border-b bg-card">
          <div className="flex items-center gap-3 px-4 py-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8 hover:bg-accent"
                    onClick={handleBack}
                    size="icon"
                    variant="ghost"
                  >
                    <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Back (Esc)</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Tasks</span>
              <span className="text-muted-foreground">/</span>
              <span className="max-w-[300px] truncate font-medium text-foreground">
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
                        className="h-8 w-8 hover:bg-accent"
                        onClick={() =>
                          window.open(task.metadata?.sourceUrl, "_blank")
                        }
                        size="icon"
                        variant="ghost"
                      >
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View source</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* More actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="h-8 w-8 hover:bg-accent"
                    size="icon"
                    variant="ghost"
                  >
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    className="text-red-500 focus:text-red-500"
                    onClick={handleDelete}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Column - Main Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl space-y-6">
              {/* Title */}
              <div>
                {editingTitle ? (
                  <Input
                    className="h-auto border-none bg-transparent px-0 py-1 font-semibold text-2xl text-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
                    onBlur={handleSaveTitle}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleSaveTitle();
                      }
                      if (e.key === "Escape") {
                        setTitle(task.title);
                        setEditingTitle(false);
                      }
                    }}
                    placeholder="Task title..."
                    ref={titleInputRef}
                    value={title}
                  />
                ) : (
                  <h1
                    className="cursor-pointer py-1 font-semibold text-2xl text-foreground transition-colors hover:text-foreground/80"
                    onClick={() => setEditingTitle(true)}
                  >
                    {task.title}
                  </h1>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="mb-2 block font-medium text-muted-foreground text-sm">
                  Description
                </label>
                {editingDescription ? (
                  <Textarea
                    className="resize-none border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-secondary"
                    onBlur={handleSaveDescription}
                    onChange={(e) => setDescription(e.target.value)}
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
                    placeholder="Add a description..."
                    ref={descriptionRef}
                    rows={6}
                    value={description}
                  />
                ) : (
                  <div
                    className="min-h-[120px] cursor-pointer whitespace-pre-wrap rounded-lg border border-border bg-muted p-4 text-foreground text-sm transition-colors hover:border-border"
                    onClick={() => setEditingDescription(true)}
                  >
                    {task.description || (
                      <span className="text-muted-foreground">
                        Click to add description...
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Source Preview */}
              {task.metadata?.sourceSnippet && (
                <div>
                  <label className="mb-2 block font-medium text-muted-foreground text-sm">
                    Source Preview
                  </label>
                  <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/50 p-4 text-muted-foreground text-sm">
                    {task.metadata.sourceSnippet}
                  </div>
                </div>
              )}

              {/* Activity / Comments */}
              <div className="border-border border-t pt-6">
                <div className="mb-4 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-foreground text-sm">
                    Activity
                  </span>
                </div>

                {/* Add Comment */}
                <div className="mb-6 flex gap-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-secondary text-white text-xs">
                      ME
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 gap-2">
                    <Input
                      className="flex-1 border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-secondary"
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleAddComment();
                        }
                      }}
                      placeholder="Add a comment..."
                      value={newComment}
                    />
                    <Button
                      className="bg-secondary hover:bg-secondary/90"
                      disabled={
                        !newComment.trim() || addCommentMutation.isPending
                      }
                      onClick={handleAddComment}
                      size="icon"
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
                  organizationId={organizationId}
                  taskId={task.id}
                />
              </div>

              {/* Timestamps */}
              <div className="space-y-1 border-border border-t pt-4 text-muted-foreground text-xs">
                <div>
                  Created: {format(task.createdAt, "MMM d, yyyy 'at' h:mm a")}
                </div>
                <div>
                  Updated: {format(task.updatedAt, "MMM d, yyyy 'at' h:mm a")}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Properties Sidebar */}
          <div className="w-[280px] shrink-0 overflow-y-auto border-border border-l bg-card p-4">
            <div className="space-y-4">
              {/* Status */}
              <PropertyRow label="Status">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-accent">
                      <StatusIcon size="sm" status={iconStatus} />
                      <span className="text-foreground text-sm">
                        {statusConfig.label}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {(Object.keys(STATUS_CONFIG) as TaskStatus[]).map(
                      (status) => {
                        const config = STATUS_CONFIG[status];
                        const statusIcon: Status =
                          status === "backlog"
                            ? "backlog"
                            : status === "todo"
                              ? "todo"
                              : status === "in_progress" ||
                                  status === "in_review"
                                ? "in_progress"
                                : status === "done"
                                  ? "done"
                                  : "canceled";
                        return (
                          <DropdownMenuItem
                            className={cn(
                              status === task.status && "bg-accent"
                            )}
                            key={status}
                            onClick={() => handleStatusChange(status)}
                          >
                            <StatusIcon
                              className="mr-2"
                              size="sm"
                              status={statusIcon}
                            />
                            {config.label}
                          </DropdownMenuItem>
                        );
                      }
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </PropertyRow>

              {/* Priority */}
              <PropertyRow label="Priority">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-accent">
                      <PriorityIcon priority={iconPriority} size="sm" />
                      <span className="text-foreground text-sm">
                        {priorityConfig.label}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {(Object.keys(PRIORITY_CONFIG) as TaskPriority[]).map(
                      (priority) => {
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
                            className={cn(
                              priority === task.priority && "bg-accent"
                            )}
                            key={priority}
                            onClick={() => handlePriorityChange(priority)}
                          >
                            <PriorityIcon
                              className="mr-2"
                              priority={priorityIcon}
                              size="sm"
                            />
                            {config.label}
                          </DropdownMenuItem>
                        );
                      }
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </PropertyRow>

              {/* Assignee */}
              <PropertyRow label="Assignee">
                <TaskAssigneeDropdown
                  currentAssignee={task.assignee}
                  organizationId={organizationId}
                  taskId={task.id}
                  trigger={
                    <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-accent">
                      {task.assignee ? (
                        <>
                          <Avatar className="h-5 w-5">
                            {task.assignee.image && (
                              <AvatarImage
                                alt={task.assignee.name ?? ""}
                                src={task.assignee.image}
                              />
                            )}
                            <AvatarFallback className="bg-secondary text-[9px] text-white">
                              {getInitials(
                                task.assignee.name,
                                task.assignee.email
                              )}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate text-foreground text-sm">
                            {task.assignee.name ?? task.assignee.email}
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-muted-foreground border-dashed">
                            <User className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <span className="text-muted-foreground text-sm">
                            No assignee
                          </span>
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
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {task.labels.map((label) => (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                          key={label.id}
                          style={{
                            backgroundColor: `${label.color}20`,
                            color: label.color,
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: label.color }}
                          />
                          {label.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <TaskLabelPicker
                    organizationId={organizationId}
                    selectedLabels={task.labels}
                    taskId={task.id}
                    trigger={
                      <button className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-muted-foreground">
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
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <input
                    className={cn(
                      "cursor-pointer border-none bg-transparent text-sm outline-none",
                      task.dueDate
                        ? (dueInfo?.className ?? "text-foreground")
                        : "text-muted-foreground"
                    )}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) {
                        handleDueDateChange(new Date(value));
                      } else {
                        handleDueDateChange(undefined);
                      }
                    }}
                    type="date"
                    value={
                      task.dueDate ? format(task.dueDate, "yyyy-MM-dd") : ""
                    }
                  />
                  {task.dueDate && (
                    <Button
                      className="ml-auto h-6 w-6 text-muted-foreground hover:text-muted-foreground"
                      onClick={() => handleDueDateChange(undefined)}
                      size="icon"
                      variant="ghost"
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
                    className={cn(
                      "text-xs",
                      sourceConfig.bgColor,
                      sourceConfig.color
                    )}
                    variant="secondary"
                  >
                    {sourceConfig.label}
                  </Badge>
                </div>
              </PropertyRow>

              {/* Keyboard shortcuts hint */}
              <div className="border-border border-t pt-4">
                <div className="space-y-1 text-muted-foreground text-xs">
                  <div className="flex items-center justify-between">
                    <span>Set status</span>
                    <span className="font-mono">1-6</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Go back</span>
                    <kbd className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                      Esc
                    </kbd>
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
      <label className="mb-1 block font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}

function TaskDetailSkeleton() {
  return (
    <div className="h-full bg-card">
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Header skeleton */}
        <div className="border-border border-b p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 bg-muted" />
            <Skeleton className="h-4 w-48 bg-muted" />
          </div>
        </div>

        {/* Content skeleton */}
        <div className="flex flex-1">
          <div className="flex-1 p-6">
            <div className="mx-auto max-w-2xl space-y-6">
              <Skeleton className="h-8 w-3/4 bg-muted" />
              <Skeleton className="h-32 w-full bg-muted" />
              <Skeleton className="h-24 w-full bg-muted" />
            </div>
          </div>
          <div className="w-[280px] space-y-4 border-border border-l p-4">
            <Skeleton className="h-10 w-full bg-muted" />
            <Skeleton className="h-10 w-full bg-muted" />
            <Skeleton className="h-10 w-full bg-muted" />
            <Skeleton className="h-10 w-full bg-muted" />
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
