// =============================================================================
// TASK DETAIL PAGE (Linear-style)
// =============================================================================
//
// Full-page task detail view with two-column layout:
// - Left: Title, description, activity feed
// - Right: Properties sidebar (status, priority, assignee, labels, due date)
//

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@memorystack/ui-core/alert-dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@memorystack/ui-core/avatar";
import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@memorystack/ui-core/dropdown-menu";
import { Input } from "@memorystack/ui-core/input";
import {
  type Priority,
  PriorityIcon,
} from "@memorystack/ui-core/priority-icon";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import { type Status, StatusIcon } from "@memorystack/ui-core/status-icon";
import { Textarea } from "@memorystack/ui-core/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@memorystack/ui-core/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import {
  ArrowLeft,
  Calendar,
  Clock,
  ExternalLink,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  formatDueDate,
  PRIORITY_CONFIG,
  SOURCE_TYPE_CONFIG,
  STATUS_CONFIG,
  type TaskData,
  type TaskPriority,
  type TaskStatus,
} from "@/components/tasks";
import {
  useArchiveUIO,
  useCorrectUIO,
  useUIO,
  useUpdateTaskPriorityUIO,
  useUpdateTaskStatusUIO,
} from "@/hooks/use-uio";
import { useI18n } from "@/i18n";
import { authClient } from "@/lib/auth-client";
import { formatRelativeTime } from "@/lib/intl-time";
import { cn } from "@/lib/utils";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

const searchSchema = z.object({
  from: z.string().optional(), // Return URL for smart back navigation
});

export const Route = createFileRoute("/dashboard/tasks/$taskId")({
  component: TaskDetailPage,
  validateSearch: searchSchema,
});

type TaskTimelineEvent = {
  id: string;
  eventDescription: string;
  eventAt: string;
};

function normalizeTaskStatus(status: string | null | undefined): TaskStatus {
  switch (status) {
    case "backlog":
    case "todo":
    case "in_progress":
    case "in_review":
    case "done":
    case "cancelled":
      return status;
    case "open":
      return "todo";
    case "completed":
      return "done";
    default:
      return "todo";
  }
}

function normalizeTaskPriority(
  priority: string | null | undefined
): TaskPriority {
  switch (priority) {
    case "low":
    case "medium":
    case "high":
    case "urgent":
    case "no_priority":
      return priority;
    default:
      return "no_priority";
  }
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function TaskDetailPage() {
  const navigate = useNavigate();
  const { taskId } = useParams({ from: "/dashboard/tasks/$taskId" });
  const search = Route.useSearch();
  const returnUrl = search.from;
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const queryClientInstance = useQueryClient();
  const { locale, t: tr } = useI18n();

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Fetch task details using UIO
  const {
    data: uioData,
    isLoading,
    refetch,
  } = useUIO({
    organizationId,
    id: taskId,
    enabled: !!organizationId && !!taskId,
  });

  // Transform UIO data to legacy task format
  const taskData = uioData
    ? (() => {
        const timeline: TaskTimelineEvent[] = [];
        if (uioData.createdAt) {
          timeline.push({
            id: "created",
            eventDescription: tr(
              "pages.dashboard.tasks.detail.timeline.created"
            ),
            eventAt: uioData.createdAt,
          });
        }
        if (uioData.updatedAt) {
          timeline.push({
            id: "updated",
            eventDescription: tr(
              "pages.dashboard.tasks.detail.timeline.updated"
            ),
            eventAt: uioData.updatedAt,
          });
        }
        if (uioData.dueDate) {
          timeline.push({
            id: "due-date",
            eventDescription: tr(
              "pages.dashboard.tasks.detail.timeline.dueDateSet"
            ),
            eventAt: uioData.dueDate,
          });
        }
        if (uioData.taskDetails?.completedAt) {
          timeline.push({
            id: "completed",
            eventDescription: tr(
              "pages.dashboard.tasks.detail.timeline.completed"
            ),
            eventAt: uioData.taskDetails.completedAt,
          });
        }
        timeline.sort(
          (a, b) =>
            new Date(a.eventAt).getTime() - new Date(b.eventAt).getTime()
        );

        const assignee = uioData.assignee
          ? {
              id: uioData.assignee.id,
              name: uioData.assignee.displayName,
              email: uioData.assignee.primaryEmail,
              image: uioData.assignee.avatarUrl,
            }
          : null;

        return {
          id: uioData.id,
          title: uioData.userCorrectedTitle ?? uioData.canonicalTitle ?? "",
          description: uioData.canonicalDescription ?? null,
          status: normalizeTaskStatus(uioData.taskDetails?.status),
          priority: normalizeTaskPriority(uioData.taskDetails?.priority),
          sourceType: uioData.sources?.length ? "conversation" : "manual",
          dueDate: uioData.dueDate ? new Date(uioData.dueDate) : null,
          completedAt: uioData.taskDetails?.completedAt
            ? new Date(uioData.taskDetails.completedAt)
            : null,
          assignee,
          labels: [] as Array<{ id: string; name: string; color: string }>,
          metadata: null,
          createdAt: new Date(uioData.createdAt),
          updatedAt: uioData.updatedAt
            ? new Date(uioData.updatedAt)
            : new Date(uioData.createdAt),
          // UIO-specific fields
          sources: uioData.sources ?? [],
          timeline,
        } satisfies TaskData & {
          sources: typeof uioData.sources;
          timeline: TaskTimelineEvent[];
        };
      })()
    : null;

  // UIO update mutation
  const updateMutationBase = useCorrectUIO();
  const updateMutation = {
    ...updateMutationBase,
    mutate: (params: {
      organizationId: string;
      taskId: string;
      title?: string;
      description?: string | null;
      dueDate?: Date | null;
    }) => {
      updateMutationBase.mutate(
        {
          organizationId: params.organizationId,
          id: params.taskId,
          updates: {
            canonical_title: params.title ?? undefined,
            canonical_description: params.description ?? undefined,
            due_date: params.dueDate ? params.dueDate.toISOString() : undefined,
          },
        },
        {
          onSuccess: () => {
            refetch();
            queryClientInstance.invalidateQueries({ queryKey: [["uio"]] });
          },
          onError: () => {
            toast.error(tr("pages.dashboard.tasks.detail.toasts.updateFailed"));
          },
        }
      );
    },
  };

  // UIO-based status mutation
  const updateStatusMutationBase = useUpdateTaskStatusUIO();
  const updateStatusMutation = {
    ...updateStatusMutationBase,
    mutate: (params: {
      organizationId: string;
      taskId: string;
      status: TaskStatus;
    }) => {
      updateStatusMutationBase.mutate(
        {
          organizationId: params.organizationId,
          id: params.taskId,
          status: params.status,
        },
        {
          onSuccess: () => {
            toast.success(tr("pages.dashboard.tasks.toasts.statusUpdated"));
            refetch();
            queryClientInstance.invalidateQueries({ queryKey: [["uio"]] });
          },
          onError: () => {
            toast.error(tr("pages.dashboard.tasks.toasts.statusUpdateFailed"));
          },
        }
      );
    },
  };

  // UIO-based priority mutation
  const updatePriorityMutationBase = useUpdateTaskPriorityUIO();
  const updatePriorityMutation = {
    ...updatePriorityMutationBase,
    mutate: (params: {
      organizationId: string;
      taskId: string;
      priority: TaskPriority;
    }) => {
      updatePriorityMutationBase.mutate(
        {
          organizationId: params.organizationId,
          id: params.taskId,
          priority: params.priority,
        },
        {
          onSuccess: () => {
            toast.success(tr("pages.dashboard.tasks.toasts.priorityUpdated"));
            refetch();
            queryClientInstance.invalidateQueries({ queryKey: [["uio"]] });
          },
          onError: () => {
            toast.error(
              tr("pages.dashboard.tasks.toasts.priorityUpdateFailed")
            );
          },
        }
      );
    },
  };

  // Archive mutation for "delete"
  const archiveMutationBase = useArchiveUIO();
  const deleteMutation = {
    ...archiveMutationBase,
    mutate: (params: { organizationId: string; taskId: string }) => {
      archiveMutationBase.mutate(
        { organizationId: params.organizationId, id: params.taskId },
        {
          onSuccess: () => {
            toast.success(tr("pages.dashboard.tasks.toasts.archived"));
            queryClientInstance.invalidateQueries({ queryKey: [["uio"]] });
            navigate({ to: "/dashboard/tasks" });
          },
          onError: () => {
            toast.error(
              tr("pages.dashboard.tasks.detail.toasts.archiveFailed")
            );
          },
        }
      );
    },
  };

  // Use transformed taskData directly as task
  const task: TaskData | null = taskData ? taskData : null;

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
    if (returnUrl) {
      navigate({ to: returnUrl });
    } else {
      navigate({ to: "/dashboard/tasks" });
    }
  }, [navigate, returnUrl]);

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
      if (!task) {
        return;
      }
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
      if (!task) {
        return;
      }
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
      if (!task) {
        return;
      }
      updateMutation.mutate({
        organizationId,
        taskId: task.id,
        dueDate: date ?? null,
      });
    },
    [task, updateMutation, organizationId]
  );

  const handleDelete = useCallback(() => {
    if (!task) return;
    setDeleteDialogOpen(true);
  }, [task]);

  const confirmDelete = useCallback(() => {
    if (!task) return;
    setDeleteDialogOpen(false);
    deleteMutation.mutate({
      organizationId,
      taskId: task.id,
    });
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
          <h2 className="font-medium text-lg">
            {tr("pages.dashboard.tasks.detail.notFound.title")}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            {tr("pages.dashboard.tasks.detail.notFound.description")}
          </p>
          <Button className="mt-4" onClick={handleBack}>
            {tr("pages.dashboard.tasks.detail.notFound.back")}
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[task.status];
  const priorityConfig = PRIORITY_CONFIG[task.priority];
  const sourceConfig = SOURCE_TYPE_CONFIG[task.sourceType];
  const dueInfo = formatDueDate(task.dueDate, { locale, t: tr });

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
      <AlertDialog onOpenChange={setDeleteDialogOpen} open={deleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tr("pages.dashboard.tasks.detail.actions.deleteTask")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tr("pages.dashboard.tasks.detail.confirmDelete")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("common.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              {tr("pages.dashboard.tasks.detail.actions.deleteTask")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                <TooltipContent>
                  {tr("pages.dashboard.tasks.detail.tooltips.back")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {tr("nav.items.tasks")}
              </span>
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
                    <TooltipContent>
                      {tr("components.timeline.actions.viewSource")}
                    </TooltipContent>
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
                    {tr("pages.dashboard.tasks.detail.actions.deleteTask")}
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
                    placeholder={tr(
                      "pages.dashboard.tasks.detail.fields.title.placeholder"
                    )}
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
                  {tr("pages.dashboard.tasks.detail.fields.description.label")}
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
                    placeholder={tr(
                      "pages.dashboard.tasks.detail.fields.description.placeholder"
                    )}
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
                        {tr(
                          "pages.dashboard.tasks.detail.fields.description.emptyHint"
                        )}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Source Preview */}
              {task.metadata?.sourceSnippet && (
                <div>
                  <label className="mb-2 block font-medium text-muted-foreground text-sm">
                    {tr("pages.dashboard.tasks.detail.sections.sourcePreview")}
                  </label>
                  <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/50 p-4 text-muted-foreground text-sm">
                    {task.metadata.sourceSnippet}
                  </div>
                </div>
              )}

              {/* Sources */}
              {taskData?.sources && taskData.sources.length > 0 && (
                <div className="border-border border-t pt-6">
                  <div className="mb-4 flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground text-sm">
                      {tr("pages.dashboard.tasks.detail.sections.sources", {
                        count: taskData.sources.length,
                      })}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {taskData.sources.map((source, index) => (
                      <div
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/50 p-3 transition-colors hover:border-secondary/50 hover:bg-muted"
                        key={source.id}
                        onClick={() =>
                          toast.message(
                            tr(
                              "pages.dashboard.tasks.detail.toasts.sourceViewerSoon"
                            )
                          )
                        }
                      >
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-foreground text-sm">
                            {source.sourceType
                              ? source.sourceType.toUpperCase()
                              : tr(
                                  "pages.dashboard.tasks.detail.sources.fallback",
                                  { index: index + 1 }
                                )}
                          </p>
                          {source.quotedText && (
                            <p className="mt-0.5 truncate text-muted-foreground text-xs">
                              "{source.quotedText}"
                            </p>
                          )}
                        </div>
                        {source.sourceTimestamp && (
                          <span className="shrink-0 text-muted-foreground text-xs">
                            {new Intl.DateTimeFormat(locale, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }).format(new Date(source.sourceTimestamp))}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline / Activity */}
              {taskData?.timeline && taskData.timeline.length > 0 && (
                <div className="border-border border-t pt-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground text-sm">
                      {tr("pages.dashboard.tasks.detail.sections.timeline")}
                    </span>
                  </div>
                  <div className="relative ml-2">
                    {/* Timeline line */}
                    <div className="absolute top-0 bottom-0 left-2 w-0.5 bg-border" />
                    <div className="space-y-4">
                      {taskData.timeline.map((event: TaskTimelineEvent) => (
                        <div className="relative pl-8" key={event.id}>
                          {/* Timeline dot */}
                          <div className="absolute top-1 left-0 h-4 w-4 rounded-full border-2 border-muted-foreground bg-background" />
                          <div>
                            <p className="text-foreground text-sm">
                              {event.eventDescription}
                            </p>
                            <p className="mt-0.5 text-muted-foreground text-xs">
                              {formatRelativeTime(
                                new Date(event.eventAt),
                                locale
                              )}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Team Discussion */}
              <div className="border-border border-t pt-6">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-foreground text-sm">
                    {tr("pages.dashboard.tasks.detail.sections.teamDiscussion")}
                  </span>
                </div>
                <div className="mt-3 rounded-lg border border-dashed bg-muted/40 px-3 py-4 text-muted-foreground text-xs">
                  {tr(
                    "pages.dashboard.tasks.detail.teamDiscussion.placeholder"
                  )}
                </div>
              </div>

              {/* Timestamps */}
              <div className="space-y-1 border-border border-t pt-4 text-muted-foreground text-xs">
                <div>
                  {tr("pages.dashboard.tasks.detail.meta.created")}{" "}
                  {new Intl.DateTimeFormat(locale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(task.createdAt)}
                </div>
                <div>
                  {tr("pages.dashboard.tasks.detail.meta.updated")}{" "}
                  {new Intl.DateTimeFormat(locale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(task.updatedAt)}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Properties Sidebar */}
          <div className="w-[280px] shrink-0 overflow-y-auto border-border border-l bg-card p-4">
            <div className="space-y-4">
              {/* Status */}
              <PropertyRow
                label={tr("pages.dashboard.tasks.detail.properties.status")}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-accent">
                      <StatusIcon size="sm" status={iconStatus} />
                      <span className="text-foreground text-sm">
                        {tr(statusConfig.label)}
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
                            {tr(config.label)}
                          </DropdownMenuItem>
                        );
                      }
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </PropertyRow>

              {/* Priority */}
              <PropertyRow
                label={tr("pages.dashboard.tasks.detail.properties.priority")}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-accent">
                      <PriorityIcon priority={iconPriority} size="sm" />
                      <span className="text-foreground text-sm">
                        {tr(priorityConfig.label)}
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
                            {tr(config.label)}
                          </DropdownMenuItem>
                        );
                      }
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </PropertyRow>

              {/* Assignee */}
              <PropertyRow
                label={tr("pages.dashboard.tasks.detail.properties.assignee")}
              >
                <div className="flex w-full items-center gap-2 rounded px-2 py-1.5">
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
                          {getInitials(task.assignee.name, task.assignee.email)}
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
                        {tr(
                          "pages.dashboard.tasks.detail.properties.noAssignee"
                        )}
                      </span>
                    </>
                  )}
                </div>
              </PropertyRow>

              {/* Labels */}
              <PropertyRow
                label={tr("pages.dashboard.tasks.detail.properties.labels")}
              >
                <div className="px-2 py-1.5">
                  {task.labels.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
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
                  ) : (
                    <div className="text-muted-foreground text-sm">
                      {tr("pages.dashboard.tasks.detail.properties.noLabels")}
                    </div>
                  )}
                </div>
              </PropertyRow>

              {/* Due Date */}
              <PropertyRow
                label={tr("pages.dashboard.tasks.detail.properties.dueDate")}
              >
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
                        handleDueDateChange(parseDateInputValue(value));
                      } else {
                        handleDueDateChange(undefined);
                      }
                    }}
                    type="date"
                    value={task.dueDate ? toDateInputValue(task.dueDate) : ""}
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
              <PropertyRow
                label={tr("pages.dashboard.tasks.detail.properties.source")}
              >
                <div className="px-2 py-1.5">
                  <Badge
                    className={cn(
                      "text-xs",
                      sourceConfig.bgColor,
                      sourceConfig.color
                    )}
                    variant="secondary"
                  >
                    {tr(sourceConfig.label)}
                  </Badge>
                </div>
              </PropertyRow>

              {/* Keyboard shortcuts hint */}
              <div className="border-border border-t pt-4">
                <div className="space-y-1 text-muted-foreground text-xs">
                  <div className="flex items-center justify-between">
                    <span>
                      {tr("pages.dashboard.tasks.detail.keyboard.setStatus")}
                    </span>
                    <span className="font-mono">1-6</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>
                      {tr("pages.dashboard.tasks.detail.keyboard.goBack")}
                    </span>
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

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!(year && month && day)) {
    return new Date(value);
  }
  // Use local time for date-only inputs (avoid UTC parsing shifts).
  return new Date(year, month - 1, day);
}

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
