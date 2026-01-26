// =============================================================================
// UIO DETAIL PANEL COMPONENT
// =============================================================================
//
// Right panel (2/3 width) displaying full UIO details:
// - Icon + Title
// - Description with entity linking
// - Status section
// - Linked conversations/messages
// - Timeline with notes

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Archive,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  Lightbulb,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  Target,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EntityBadge } from "@/components/inbox/entity-badge";
import { LinkedDescription } from "@/components/inbox/linked-description";
import type { UIOType } from "@/components/inbox/uio-list-item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { extractEntitiesFromUIO } from "@/lib/entity-parser";
import { cn } from "@/lib/utils";
import { queryClient, trpc } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

export interface UIODetailPanelProps {
  uioId: string;
  organizationId: string;
  onClose?: () => void;
  className?: string;
}

// =============================================================================
// TYPE ICON CONFIG
// =============================================================================

const TYPE_CONFIG: Record<
  UIOType,
  { icon: typeof Target; color: string; bgColor: string }
> = {
  commitment: {
    icon: Target,
    color: "text-blue-600",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  decision: {
    icon: GitBranch,
    color: "text-purple-600",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  task: {
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
  topic: {
    icon: MessageSquare,
    color: "text-cyan-600",
    bgColor: "bg-cyan-100 dark:bg-cyan-900/30",
  },
  project: {
    icon: FileText,
    color: "text-orange-600",
    bgColor: "bg-orange-100 dark:bg-orange-900/30",
  },
  claim: {
    icon: Lightbulb,
    color: "text-yellow-600",
    bgColor: "bg-yellow-100 dark:bg-yellow-900/30",
  },
  risk: {
    icon: AlertTriangle,
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-900/30",
  },
  brief: {
    icon: Zap,
    color: "text-indigo-600",
    bgColor: "bg-indigo-100 dark:bg-indigo-900/30",
  },
};

function getShortId(id: string): string {
  return `UIO-${id.slice(0, 4).toUpperCase()}`;
}

// =============================================================================
// UIO DETAIL PANEL COMPONENT
// =============================================================================

export function UIODetailPanel({
  uioId,
  organizationId,
  onClose,
  className,
}: UIODetailPanelProps) {
  const [noteText, setNoteText] = useState("");

  // Fetch UIO details
  const { data: uio, isLoading } = useQuery({
    ...trpc.uio.getWithDetails.queryOptions({
      id: uioId,
      organizationId,
    }),
    enabled: Boolean(uioId && organizationId),
  });

  // Mutations
  const archiveMutation = useMutation(
    trpc.uio.archive.mutationOptions({
      onSuccess: () => {
        toast.success("Archived");
        queryClient.invalidateQueries({ queryKey: ["uio"] });
      },
      onError: () => toast.error("Failed to archive"),
    })
  );

  const verifyMutation = useMutation(
    trpc.uio.verify.mutationOptions({
      onSuccess: () => {
        toast.success("Verified");
        queryClient.invalidateQueries({ queryKey: ["uio"] });
      },
      onError: () => toast.error("Failed to verify"),
    })
  );

  const dismissMutation = useMutation(
    trpc.uio.dismiss.mutationOptions({
      onSuccess: () => {
        toast.success("Dismissed");
        queryClient.invalidateQueries({ queryKey: ["uio"] });
        onClose?.();
      },
      onError: () => toast.error("Failed to dismiss"),
    })
  );

  if (isLoading) {
    return <UIODetailSkeleton className={className} />;
  }

  if (!uio) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center",
          className
        )}
      >
        <p className="text-muted-foreground">Item not found</p>
      </div>
    );
  }

  const typeConfig = TYPE_CONFIG[uio.type as UIOType] ?? TYPE_CONFIG.brief;
  const TypeIcon = typeConfig.icon;
  const title = uio.userCorrectedTitle ?? uio.canonicalTitle ?? "Untitled";
  const description = uio.canonicalDescription ?? "";

  // Extract entities for linked description
  const entities = extractEntitiesFromUIO(uio);

  // Get sources/conversations
  const sources = uio.sources ?? [];

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header with actions */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="font-mono text-xs">{getShortId(uio.id)}</span>
          {uio.isUserVerified && (
            <Badge className="h-5 px-1.5 text-[10px]" variant="success">
              <Check className="mr-0.5 h-3 w-3" />
              Verified
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!uio.isUserVerified && (
            <Button
              className="h-8 gap-1.5 text-xs"
              disabled={verifyMutation.isPending}
              onClick={() =>
                verifyMutation.mutate({ id: uio.id, organizationId })
              }
              size="sm"
              variant="outline"
            >
              {verifyMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Verify
            </Button>
          )}

          <Button
            className="h-8 gap-1.5 text-xs"
            disabled={archiveMutation.isPending}
            onClick={() =>
              archiveMutation.mutate({ id: uio.id, organizationId })
            }
            size="sm"
            variant="outline"
          >
            {archiveMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
            Archive
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-8 w-8" size="icon" variant="ghost">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive"
                onClick={() =>
                  dismissMutation.mutate({ id: uio.id, organizationId })
                }
              >
                <X className="mr-2 h-4 w-4" />
                Dismiss (incorrect)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {onClose && (
            <Button
              className="h-8 w-8"
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-6">
          {/* Type icon + Title */}
          <div>
            <div
              className={cn(
                "mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg",
                typeConfig.bgColor
              )}
            >
              <TypeIcon className={cn("h-5 w-5", typeConfig.color)} />
            </div>
            <h1 className="font-semibold text-xl">{title}</h1>

            {/* Meta info */}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
              {uio.dueDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Due {format(new Date(uio.dueDate), "MMM d, yyyy")}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Created{" "}
                {formatDistanceToNow(new Date(uio.createdAt), {
                  addSuffix: true,
                })}
              </span>
              {uio.overallConfidence !== null && (
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5" />
                  {Math.round((uio.overallConfidence ?? 0) * 100)}% confident
                </span>
              )}
            </div>
          </div>

          {/* Description with entity linking */}
          {description && (
            <section>
              <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Description
              </h3>
              <LinkedDescription
                className="text-sm leading-relaxed"
                entities={entities}
                text={description}
              />
            </section>
          )}

          {/* Owner/Assignee section */}
          {uio.owner && (
            <section>
              <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Owner
              </h3>
              <EntityBadge
                avatarUrl={uio.owner.avatarUrl}
                id={uio.owner.id}
                name={
                  uio.owner.displayName ??
                  uio.owner.primaryEmail.split("@")[0] ??
                  ""
                }
                size="md"
                type="contact"
              />
            </section>
          )}

          {/* Type-specific details */}
          <TypeSpecificDetails uio={uio} />

          {/* Linked conversations/messages */}
          {sources.length > 0 && (
            <section>
              <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Source Messages
              </h3>
              <div className="space-y-2">
                {sources.map((source) => (
                  <SourceCard key={source.id} source={source} />
                ))}
              </div>
            </section>
          )}

          {/* Timeline */}
          {(uio.timeline?.length ?? 0) > 0 && (
            <section>
              <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Timeline
              </h3>

              {/* Note input */}
              <div className="mb-4">
                <Textarea
                  className="min-h-[60px] resize-none text-sm"
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Leave a note..."
                  value={noteText}
                />
                {noteText && (
                  <div className="mt-2 flex justify-end">
                    <Button size="sm">Add Note</Button>
                  </div>
                )}
              </div>

              {/* Timeline events */}
              <div className="space-y-3">
                {uio.timeline?.map((event) => (
                  <TimelineEvent event={event} key={event.id} />
                ))}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// TYPE-SPECIFIC DETAILS
// =============================================================================

function TypeSpecificDetails({
  uio,
}: {
  uio: {
    type: string;
    commitmentDetails?: {
      status?: string;
      priority?: string;
      direction?: string;
    } | null;
    taskDetails?: { status?: string; priority?: string } | null;
    decisionDetails?: { status?: string; rationale?: string | null } | null;
    riskDetails?: { severity?: string; riskType?: string } | null;
    claimDetails?: { claimType?: string; assertionStrength?: string } | null;
  };
}) {
  if (uio.type === "commitment" && uio.commitmentDetails) {
    const d = uio.commitmentDetails;
    return (
      <section>
        <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Commitment Details
        </h3>
        <div className="flex flex-wrap gap-2">
          {d.status && <Badge variant="secondary">Status: {d.status}</Badge>}
          {d.priority && (
            <Badge
              variant={
                d.priority === "urgent" || d.priority === "high"
                  ? "destructive"
                  : "secondary"
              }
            >
              Priority: {d.priority}
            </Badge>
          )}
          {d.direction && (
            <Badge variant="outline">
              {d.direction === "owed_by_me" ? "You owe" : "Owed to you"}
            </Badge>
          )}
        </div>
      </section>
    );
  }

  if (uio.type === "task" && uio.taskDetails) {
    const d = uio.taskDetails;
    return (
      <section>
        <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Task Details
        </h3>
        <div className="flex flex-wrap gap-2">
          {d.status && <Badge variant="secondary">Status: {d.status}</Badge>}
          {d.priority && d.priority !== "no_priority" && (
            <Badge
              variant={
                d.priority === "urgent" || d.priority === "high"
                  ? "destructive"
                  : "secondary"
              }
            >
              Priority: {d.priority}
            </Badge>
          )}
        </div>
      </section>
    );
  }

  if (uio.type === "decision" && uio.decisionDetails) {
    const d = uio.decisionDetails;
    return (
      <section>
        <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Decision Details
        </h3>
        <div className="space-y-2">
          {d.status && (
            <Badge variant={d.status === "made" ? "success" : "secondary"}>
              Status: {d.status}
            </Badge>
          )}
          {d.rationale && (
            <p className="text-muted-foreground text-sm">{d.rationale}</p>
          )}
        </div>
      </section>
    );
  }

  if (uio.type === "risk" && uio.riskDetails) {
    const d = uio.riskDetails;
    return (
      <section>
        <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          Risk Details
        </h3>
        <div className="flex flex-wrap gap-2">
          {d.severity && (
            <Badge
              variant={
                d.severity === "critical" || d.severity === "high"
                  ? "destructive"
                  : "warning"
              }
            >
              Severity: {d.severity}
            </Badge>
          )}
          {d.riskType && <Badge variant="outline">{d.riskType}</Badge>}
        </div>
      </section>
    );
  }

  return null;
}

// =============================================================================
// SOURCE CARD
// =============================================================================

interface SourceCardProps {
  source: {
    id: string;
    sourceTimestamp?: string | Date | null;
    conversation?: {
      id: string;
      title?: string | null;
      snippet?: string | null;
    } | null;
  };
}

function SourceCard({ source }: SourceCardProps) {
  const conv = source.conversation;
  if (!conv) {
    return null;
  }

  return (
    <div className="group flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted">
        <Mail className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">
          {conv.title ?? "Untitled conversation"}
        </p>
        {conv.snippet && (
          <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
            {conv.snippet}
          </p>
        )}
        {source.sourceTimestamp && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(source.sourceTimestamp), {
              addSuffix: true,
            })}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </div>
  );
}

// =============================================================================
// TIMELINE EVENT
// =============================================================================

interface TimelineEventProps {
  event: {
    id: string;
    eventType: string;
    eventAt: string | Date;
    description?: string | null;
    actorName?: string | null;
  };
}

function TimelineEvent({ event }: TimelineEventProps) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
          <Clock className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="w-px flex-1 bg-border" />
      </div>
      <div className="pb-4">
        <p className="text-sm">
          <span className="font-medium">{event.actorName ?? "System"}</span>
          <span className="text-muted-foreground"> {event.eventType}</span>
        </p>
        {event.description && (
          <p className="mt-0.5 text-muted-foreground text-xs">
            {event.description}
          </p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          {formatDistanceToNow(new Date(event.eventAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

function UIODetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Skeleton className="h-5 w-20" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="flex-1 space-y-6 p-6">
        <div>
          <Skeleton className="mb-3 h-10 w-10 rounded-lg" />
          <Skeleton className="h-6 w-2/3" />
          <div className="mt-2 flex gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div>
          <Skeleton className="mb-2 h-4 w-20" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div>
          <Skeleton className="mb-2 h-4 w-16" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

export function UIODetailEmptyState({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center text-center",
        className
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Target className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-sm">Select an item</h3>
      <p className="mt-1 text-muted-foreground text-xs">
        Choose an intelligence item from the list to view details
      </p>
    </div>
  );
}
