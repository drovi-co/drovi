// =============================================================================
// DECISION DETAIL PAGE (Linear-style)
// =============================================================================
//
// Full-page decision detail view with two-column layout:
// - Left: Title, statement, rationale, evidence, timeline
// - Right: Properties sidebar (status, decision maker, alternatives, supersession)
//

import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  Scale,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { CommentThread, WhoIsViewing } from "@/components/collaboration";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTrackViewing } from "@/hooks/use-presence";
import { useDismissUIO, useUIO, useVerifyUIO } from "@/hooks/use-uio";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

const searchSchema = z.object({
  from: z.string().optional(), // Return URL for smart back navigation
});

export const Route = createFileRoute("/dashboard/decisions/$decisionId")({
  component: DecisionDetailPage,
  validateSearch: searchSchema,
});

// =============================================================================
// TYPES
// =============================================================================

type DecisionStatus = "made" | "pending" | "deferred" | "reversed";

// Status configuration
const STATUS_CONFIG: Record<
  DecisionStatus,
  { label: string; color: string; bgColor: string; icon: typeof Scale }
> = {
  made: {
    label: "Made",
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
    icon: CheckCircle2,
  },
  pending: {
    label: "Pending",
    color: "text-amber-600",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    icon: Clock,
  },
  deferred: {
    label: "Deferred",
    color: "text-gray-500",
    bgColor: "bg-gray-100 dark:bg-gray-800",
    icon: Clock,
  },
  reversed: {
    label: "Reversed",
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900/30",
    icon: GitBranch,
  },
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function DecisionDetailPage() {
  const navigate = useNavigate();
  const { decisionId } = useParams({
    from: "/dashboard/decisions/$decisionId",
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
  const [editingRationale, setEditingRationale] = useState(false);
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [showComments, setShowComments] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const rationaleRef = useRef<HTMLTextAreaElement>(null);

  // Track viewing this decision for real-time presence
  useTrackViewing({
    organizationId,
    resourceType: "decision",
    resourceId: decisionId,
    enabled: Boolean(organizationId && decisionId),
  });

  // Fetch decision details using UIO hook
  const {
    data: decisionData,
    isLoading,
    refetch,
  } = useUIO({
    organizationId,
    id: decisionId,
    enabled: !!organizationId && !!decisionId,
  });

  // Mutations
  const dismissMutation = useDismissUIO();
  const verifyMutation = useVerifyUIO();

  // Transform UIO data
  const decision = decisionData
    ? {
        id: decisionData.id,
        title:
          decisionData.userCorrectedTitle ?? decisionData.canonicalTitle ?? "",
        statement:
          decisionData.decisionDetails?.statement ??
          decisionData.canonicalDescription ??
          "",
        rationale: decisionData.decisionDetails?.rationale ?? "",
        status: (decisionData.decisionDetails?.status ??
          "made") as DecisionStatus,
        confidence: decisionData.overallConfidence ?? 0.8,
        isUserVerified: decisionData.isUserVerified ?? false,
        decisionMaker:
          decisionData.decisionDetails?.decisionMaker ??
          decisionData.owner ??
          null,
        alternatives: decisionData.decisionDetails?.alternatives ?? [],
        impactAreas: decisionData.decisionDetails?.impactAreas ?? [],
        extractionContext:
          decisionData.decisionDetails?.extractionContext ?? null,
        decidedAt: decisionData.decisionDetails?.decidedAt
          ? new Date(decisionData.decisionDetails.decidedAt)
          : null,
        supersedesUioId: decisionData.decisionDetails?.supersedesUioId ?? null,
        supersededByUioId:
          decisionData.decisionDetails?.supersededByUioId ?? null,
        sources: decisionData.sources ?? [],
        timeline: decisionData.timeline ?? [],
        createdAt: new Date(decisionData.createdAt),
        updatedAt: new Date(decisionData.updatedAt),
      }
    : null;

  // Initialize form values when decision loads
  useEffect(() => {
    if (decision) {
      setTitle(decision.title);
      setRationale(decision.rationale);
    }
  }, [decision?.title, decision?.rationale]);

  // Focus handlers
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingRationale && rationaleRef.current) {
      rationaleRef.current.focus();
    }
  }, [editingRationale]);

  // Handlers
  const handleBack = useCallback(() => {
    // Use return URL if provided, otherwise go to decisions list
    if (returnUrl) {
      navigate({ to: returnUrl });
    } else {
      navigate({ to: "/dashboard/decisions" });
    }
  }, [navigate, returnUrl]);

  const handleDismiss = useCallback(() => {
    if (!decision) {
      return;
    }
    dismissMutation.mutate(
      { organizationId, id: decision.id },
      {
        onSuccess: () => {
          toast.success("Decision dismissed");
          navigate({ to: "/dashboard/decisions" });
        },
        onError: () => {
          toast.error("Failed to dismiss decision");
        },
      }
    );
  }, [decision, dismissMutation, organizationId, navigate]);

  const handleVerify = useCallback(() => {
    if (!decision) {
      return;
    }
    verifyMutation.mutate(
      { organizationId, id: decision.id },
      {
        onSuccess: () => {
          toast.success("Decision verified");
          refetch();
          queryClient.invalidateQueries({ queryKey: [["uio"]] });
        },
        onError: () => {
          toast.error("Failed to verify decision");
        },
      }
    );
  }, [decision, verifyMutation, organizationId, refetch, queryClient]);

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
          setTitle(decision?.title ?? "");
          setEditingTitle(false);
          return;
        }
        if (editingRationale) {
          setRationale(decision?.rationale ?? "");
          setEditingRationale(false);
          return;
        }
        handleBack();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleBack, decision, editingTitle, editingRationale]);

  // Loading state
  if (isLoading) {
    return <DecisionDetailSkeleton />;
  }

  // Not found state
  if (!decision) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="font-medium text-lg">Decision not found</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            This decision may have been deleted or you don't have access.
          </p>
          <Button className="mt-4" onClick={handleBack}>
            Back to Decisions
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[decision.status];
  const StatusIcon = statusConfig.icon;

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
              <span className="text-muted-foreground">Decisions</span>
              <span className="text-muted-foreground">/</span>
              <span className="max-w-[300px] truncate font-medium text-foreground">
                {decision.title}
              </span>
            </div>

            <div className="flex-1" />

            {/* Who's viewing indicator */}
            {organizationId && decisionId && (
              <WhoIsViewing
                compact
                organizationId={organizationId}
                resourceId={decisionId}
                resourceType="decision"
              />
            )}

            {/* Actions */}
            <div className="flex items-center gap-1">
              {/* Verify button */}
              {!decision.isUserVerified && (
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
                        setTitle(decision.title);
                        setEditingTitle(false);
                      }
                    }}
                    placeholder="Decision title..."
                    ref={titleInputRef}
                    value={title}
                  />
                ) : (
                  <h1
                    className="cursor-pointer py-1 font-semibold text-2xl text-foreground transition-colors hover:text-foreground/80"
                    onClick={() => setEditingTitle(true)}
                  >
                    {decision.title}
                  </h1>
                )}
              </div>

              {/* Statement */}
              <div>
                <label className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-sm">
                  <Scale className="h-4 w-4" />
                  Decision Statement
                </label>
                <div className="whitespace-pre-wrap rounded-lg border border-purple-200 bg-purple-50/50 p-4 text-foreground text-sm dark:border-purple-900/50 dark:bg-purple-900/10">
                  {decision.statement}
                </div>
              </div>

              {/* Rationale */}
              <div>
                <label className="mb-2 block font-medium text-muted-foreground text-sm">
                  Rationale
                </label>
                {editingRationale ? (
                  <Textarea
                    className="resize-none border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-secondary"
                    onBlur={() => setEditingRationale(false)}
                    onChange={(e) => setRationale(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setRationale(decision.rationale);
                        setEditingRationale(false);
                      }
                    }}
                    placeholder="Add rationale..."
                    ref={rationaleRef}
                    rows={6}
                    value={rationale}
                  />
                ) : (
                  <div
                    className="min-h-[100px] cursor-pointer whitespace-pre-wrap rounded-lg border border-border bg-muted p-4 text-foreground text-sm transition-colors hover:border-border"
                    onClick={() => setEditingRationale(true)}
                  >
                    {decision.rationale || (
                      <span className="text-muted-foreground">
                        Click to add rationale...
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Alternatives */}
              {decision.alternatives.length > 0 && (
                <div>
                  <label className="mb-2 block font-medium text-muted-foreground text-sm">
                    Alternatives Considered
                  </label>
                  <div className="space-y-2">
                    {decision.alternatives.map((alt, idx) => (
                      <div
                        className={cn(
                          "rounded-lg border p-3",
                          alt.rejected
                            ? "border-border bg-muted/50"
                            : "border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-900/10"
                        )}
                        key={idx}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "font-medium text-sm",
                              alt.rejected
                                ? "text-muted-foreground line-through"
                                : "text-foreground"
                            )}
                          >
                            {alt.title}
                          </span>
                          {!alt.rejected && (
                            <Badge className="text-xs" variant="secondary">
                              Chosen
                            </Badge>
                          )}
                        </div>
                        {alt.description && (
                          <p className="mt-1 text-muted-foreground text-sm">
                            {alt.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence / Extraction Context */}
              {decision.extractionContext && (
                <div>
                  <label className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-sm">
                    <FileText className="h-4 w-4" />
                    Evidence
                  </label>
                  <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-4">
                    {decision.extractionContext.quotedText && (
                      <div>
                        <span className="mb-1 block font-medium text-muted-foreground text-xs uppercase">
                          Quoted Text
                        </span>
                        <blockquote className="border-purple-500 border-l-2 pl-3 text-foreground text-sm italic">
                          "{decision.extractionContext.quotedText}"
                        </blockquote>
                      </div>
                    )}
                    {decision.extractionContext.reasoning && (
                      <div>
                        <span className="mb-1 block font-medium text-muted-foreground text-xs uppercase">
                          AI Reasoning
                        </span>
                        <p className="text-muted-foreground text-sm">
                          {decision.extractionContext.reasoning}
                        </p>
                      </div>
                    )}
                    {decision.extractionContext.modelUsed && (
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <span>
                          Model: {decision.extractionContext.modelUsed}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sources */}
              {decision.sources.length > 0 && (
                <div>
                  <label className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-sm">
                    <ExternalLink className="h-4 w-4" />
                    Sources ({decision.sources.length})
                  </label>
                  <div className="space-y-2">
                    {decision.sources.map((source) => (
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
              {decision.timeline.length > 0 && (
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
                      {decision.timeline.map((event) => (
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
                {decision.decidedAt && (
                  <div>
                    Decided:{" "}
                    {format(decision.decidedAt, "MMM d, yyyy 'at' h:mm a")}
                  </div>
                )}
                <div>
                  Created:{" "}
                  {format(decision.createdAt, "MMM d, yyyy 'at' h:mm a")}
                </div>
                <div>
                  Updated:{" "}
                  {format(decision.updatedAt, "MMM d, yyyy 'at' h:mm a")}
                </div>
              </div>

              {/* Team Discussion / Comments Section */}
              <div className="border-border border-t pt-6">
                <button
                  className="mb-4 flex w-full items-center justify-between gap-2"
                  onClick={() => setShowComments(!showComments)}
                  type="button"
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

                {showComments &&
                  organizationId &&
                  decisionId &&
                  currentUserId && (
                    <CommentThread
                      currentUserId={currentUserId}
                      organizationId={organizationId}
                      targetId={decisionId}
                      targetType="decision"
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

              {/* Decision Maker */}
              <PropertyRow label="Decision Maker">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  {decision.decisionMaker ? (
                    <>
                      <Avatar className="h-6 w-6">
                        {decision.decisionMaker.avatarUrl && (
                          <AvatarImage
                            alt={decision.decisionMaker.displayName ?? ""}
                            src={decision.decisionMaker.avatarUrl}
                          />
                        )}
                        <AvatarFallback className="bg-secondary text-[10px] text-white">
                          {getInitials(
                            decision.decisionMaker.displayName,
                            decision.decisionMaker.primaryEmail ?? ""
                          )}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-foreground text-sm">
                          {decision.decisionMaker.displayName ??
                            decision.decisionMaker.primaryEmail}
                        </p>
                        {decision.decisionMaker.displayName &&
                          decision.decisionMaker.primaryEmail && (
                            <p className="truncate text-muted-foreground text-xs">
                              {decision.decisionMaker.primaryEmail}
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

              {/* Decided At */}
              <PropertyRow label="Decided">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  {decision.decidedAt ? (
                    <span className="text-foreground text-sm">
                      {format(decision.decidedAt, "MMM d, yyyy")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      Unknown
                    </span>
                  )}
                </div>
              </PropertyRow>

              {/* Impact Areas */}
              {decision.impactAreas.length > 0 && (
                <PropertyRow label="Impact Areas">
                  <div className="flex flex-wrap gap-1.5 px-2 py-1.5">
                    {decision.impactAreas.map((area) => (
                      <Badge className="text-xs" key={area} variant="secondary">
                        {area}
                      </Badge>
                    ))}
                  </div>
                </PropertyRow>
              )}

              {/* Supersession */}
              {(decision.supersedesUioId || decision.supersededByUioId) && (
                <PropertyRow label="Supersession">
                  <div className="px-2 py-1.5 text-sm">
                    {decision.supersededByUioId && (
                      <div className="flex items-center gap-2 text-amber-600">
                        <GitBranch className="h-4 w-4" />
                        <span>Superseded by newer decision</span>
                      </div>
                    )}
                    {decision.supersedesUioId && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <GitBranch className="h-4 w-4" />
                        <span>Supersedes previous decision</span>
                      </div>
                    )}
                  </div>
                </PropertyRow>
              )}

              {/* AI Confidence */}
              <PropertyRow label="AI Confidence">
                <div className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          decision.confidence >= 0.8
                            ? "bg-green-500"
                            : decision.confidence >= 0.6
                              ? "bg-amber-500"
                              : "bg-red-500"
                        )}
                        style={{ width: `${decision.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground text-sm">
                      {Math.round(decision.confidence * 100)}%
                    </span>
                  </div>
                  {decision.isUserVerified && (
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

function DecisionDetailSkeleton() {
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
