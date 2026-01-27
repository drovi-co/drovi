// =============================================================================
// COMMITMENT DETAIL PAGE (Linear-style)
// =============================================================================
//
// Full-page commitment detail view with two-column layout:
// - Left: Title, description, evidence, timeline
// - Right: Properties sidebar (status, priority, direction, due date, people)
//

import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useDismissUIO,
  useMarkCompleteUIO,
  useSnoozeUIO,
  useUIO,
  useVerifyUIO,
} from "@/hooks/use-uio";
import { useTrackViewing } from "@/hooks/use-presence";
import { CommentThread, WhoIsViewing } from "@/components/collaboration";
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
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

const searchSchema = z.object({
  from: z.string().optional(), // Return URL for smart back navigation
});

export const Route = createFileRoute("/dashboard/commitments/$commitmentId")({
  component: CommitmentDetailPage,
  validateSearch: searchSchema,
});

// =============================================================================
// TYPES
// =============================================================================

type CommitmentStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "overdue"
  | "waiting"
  | "snoozed";
type CommitmentPriority = "low" | "medium" | "high" | "urgent";
type CommitmentDirection = "owed_by_me" | "owed_to_me";

// Status configuration
const STATUS_CONFIG: Record<
  CommitmentStatus,
  { label: string; color: string; bgColor: string; icon: typeof Clock }
> = {
  pending: {
    label: "Pending",
    color: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
    icon: Clock,
  },
  in_progress: {
    label: "In Progress",
    color: "text-amber-600",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    icon: Clock,
  },
  completed: {
    label: "Completed",
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    color: "text-gray-500",
    bgColor: "bg-gray-100 dark:bg-gray-800",
    icon: AlertTriangle,
  },
  overdue: {
    label: "Overdue",
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900/30",
    icon: AlertTriangle,
  },
  waiting: {
    label: "Waiting",
    color: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
    icon: Clock,
  },
  snoozed: {
    label: "Snoozed",
    color: "text-gray-500",
    bgColor: "bg-gray-100 dark:bg-gray-800",
    icon: Clock,
  },
};

const PRIORITY_CONFIG: Record<
  CommitmentPriority,
  { label: string; color: string; dotColor: string }
> = {
  urgent: {
    label: "Urgent",
    color: "text-red-600",
    dotColor: "bg-red-500",
  },
  high: {
    label: "High",
    color: "text-orange-600",
    dotColor: "bg-orange-500",
  },
  medium: {
    label: "Medium",
    color: "text-blue-600",
    dotColor: "bg-blue-500",
  },
  low: {
    label: "Low",
    color: "text-gray-500",
    dotColor: "bg-gray-400",
  },
};

const DIRECTION_CONFIG: Record<
  CommitmentDirection,
  { label: string; description: string }
> = {
  owed_by_me: {
    label: "I Owe",
    description: "Commitment you made to someone",
  },
  owed_to_me: {
    label: "Owed to Me",
    description: "Commitment someone made to you",
  },
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function CommitmentDetailPage() {
  const navigate = useNavigate();
  const { commitmentId } = useParams({
    from: "/dashboard/commitments/$commitmentId",
  });
  const search = Route.useSearch();
  const returnUrl = search.from;
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const organizationId = activeOrg?.id ?? "";
  const currentUserId = session?.user?.id ?? "";
  const queryClient = useQueryClient();

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showComments, setShowComments] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // Track viewing this commitment for real-time presence
  useTrackViewing({
    organizationId,
    resourceType: "commitment",
    resourceId: commitmentId,
    enabled: Boolean(organizationId && commitmentId),
  });

  // Fetch commitment details using UIO hook
  const {
    data: commitmentData,
    isLoading,
    refetch,
  } = useUIO({
    organizationId,
    id: commitmentId,
    enabled: !!organizationId && !!commitmentId,
  });

  // Mutations
  const completeMutation = useMarkCompleteUIO();
  const snoozeMutation = useSnoozeUIO();
  const dismissMutation = useDismissUIO();
  const verifyMutation = useVerifyUIO();

  // Transform UIO data
  const commitment = commitmentData
    ? {
        id: commitmentData.id,
        title:
          commitmentData.userCorrectedTitle ??
          commitmentData.canonicalTitle ??
          "",
        description: commitmentData.canonicalDescription ?? "",
        status: (commitmentData.commitmentDetails?.status ??
          "pending") as CommitmentStatus,
        priority: (commitmentData.commitmentDetails?.priority ??
          "medium") as CommitmentPriority,
        direction: (commitmentData.commitmentDetails?.direction ??
          "owed_by_me") as CommitmentDirection,
        dueDate: commitmentData.dueDate
          ? new Date(commitmentData.dueDate)
          : null,
        confidence: commitmentData.overallConfidence ?? 0.8,
        isUserVerified: commitmentData.isUserVerified ?? false,
        debtor: commitmentData.commitmentDetails?.debtor ?? null,
        creditor: commitmentData.commitmentDetails?.creditor ?? null,
        owner: commitmentData.owner ?? null,
        extractionContext:
          commitmentData.commitmentDetails?.extractionContext ?? null,
        sources: commitmentData.sources ?? [],
        timeline: commitmentData.timeline ?? [],
        createdAt: new Date(commitmentData.createdAt),
        updatedAt: new Date(commitmentData.updatedAt),
      }
    : null;

  // Initialize form values when commitment loads
  useEffect(() => {
    if (commitment) {
      setTitle(commitment.title);
      setDescription(commitment.description);
    }
  }, [commitment?.title, commitment?.description]);

  // Focus handlers
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingDescription && descriptionRef.current) {
      descriptionRef.current.focus();
    }
  }, [editingDescription]);

  // Handlers
  const handleBack = useCallback(() => {
    // Use return URL if provided, otherwise go to commitments list
    if (returnUrl) {
      navigate({ to: returnUrl });
    } else {
      navigate({ to: "/dashboard/commitments" });
    }
  }, [navigate, returnUrl]);

  const handleComplete = useCallback(() => {
    if (!commitment) return;
    completeMutation.mutate(
      { organizationId, id: commitment.id },
      {
        onSuccess: () => {
          toast.success("Commitment marked as complete");
          refetch();
          queryClient.invalidateQueries({ queryKey: [["uio"]] });
        },
        onError: () => {
          toast.error("Failed to complete commitment");
        },
      }
    );
  }, [commitment, completeMutation, organizationId, refetch, queryClient]);

  const handleSnooze = useCallback(
    (days: number) => {
      if (!commitment) return;
      const until = new Date();
      until.setDate(until.getDate() + days);
      snoozeMutation.mutate(
        { organizationId, id: commitment.id, until },
        {
          onSuccess: () => {
            toast.success(`Snoozed for ${days} days`);
            refetch();
            queryClient.invalidateQueries({ queryKey: [["uio"]] });
          },
          onError: () => {
            toast.error("Failed to snooze commitment");
          },
        }
      );
    },
    [commitment, snoozeMutation, organizationId, refetch, queryClient]
  );

  const handleDismiss = useCallback(() => {
    if (!commitment) return;
    dismissMutation.mutate(
      { organizationId, id: commitment.id },
      {
        onSuccess: () => {
          toast.success("Commitment dismissed");
          navigate({ to: "/dashboard/commitments" });
        },
        onError: () => {
          toast.error("Failed to dismiss commitment");
        },
      }
    );
  }, [commitment, dismissMutation, organizationId, navigate]);

  const handleVerify = useCallback(() => {
    if (!commitment) return;
    verifyMutation.mutate(
      { organizationId, id: commitment.id },
      {
        onSuccess: () => {
          toast.success("Commitment verified");
          refetch();
          queryClient.invalidateQueries({ queryKey: [["uio"]] });
        },
        onError: () => {
          toast.error("Failed to verify commitment");
        },
      }
    );
  }, [commitment, verifyMutation, organizationId, refetch, queryClient]);

  const handleSourceClick = useCallback(
    (conversationId: string) => {
      navigate({
        to: "/dashboard/email/thread/$threadId",
        params: { threadId: conversationId },
      });
    },
    [navigate]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingTitle) {
          setTitle(commitment?.title ?? "");
          setEditingTitle(false);
          return;
        }
        if (editingDescription) {
          setDescription(commitment?.description ?? "");
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

      // Complete shortcut
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        handleComplete();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleBack,
    commitment,
    editingTitle,
    editingDescription,
    handleComplete,
  ]);

  // Loading state
  if (isLoading) {
    return <CommitmentDetailSkeleton />;
  }

  // Not found state
  if (!commitment) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="font-medium text-lg">Commitment not found</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            This commitment may have been deleted or you don't have access.
          </p>
          <Button className="mt-4" onClick={handleBack}>
            Back to Commitments
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[commitment.status];
  const priorityConfig = PRIORITY_CONFIG[commitment.priority];
  const directionConfig = DIRECTION_CONFIG[commitment.direction];
  const StatusIcon = statusConfig.icon;

  // Determine the "other person" based on direction
  const otherPerson =
    commitment.direction === "owed_by_me"
      ? commitment.creditor
      : commitment.debtor;

  // Check if overdue
  const isOverdue =
    commitment.dueDate &&
    commitment.dueDate < new Date() &&
    commitment.status !== "completed";

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
              <span className="text-muted-foreground">Commitments</span>
              <span className="text-muted-foreground">/</span>
              <span className="max-w-[300px] truncate font-medium text-foreground">
                {commitment.title}
              </span>
            </div>

            <div className="flex-1" />

            {/* Who's viewing indicator */}
            {organizationId && commitmentId && (
              <WhoIsViewing
                organizationId={organizationId}
                resourceType="commitment"
                resourceId={commitmentId}
                compact
              />
            )}

            {/* Actions */}
            <div className="flex items-center gap-1">
              {/* Verify button */}
              {!commitment.isUserVerified && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="h-8 gap-2 text-green-600 hover:bg-green-50 hover:text-green-700 dark:hover:bg-green-900/20"
                        onClick={handleVerify}
                        size="sm"
                        variant="ghost"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Verify
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Mark as correct extraction</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Complete button */}
              {commitment.status !== "completed" && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="h-8 gap-2"
                        onClick={handleComplete}
                        size="sm"
                        variant="outline"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Complete
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Mark as complete (C)</TooltipContent>
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
                  <DropdownMenuItem onClick={() => handleSnooze(1)}>
                    <Clock className="mr-2 h-4 w-4" />
                    Snooze 1 day
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSnooze(3)}>
                    <Clock className="mr-2 h-4 w-4" />
                    Snooze 3 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSnooze(7)}>
                    <Clock className="mr-2 h-4 w-4" />
                    Snooze 1 week
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-500 focus:text-red-500"
                    onClick={handleDismiss}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Dismiss
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
                    onBlur={() => setEditingTitle(false)}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setEditingTitle(false);
                      }
                      if (e.key === "Escape") {
                        setTitle(commitment.title);
                        setEditingTitle(false);
                      }
                    }}
                    placeholder="Commitment title..."
                    ref={titleInputRef}
                    value={title}
                  />
                ) : (
                  <h1
                    className="cursor-pointer py-1 font-semibold text-2xl text-foreground transition-colors hover:text-foreground/80"
                    onClick={() => setEditingTitle(true)}
                  >
                    {commitment.title}
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
                    onBlur={() => setEditingDescription(false)}
                    onChange={(e) => setDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setDescription(commitment.description);
                        setEditingDescription(false);
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
                    {commitment.description || (
                      <span className="text-muted-foreground">
                        Click to add description...
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Evidence / Extraction Context */}
              {commitment.extractionContext && (
                <div>
                  <label className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-sm">
                    <FileText className="h-4 w-4" />
                    Evidence
                  </label>
                  <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-4">
                    {commitment.extractionContext.quotedText && (
                      <div>
                        <span className="mb-1 block font-medium text-muted-foreground text-xs uppercase">
                          Quoted Text
                        </span>
                        <blockquote className="border-blue-500 border-l-2 pl-3 text-foreground text-sm italic">
                          "{commitment.extractionContext.quotedText}"
                        </blockquote>
                      </div>
                    )}
                    {commitment.extractionContext.reasoning && (
                      <div>
                        <span className="mb-1 block font-medium text-muted-foreground text-xs uppercase">
                          AI Reasoning
                        </span>
                        <p className="text-muted-foreground text-sm">
                          {commitment.extractionContext.reasoning}
                        </p>
                      </div>
                    )}
                    {commitment.extractionContext.modelUsed && (
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <span>Model: {commitment.extractionContext.modelUsed}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sources */}
              {commitment.sources.length > 0 && (
                <div>
                  <label className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-sm">
                    <ExternalLink className="h-4 w-4" />
                    Sources ({commitment.sources.length})
                  </label>
                  <div className="space-y-2">
                    {commitment.sources.map((source) => (
                      <div
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/50 p-3 transition-colors hover:border-secondary/50 hover:bg-muted"
                        key={source.id}
                        onClick={() =>
                          source.conversationId &&
                          handleSourceClick(source.conversationId)
                        }
                      >
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-foreground text-sm">
                            {source.conversation?.title ?? "Email thread"}
                          </p>
                          {source.quotedText && (
                            <p className="mt-0.5 truncate text-muted-foreground text-xs">
                              "{source.quotedText}"
                            </p>
                          )}
                        </div>
                        {source.sourceTimestamp && (
                          <span className="shrink-0 text-muted-foreground text-xs">
                            {format(
                              new Date(source.sourceTimestamp),
                              "MMM d, yyyy"
                            )}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline */}
              {commitment.timeline.length > 0 && (
                <div className="border-border border-t pt-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground text-sm">
                      Timeline
                    </span>
                  </div>
                  <div className="relative ml-2">
                    {/* Timeline line */}
                    <div className="absolute top-0 bottom-0 left-2 w-0.5 bg-border" />
                    <div className="space-y-4">
                      {commitment.timeline.map((event) => (
                        <div className="relative pl-8" key={event.id}>
                          {/* Timeline dot */}
                          <div className="absolute top-1 left-0 h-4 w-4 rounded-full border-2 border-muted-foreground bg-background" />
                          <div>
                            <p className="text-foreground text-sm">
                              {event.eventDescription}
                            </p>
                            <p className="mt-0.5 text-muted-foreground text-xs">
                              {formatDistanceToNow(new Date(event.eventAt), {
                                addSuffix: true,
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="space-y-1 border-border border-t pt-4 text-muted-foreground text-xs">
                <div>
                  Created: {format(commitment.createdAt, "MMM d, yyyy 'at' h:mm a")}
                </div>
                <div>
                  Updated: {format(commitment.updatedAt, "MMM d, yyyy 'at' h:mm a")}
                </div>
              </div>

              {/* Team Discussion / Comments Section */}
              <div className="border-border border-t pt-6">
                <button
                  type="button"
                  className="mb-4 flex w-full items-center justify-between gap-2"
                  onClick={() => setShowComments(!showComments)}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground text-sm">
                      Team Discussion
                    </span>
                  </div>
                  {showComments ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {showComments && organizationId && commitmentId && currentUserId && (
                  <CommentThread
                    organizationId={organizationId}
                    targetType="commitment"
                    targetId={commitmentId}
                    currentUserId={currentUserId}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Right Column - Properties Sidebar */}
          <div className="w-[280px] shrink-0 overflow-y-auto border-border border-l bg-card p-4">
            <div className="space-y-4">
              {/* Status */}
              <PropertyRow label="Status">
                <div className="px-2 py-1.5">
                  <div
                    className={cn(
                      "inline-flex items-center gap-2 rounded-md px-2 py-1",
                      statusConfig.bgColor
                    )}
                  >
                    <StatusIcon className={cn("h-4 w-4", statusConfig.color)} />
                    <span className={cn("text-sm", statusConfig.color)}>
                      {statusConfig.label}
                    </span>
                  </div>
                </div>
              </PropertyRow>

              {/* Priority */}
              <PropertyRow label="Priority">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <div
                    className={cn("h-2 w-2 rounded-full", priorityConfig.dotColor)}
                  />
                  <span className={cn("text-sm", priorityConfig.color)}>
                    {priorityConfig.label}
                  </span>
                </div>
              </PropertyRow>

              {/* Direction */}
              <PropertyRow label="Direction">
                <div className="px-2 py-1.5">
                  <Badge
                    variant={
                      commitment.direction === "owed_by_me"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {directionConfig.label}
                  </Badge>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {directionConfig.description}
                  </p>
                </div>
              </PropertyRow>

              {/* Due Date */}
              <PropertyRow label="Due Date">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <Calendar
                    className={cn(
                      "h-4 w-4",
                      isOverdue ? "text-red-500" : "text-muted-foreground"
                    )}
                  />
                  {commitment.dueDate ? (
                    <span
                      className={cn(
                        "text-sm",
                        isOverdue ? "font-medium text-red-600" : "text-foreground"
                      )}
                    >
                      {format(commitment.dueDate, "MMM d, yyyy")}
                      {isOverdue && " (Overdue)"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">No due date</span>
                  )}
                </div>
              </PropertyRow>

              {/* Person Involved */}
              <PropertyRow label={commitment.direction === "owed_by_me" ? "Owed To" : "Owed By"}>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  {otherPerson ? (
                    <>
                      <Avatar className="h-6 w-6">
                        {otherPerson.avatarUrl && (
                          <AvatarImage
                            alt={otherPerson.displayName ?? ""}
                            src={otherPerson.avatarUrl}
                          />
                        )}
                        <AvatarFallback className="bg-secondary text-[10px] text-white">
                          {getInitials(
                            otherPerson.displayName,
                            otherPerson.primaryEmail ?? ""
                          )}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-foreground text-sm">
                          {otherPerson.displayName ?? otherPerson.primaryEmail}
                        </p>
                        {otherPerson.displayName && otherPerson.primaryEmail && (
                          <p className="truncate text-muted-foreground text-xs">
                            {otherPerson.primaryEmail}
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-muted-foreground border-dashed">
                        <User className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <span className="text-muted-foreground text-sm">
                        Unknown
                      </span>
                    </>
                  )}
                </div>
              </PropertyRow>

              {/* AI Confidence */}
              <PropertyRow label="AI Confidence">
                <div className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          commitment.confidence >= 0.8
                            ? "bg-green-500"
                            : commitment.confidence >= 0.6
                              ? "bg-amber-500"
                              : "bg-red-500"
                        )}
                        style={{ width: `${commitment.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground text-sm">
                      {Math.round(commitment.confidence * 100)}%
                    </span>
                  </div>
                  {commitment.isUserVerified && (
                    <div className="mt-1.5 flex items-center gap-1 text-green-600 text-xs">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Verified by user</span>
                    </div>
                  )}
                </div>
              </PropertyRow>

              {/* Keyboard shortcuts hint */}
              <div className="border-border border-t pt-4">
                <div className="space-y-1 text-muted-foreground text-xs">
                  <div className="flex items-center justify-between">
                    <span>Complete</span>
                    <kbd className="rounded bg-muted px-1.5 py-0.5">C</kbd>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Go back</span>
                    <kbd className="rounded bg-muted px-1.5 py-0.5">Esc</kbd>
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

function CommitmentDetailSkeleton() {
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
