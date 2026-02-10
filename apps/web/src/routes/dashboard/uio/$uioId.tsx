// =============================================================================
// UIO DETAIL PAGE
// =============================================================================
//
// Full-page Unified Intelligence Object detail view.
// Shows cross-source commitment/decision with full timeline and evidence chain.
//

import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
  Timeline,
  type TimelineEvent,
} from "@/components/unified-object/timeline";
import { useCorrectUIO, useUIO, useUpdateUIO } from "@/hooks/use-uio";
import { useI18n, useT } from "@/i18n";
import { authClient } from "@/lib/auth-client";
import { formatRelativeTime } from "@/lib/intl-time";
import { cn } from "@/lib/utils";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

const searchSchema = z.object({
  from: z.string().optional(), // Return URL for smart back navigation
});

export const Route = createFileRoute("/dashboard/uio/$uioId")({
  component: UIODetailPage,
  validateSearch: searchSchema,
});

// =============================================================================
// TYPE CONFIGURATIONS
// =============================================================================

const TYPE_CONFIG = {
  commitment: {
    icon: CheckCircle2,
    labelKey: "pages.dashboard.uioDetail.types.commitment",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
  decision: {
    icon: CircleDot,
    labelKey: "pages.dashboard.uioDetail.types.decision",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
  },
  topic: {
    icon: CircleDot,
    labelKey: "pages.dashboard.uioDetail.types.topic",
    color: "text-gray-500",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/30",
  },
} as const;

const STATUS_CONFIG = {
  active: {
    labelKey: "pages.dashboard.uioDetail.status.active",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
  },
  archived: {
    labelKey: "pages.dashboard.uioDetail.status.archived",
    color: "text-gray-500",
    bgColor: "bg-gray-500/10",
    borderColor: "border-gray-500/30",
  },
  dismissed: {
    labelKey: "pages.dashboard.uioDetail.status.dismissed",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
  },
  merged: {
    labelKey: "pages.dashboard.uioDetail.status.merged",
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
  const search = Route.useSearch();
  const returnUrl = search.from;
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const organizationId = activeOrg?.id ?? "";
  const queryClient = useQueryClient();
  const t = useT();
  const { locale } = useI18n();

  // Smart back navigation
  const handleBack = () => {
    if (returnUrl) {
      navigate({ to: returnUrl });
    } else {
      navigate({ to: "/dashboard" });
    }
  };

  // Editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [correctedTitle, setCorrectedTitle] = useState("");

  // Fetch UIO details using the Python API
  const {
    data: uioData,
    isLoading,
    refetch,
  } = useUIO({
    organizationId,
    id: uioId,
    enabled: !!uioId,
  });

  useEffect(() => {
    if (uioData?.title) {
      setCorrectedTitle(uioData.title);
    }
  }, [uioData?.title]);

  // Update mutation using the Python API
  const updateMutationFn = useUpdateUIO();
  const correctionMutation = useCorrectUIO();
  const updateMutation = {
    mutate: (data: { status?: string }) => {
      if (data.status) {
        updateMutationFn.mutate(
          { id: uioId, status: data.status },
          {
            onSuccess: () => {
              toast.success(t("pages.dashboard.uioDetail.toasts.updated"));
              refetch();
              setEditingTitle(false);
            },
            onError: (error) => {
              toast.error(
                error instanceof Error
                  ? error.message
                  : t("pages.dashboard.uioDetail.toasts.updateFailed")
              );
            },
          }
        );
      }
    },
    isPending: updateMutationFn.isPending,
  };

  // Handle title save
  const handleSaveTitle = () => {
    if (!correctedTitle.trim()) {
      setEditingTitle(false);
      return;
    }
    if (!organizationId) {
      toast.error(t("pages.dashboard.uioDetail.toasts.orgUnavailable"));
      return;
    }
    correctionMutation.mutate(
      {
        id: uioId,
        organizationId,
        updates: { canonical_title: correctedTitle.trim() },
      },
      {
        onSuccess: () => {
          toast.success(t("pages.dashboard.uioDetail.toasts.titleUpdated"));
          refetch();
          setEditingTitle(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t("pages.dashboard.uioDetail.toasts.updateFailed")
          );
        },
      }
    );
  };

  // Handle status change
  const handleStatusChange = (
    status: "active" | "archived" | "dismissed" | "completed"
  ) => {
    updateMutation.mutate({ status });
  };

  // Handle verify - mark as active (verified)
  const handleVerify = () => {
    updateMutation.mutate({ status: "active" });
  };

  if (isLoading) {
    return <UIODetailSkeleton />;
  }

  if (!uioData) {
    return (
      <div className="flex h-[calc(100vh-200px)] flex-col items-center justify-center">
        <XCircle className="mb-4 size-12 text-muted-foreground" />
        <h2 className="font-semibold text-lg">
          {t("pages.dashboard.uioDetail.notFound.title")}
        </h2>
        <p className="mb-4 text-muted-foreground">
          {t("pages.dashboard.uioDetail.notFound.description")}
        </p>
        <Button onClick={handleBack} variant="outline">
          <ArrowLeft className="mr-2 size-4" />
          {t("pages.dashboard.uioDetail.notFound.back")}
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
  const displayTitle = uioData.title;

  const evidenceSources: EvidenceSource[] = (uioData.sources ?? []).map(
    (source) => ({
      id: source.id,
      sourceType: source.sourceType ?? "unknown",
      role: (source.role as EvidenceSource["role"]) ?? "origin",
      quotedText: source.quotedText ?? null,
      segmentHash: source.segmentHash ?? null,
      extractedTitle: uioData.title,
      confidence: uioData.overallConfidence ?? uioData.confidence ?? 0.8,
      sourceTimestamp: source.sourceTimestamp
        ? new Date(source.sourceTimestamp)
        : null,
      conversationId: source.conversationId ?? null,
      messageId: source.messageId ?? null,
    })
  );

  // Timeline events (simplified based on available data)
  const timelineEvents: TimelineEvent[] = uioData.createdAt
    ? [
        {
          id: "created",
          eventType: "created" as TimelineEvent["eventType"],
          eventDescription: t("pages.dashboard.uioDetail.timeline.extracted"),
          sourceType: "email",
          sourceName: t("evidenceChain.sources.email"),
          messageId: null,
          quotedText: null,
          confidence: uioData.overallConfidence ?? uioData.confidence ?? 0.8,
          triggeredBy: null,
          eventAt: new Date(uioData.createdAt),
        },
      ]
    : [];

  // Computed properties for compatibility
  const isUserVerified = uioData.status === "active";

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="border-border border-b px-6 py-4">
          <div className="mb-4 flex items-center gap-4">
            <Button onClick={handleBack} size="sm" variant="ghost">
              <ArrowLeft className="mr-2 size-4" />
              {t("common.actions.back")}
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
                {t(typeConfig.labelKey)}
              </Badge>

              <Badge
                className={cn(statusConfig.bgColor, statusConfig.borderColor)}
                variant="outline"
              >
                <span className={statusConfig.color}>
                  {t(statusConfig.labelKey)}
                </span>
              </Badge>

              {isUserVerified && (
                <Badge
                  className="border-green-500/30 bg-green-500/10 text-green-500"
                  variant="outline"
                >
                  <Check className="mr-1 size-3" />
                  {t("pages.dashboard.uioDetail.verified")}
                </Badge>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button onClick={handleVerify} size="sm" variant="outline">
                <Check className="mr-2 size-4" />
                {isUserVerified
                  ? t("pages.dashboard.uioDetail.actions.unverify")
                  : t("pages.dashboard.uioDetail.actions.verify")}
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
                    {t("pages.dashboard.uioDetail.actions.archive")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleStatusChange("dismissed")}
                  >
                    {t("pages.dashboard.uioDetail.actions.dismiss")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-500"
                    onClick={() => handleStatusChange("dismissed")}
                  >
                    <Trash2 className="mr-2 size-4" />
                    {t("common.actions.delete")}
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
                    if (e.key === "Enter") {
                      handleSaveTitle();
                    }
                    if (e.key === "Escape") {
                      setEditingTitle(false);
                    }
                  }}
                  value={correctedTitle}
                />
                <Button onClick={handleSaveTitle} size="sm">
                  {t("common.actions.save")}
                </Button>
                <Button
                  onClick={() => setEditingTitle(false)}
                  size="sm"
                  variant="ghost"
                >
                  {t("common.actions.cancel")}
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
                {uioData.description && (
                  <p className="mt-1 text-muted-foreground text-sm">
                    {uioData.description}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Source info - simplified */}
          {uioData.evidenceId && (
            <div className="mt-3 flex items-center gap-2 text-muted-foreground text-xs">
              <ExternalLink className="h-3 w-3" />
              <span>
                {t("pages.dashboard.uioDetail.evidence.short", {
                  id: uioData.evidenceId.slice(0, 8),
                })}
              </span>
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
                      {t("pages.dashboard.uioDetail.meta.dueDate")}
                    </span>
                  </div>
                  <p className="font-medium text-sm">
                    {new Intl.DateTimeFormat(locale, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(new Date(uioData.dueDate))}
                  </p>
                </div>
              )}

              {(uioData.creditor || uioData.debtor) && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                    <User className="size-4" />
                    <span className="font-medium text-xs uppercase">
                      {uioData.direction === "owed_to_me"
                        ? t("pages.dashboard.uioDetail.meta.from")
                        : t("pages.dashboard.uioDetail.meta.to")}
                    </span>
                  </div>
                  <p className="font-medium text-sm">
                    {uioData.direction === "owed_to_me"
                      ? (uioData.debtor?.displayName ??
                        uioData.debtor?.primaryEmail)
                      : (uioData.creditor?.displayName ??
                        uioData.creditor?.primaryEmail)}
                  </p>
                </div>
              )}

              <div className="rounded-lg border bg-card p-4">
                <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4" />
                  <span className="font-medium text-xs uppercase">
                    {t("pages.dashboard.uioDetail.meta.confidence")}
                  </span>
                </div>
                <p className="font-medium text-sm">
                  {Math.round(
                    (uioData.overallConfidence ?? uioData.confidence ?? 0) * 100
                  )}
                  % (
                  {t(
                    `pages.dashboard.uioDetail.confidenceTier.${uioData.confidenceTier || "medium"}`
                  )}
                  )
                </p>
              </div>

              {uioData.createdAt && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                    <Clock className="size-4" />
                    <span className="font-medium text-xs uppercase">
                      {t("pages.dashboard.uioDetail.meta.created")}
                    </span>
                  </div>
                  <p className="font-medium text-sm">
                    {formatRelativeTime(new Date(uioData.createdAt), locale)}
                  </p>
                </div>
              )}
            </div>

            {/* Description */}
            {uioData.description && (
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-2 font-medium text-sm">
                  {t("pages.dashboard.uioDetail.sections.description")}
                </h3>
                <p className="text-muted-foreground">{uioData.description}</p>
              </div>
            )}

            {/* Evidence Chain */}
            {evidenceSources.length > 0 && (
              <div>
                <h3 className="mb-3 flex items-center gap-2 font-medium text-sm">
                  <ExternalLink className="size-4" />
                  {evidenceSources.length === 1
                    ? t("evidenceChain.headingOne", {
                        count: evidenceSources.length,
                      })
                    : t("evidenceChain.headingMany", {
                        count: evidenceSources.length,
                      })}
                </h3>
                <EvidenceChain
                  collapsible={false}
                  onViewSource={(source) => {
                    if (
                      source.sourceType === "document" &&
                      source.conversationId &&
                      source.messageId
                    ) {
                      navigate({
                        to: "/dashboard/drive",
                        search: {
                          tab: "browse",
                          doc: source.conversationId ?? undefined,
                          chunk: source.messageId ?? undefined,
                          quote: source.quotedText ?? undefined,
                        },
                      });
                      return;
                    }
                    toast.message(
                      t("pages.dashboard.uioDetail.toasts.sourceViewerSoon")
                    );
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
                  {timelineEvents.length === 1
                    ? t("pages.dashboard.uioDetail.sections.historyOne", {
                        count: timelineEvents.length,
                      })
                    : t("pages.dashboard.uioDetail.sections.historyMany", {
                        count: timelineEvents.length,
                      })}
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

            {/* Comments & Discussion */}
            <div>
              <h3 className="mb-3 font-medium text-sm">
                {t("pages.dashboard.uioDetail.sections.discussion")}
              </h3>
              <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-4 text-muted-foreground text-xs">
                {t("pages.dashboard.uioDetail.discussion.placeholder")}
              </div>
            </div>
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
