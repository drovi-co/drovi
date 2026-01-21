// =============================================================================
// UIO DETAIL PAGE
// =============================================================================
//
// Full-page Unified Intelligence Object detail view.
// Shows cross-source commitment/decision with full timeline and evidence chain.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  CircleDot,
  Clock,
  Edit2,
  ExternalLink,
  MoreHorizontal,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  EvidenceChain,
  type EvidenceSource,
} from "@/components/unified-object/evidence-chain";
import {
  type SourceBreadcrumb,
  SourceBreadcrumbs,
} from "@/components/unified-object/source-breadcrumbs";
import {
  Timeline,
  type TimelineEvent,
} from "@/components/unified-object/timeline";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/uio/$uioId")({
  component: UIODetailPage,
});

// =============================================================================
// TYPE CONFIGURATIONS
// =============================================================================

const TYPE_CONFIG = {
  commitment: {
    icon: CheckCircle2,
    label: "Commitment",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
  decision: {
    icon: CircleDot,
    label: "Decision",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
  },
  topic: {
    icon: CircleDot,
    label: "Topic",
    color: "text-gray-500",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/30",
  },
} as const;

const STATUS_CONFIG = {
  active: {
    label: "Active",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
  },
  archived: {
    label: "Archived",
    color: "text-gray-500",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/30",
  },
  dismissed: {
    label: "Dismissed",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
  },
  merged: {
    label: "Merged",
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
  },
} as const;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function UIODetailPage() {
  const navigate = useNavigate();
  const { uioId } = useParams({ from: "/dashboard/uio/$uioId" });
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const queryClient = useQueryClient();

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [correctedTitle, setCorrectedTitle] = useState("");

  // Fetch UIO details
  const {
    data: uioData,
    isLoading,
    refetch,
  } = useQuery({
    ...trpc.unifiedObjects.get.queryOptions({
      organizationId,
      uioId,
    }),
    enabled: !!organizationId && !!uioId,
  });

  // Update mutation
  const updateMutation = useMutation(
    trpc.unifiedObjects.update.mutationOptions({
      onSuccess: () => {
        toast.success("Updated successfully");
        refetch();
        setEditingTitle(false);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update");
      },
    })
  );

  // Handle title save
  const handleSaveTitle = () => {
    if (!correctedTitle.trim()) {
      setEditingTitle(false);
      return;
    }

    updateMutation.mutate({
      organizationId,
      uioId,
      userCorrectedTitle: correctedTitle.trim(),
    });
  };

  // Handle status change
  const handleStatusChange = (status: "active" | "archived" | "dismissed") => {
    updateMutation.mutate({
      organizationId,
      uioId,
      status,
    });
  };

  // Handle verify
  const handleVerify = () => {
    updateMutation.mutate({
      organizationId,
      uioId,
      isUserVerified: !uioData?.isUserVerified,
    });
  };

  if (isLoading) {
    return <UIODetailSkeleton />;
  }

  if (!uioData) {
    return (
      <div className="flex h-[calc(100vh-200px)] flex-col items-center justify-center">
        <XCircle className="mb-4 size-12 text-muted-foreground" />
        <h2 className="font-semibold text-lg">Not Found</h2>
        <p className="mb-4 text-muted-foreground">
          This unified object doesn't exist or you don't have access to it.
        </p>
        <Button
          onClick={() => navigate({ to: "/dashboard" })}
          variant="outline"
        >
          <ArrowLeft className="mr-2 size-4" />
          Go Back
        </Button>
      </div>
    );
  }

  const typeConfig =
    TYPE_CONFIG[uioData.type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.topic;
  const statusConfig =
    STATUS_CONFIG[uioData.status as keyof typeof STATUS_CONFIG] ??
    STATUS_CONFIG.active;
  const TypeIcon = typeConfig.icon;
  const displayTitle = uioData.userCorrectedTitle || uioData.canonicalTitle;

  // Transform sources to EvidenceSource format
  const evidenceSources: EvidenceSource[] = (uioData.sources ?? []).map(
    (source) => ({
      id: source.id,
      sourceType: source.sourceType,
      role: source.role as "origin" | "update" | "confirmation" | "context",
      quotedText: source.quotedText,
      extractedTitle: source.extractedTitle,
      confidence: source.confidence ?? 0.8,
      sourceTimestamp: source.sourceTimestamp
        ? new Date(source.sourceTimestamp)
        : null,
      conversationId: source.conversationId,
      messageId: source.messageId,
      emailThreadId: source.emailThreadId,
      emailMessageId: source.emailMessageId,
    })
  );

  // Transform timeline to TimelineEvent format
  const timelineEvents: TimelineEvent[] = (uioData.timeline ?? []).map(
    (event) => ({
      id: event.id,
      eventType: event.eventType as TimelineEvent["eventType"],
      eventDescription: event.eventDescription,
      sourceType: event.sourceType,
      sourceName: event.sourceName,
      messageId: event.messageId,
      quotedText: event.quotedText,
      confidence: event.confidence,
      triggeredBy: event.triggeredBy,
      eventAt: new Date(event.eventAt),
    })
  );

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-border border-b px-6 py-4">
          <div className="mb-4 flex items-center gap-4">
            <Button
              onClick={() => navigate({ to: "/dashboard" })}
              size="sm"
              variant="ghost"
            >
              <ArrowLeft className="mr-2 size-4" />
              Back
            </Button>

            <div className="flex items-center gap-2">
              <Badge
                className={cn(
                  "gap-1",
                  typeConfig.bgColor,
                  typeConfig.borderColor
                )}
                variant="outline"
              >
                <TypeIcon className={cn("size-3", typeConfig.color)} />
                {typeConfig.label}
              </Badge>

              <Badge
                className={cn(statusConfig.bgColor, statusConfig.borderColor)}
                variant="outline"
              >
                <span className={statusConfig.color}>{statusConfig.label}</span>
              </Badge>

              {uioData.isUserVerified && (
                <Badge
                  className="border-green-500/30 bg-green-500/10 text-green-500"
                  variant="outline"
                >
                  <Check className="mr-1 size-3" />
                  Verified
                </Badge>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button onClick={handleVerify} size="sm" variant="outline">
                <Check className="mr-2 size-4" />
                {uioData.isUserVerified ? "Unverify" : "Verify"}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => handleStatusChange("archived")}
                  >
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleStatusChange("dismissed")}
                  >
                    Dismiss
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-500"
                    onClick={() => handleStatusChange("dismissed")}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Title */}
          <div className="flex items-start gap-3">
            {editingTitle ? (
              <div className="flex flex-1 items-center gap-2">
                <Input
                  autoFocus
                  className="font-semibold text-xl"
                  onChange={(e) => setCorrectedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  value={correctedTitle}
                />
                <Button onClick={handleSaveTitle} size="sm">
                  Save
                </Button>
                <Button
                  onClick={() => setEditingTitle(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="group flex-1">
                <h1
                  className="cursor-pointer font-semibold text-xl transition-colors hover:text-muted-foreground"
                  onClick={() => {
                    setEditingTitle(true);
                    setCorrectedTitle(displayTitle);
                  }}
                >
                  {displayTitle}
                  <Edit2 className="ml-2 inline size-4 opacity-0 group-hover:opacity-50" />
                </h1>
                {uioData.userCorrectedTitle && (
                  <p className="mt-1 text-muted-foreground text-sm">
                    Original: {uioData.canonicalTitle}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Source breadcrumbs */}
          {uioData.sourceBreadcrumbs &&
            uioData.sourceBreadcrumbs.length > 0 && (
              <div className="mt-3">
                <SourceBreadcrumbs
                  sources={uioData.sourceBreadcrumbs as SourceBreadcrumb[]}
                  variant="default"
                />
              </div>
            )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-4xl space-y-8 p-6">
            {/* Meta info */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {uioData.dueDate && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                    <Calendar className="size-4" />
                    <span className="font-medium text-xs uppercase">
                      Due Date
                    </span>
                  </div>
                  <p className="font-medium text-sm">
                    {format(new Date(uioData.dueDate), "MMM d, yyyy")}
                  </p>
                  {uioData.dueDateConfidence && (
                    <p className="text-muted-foreground text-xs">
                      {Math.round(uioData.dueDateConfidence * 100)}% confident
                    </p>
                  )}
                </div>
              )}

              {uioData.owner && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                    <User className="size-4" />
                    <span className="font-medium text-xs uppercase">Owner</span>
                  </div>
                  <p className="font-medium text-sm">
                    {uioData.owner.displayName || uioData.owner.primaryEmail}
                  </p>
                </div>
              )}

              <div className="rounded-lg border bg-card p-4">
                <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4" />
                  <span className="font-medium text-xs uppercase">
                    First Seen
                  </span>
                </div>
                <p className="font-medium text-sm">
                  {formatDistanceToNow(new Date(uioData.firstSeenAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4" />
                  <span className="font-medium text-xs uppercase">
                    Last Updated
                  </span>
                </div>
                <p className="font-medium text-sm">
                  {formatDistanceToNow(new Date(uioData.lastUpdatedAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>

            {/* Description */}
            {uioData.canonicalDescription && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-2 font-medium text-sm">Description</h3>
                <p className="text-muted-foreground">
                  {uioData.canonicalDescription}
                </p>
              </div>
            )}

            {/* Evidence Chain */}
            {evidenceSources.length > 0 && (
              <div>
                <h3 className="mb-3 flex items-center gap-2 font-medium text-sm">
                  <ExternalLink className="size-4" />
                  Evidence Chain ({evidenceSources.length} sources)
                </h3>
                <EvidenceChain
                  collapsible={false}
                  onViewSource={(source) => {
                    // Navigate to source based on type
                    if (source.emailThreadId) {
                      navigate({
                        to: "/dashboard/email/thread/$threadId",
                        params: { threadId: source.emailThreadId },
                      });
                    }
                  }}
                  sources={evidenceSources}
                />
              </div>
            )}

            {/* Timeline */}
            {timelineEvents.length > 0 && (
              <div>
                <h3 className="mb-3 flex items-center gap-2 font-medium text-sm">
                  <Clock className="size-4" />
                  History ({timelineEvents.length} events)
                </h3>
                <Timeline
                  events={timelineEvents}
                  onViewSource={(messageId) => {
                    // Could open the message in a sheet
                    console.log("View message:", messageId);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

function UIODetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-border border-b px-6 py-4">
        <div className="mb-4 flex items-center gap-4">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="mt-2 h-6 w-1/2" />
      </div>

      <div className="flex-1 space-y-6 p-6">
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
