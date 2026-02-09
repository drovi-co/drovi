// =============================================================================
// COMMITMENTS LEDGER PAGE
// =============================================================================
//
// The command center for accountability. This isn't a task list - it's an
// intelligence surface showing the full landscape of obligations: what you
// owe, what others owe you, urgency, and the evidence behind each commitment.
//

import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calendar, CheckCircle2, List, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CommitmentListHeader, CommitmentRow } from "@/components/commitments";
import {
  type CommitmentCardData,
  type CommitmentDetailData,
  CommitmentDetailSheet,
  CommitmentTimeline,
} from "@/components/dashboards";
import { EvidenceDetailSheet } from "@/components/evidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCommitmentStats,
  useCommitmentUIOs,
  useDismissUIO,
  useMarkCompleteUIO,
  useSnoozeUIO,
  useUIO,
  useVerifyUIO,
} from "@/hooks/use-uio";
import { useT } from "@/i18n";
import { authClient } from "@/lib/auth-client";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/commitments/")({
  component: CommitmentsPage,
});

// =============================================================================
// TYPES
// =============================================================================

type Direction = "all" | "owed_by_me" | "owed_to_me";
type StatusFilter = "active" | "overdue" | "completed" | "snoozed";
type ViewMode = "list" | "timeline";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function CommitmentsPage() {
  const navigate = useNavigate();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const t = useT();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [direction, setDirection] = useState<Direction>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedCommitment, setSelectedCommitment] = useState<string | null>(
    null
  );
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [evidenceSheetOpen, setEvidenceSheetOpen] = useState(false);
  const [evidenceCommitmentId, setEvidenceCommitmentId] = useState<
    string | null
  >(null);
  const [pendingFollowUpCommitmentId, setPendingFollowUpCommitmentId] =
    useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();

  // Fetch stats using UIO hook
  const { data: statsData, isLoading: isLoadingStats } = useCommitmentStats({
    organizationId,
  });

  // Fetch commitments using UIO hook
  const {
    data: commitmentsData,
    isLoading: isLoadingCommitments,
    refetch,
  } = useCommitmentUIOs({
    organizationId,
    direction: direction === "all" ? undefined : direction,
    status:
      statusFilter === "active"
        ? undefined
        : statusFilter === "overdue"
          ? "overdue"
          : statusFilter === "completed"
            ? "completed"
            : "snoozed",
    limit: 50,
    enabled: !!organizationId,
  });

  // Fetch detailed commitment for sheet using UIO hook
  const { data: detailData } = useUIO({
    organizationId,
    id: selectedCommitment ?? "",
    enabled: !!organizationId && !!selectedCommitment && detailSheetOpen,
  });

  // Evidence detail query using UIO hook
  const { data: evidenceCommitmentData } = useUIO({
    organizationId,
    id: evidenceCommitmentId ?? "",
    enabled: !!organizationId && !!evidenceCommitmentId && evidenceSheetOpen,
  });

  // Mutations using UIO hooks
  const completeMutationBase = useMarkCompleteUIO();
  const completeMutation = {
    ...completeMutationBase,
    mutate: (params: { organizationId: string; commitmentId: string }) => {
      completeMutationBase.mutate(
        { organizationId: params.organizationId, id: params.commitmentId },
        {
          onSuccess: () => {
            toast.success(t("pages.dashboard.commitments.toasts.markComplete"));
            refetch();
            queryClient.invalidateQueries({ queryKey: [["uio"]] });
          },
          onError: () => {
            toast.error(t("pages.dashboard.commitments.toasts.markCompleteFailed"));
          },
        }
      );
    },
  };

  const snoozeMutationBase = useSnoozeUIO();
  const snoozeMutation = {
    ...snoozeMutationBase,
    mutate: (params: {
      organizationId: string;
      commitmentId: string;
      until: Date;
    }) => {
      snoozeMutationBase.mutate(
        {
          organizationId: params.organizationId,
          id: params.commitmentId,
          until: params.until,
        },
        {
          onSuccess: () => {
            toast.success(t("pages.dashboard.commitments.toasts.snoozed"));
            refetch();
            queryClient.invalidateQueries({ queryKey: [["uio"]] });
          },
          onError: () => {
            toast.error(t("pages.dashboard.commitments.toasts.snoozeFailed"));
          },
        }
      );
    },
  };

  const dismissMutationBase = useDismissUIO();
  const dismissMutation = {
    ...dismissMutationBase,
    mutate: (params: { organizationId: string; commitmentId: string }) => {
      dismissMutationBase.mutate(
        { organizationId: params.organizationId, id: params.commitmentId },
        {
          onSuccess: () => {
            toast.success(t("pages.dashboard.commitments.toasts.dismissed"));
            refetch();
            queryClient.invalidateQueries({ queryKey: [["uio"]] });
          },
          onError: () => {
            toast.error(t("pages.dashboard.commitments.toasts.dismissFailed"));
          },
        }
      );
    },
  };

  const verifyMutationBase = useVerifyUIO();
  const verifyMutation = {
    ...verifyMutationBase,
    mutate: (params: { organizationId: string; commitmentId: string }) => {
      verifyMutationBase.mutate(
        { organizationId: params.organizationId, id: params.commitmentId },
        {
          onSuccess: () => {
            toast.success(t("pages.dashboard.commitments.toasts.verified"));
            refetch();
            queryClient.invalidateQueries({ queryKey: [["uio"]] });
          },
          onError: () => {
            toast.error(t("pages.dashboard.commitments.toasts.verifyFailed"));
          },
        }
      );
    },
  };

  // Follow-up generation - simplified without AI call for now
  const handleFollowUpGenerate = useCallback(
    (commitmentId: string) => {
      const commitment = commitmentsData?.items?.find(
        (c) => c.id === commitmentId
      );
      if (!commitment) {
        toast.error(t("pages.dashboard.commitments.toasts.notFound"));
        return;
      }

      // Generate a simple follow-up template
      const debtor = commitment.owner;
      const fallbackTitle = t("pages.dashboard.commitments.followUp.fallbackTitle");
      const subject = t("pages.dashboard.commitments.followUp.subject", {
        title: commitment.canonicalTitle || fallbackTitle,
      });
      const body = t("pages.dashboard.commitments.followUp.body", {
        name: debtor?.displayName ? ` ${debtor.displayName}` : "",
        title: commitment.canonicalTitle || t("pages.dashboard.commitments.followUp.ourCommitment"),
      });

      const draft = t("pages.dashboard.commitments.followUp.draft", { subject, body });
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(draft)
          .then(() => toast.success(t("pages.dashboard.commitments.toasts.followUpCopied")))
          .catch(() => toast.error(t("pages.dashboard.commitments.toasts.followUpCopyFailed")));
      } else {
        toast.success(t("pages.dashboard.commitments.toasts.followUpGenerated"), {
          description: t("pages.dashboard.commitments.toasts.followUpGeneratedDescription"),
        });
      }
    },
    [commitmentsData, t]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // vim-style navigation
      if (e.key === "j") {
        const commitments = commitmentsData?.items ?? [];
        const currentIndex = commitments.findIndex(
          (c) => c.id === selectedCommitment
        );
        if (currentIndex < commitments.length - 1) {
          setSelectedCommitment(commitments[currentIndex + 1]?.id ?? null);
        }
      }
      if (e.key === "k") {
        const commitments = commitmentsData?.items ?? [];
        const currentIndex = commitments.findIndex(
          (c) => c.id === selectedCommitment
        );
        if (currentIndex > 0) {
          setSelectedCommitment(commitments[currentIndex - 1]?.id ?? null);
        }
      }
      if (e.key === "Enter" && selectedCommitment) {
        e.preventDefault();
        navigate({
          to: "/dashboard/commitments/$commitmentId",
          params: { commitmentId: selectedCommitment },
        });
      }
      if (e.key === "1") {
        setDirection("all");
      }
      if (e.key === "2") {
        setDirection("owed_by_me");
      }
      if (e.key === "3") {
        setDirection("owed_to_me");
      }
      if (e.key === "r") {
        refetch();
      }
      if (e.key === "v") {
        setViewMode((v) => (v === "list" ? "timeline" : "list"));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commitmentsData, selectedCommitment, refetch, navigate]);

  // Handlers
  const handleComplete = useCallback(
    (commitmentId: string) => {
      completeMutation.mutate({ organizationId, commitmentId });
    },
    [completeMutation, organizationId]
  );

  const handleSnooze = useCallback(
    (commitmentId: string, days: number) => {
      const until = new Date();
      until.setDate(until.getDate() + days);
      snoozeMutation.mutate({ organizationId, commitmentId, until });
    },
    [snoozeMutation, organizationId]
  );

  const handleDismiss = useCallback(
    (commitmentId: string) => {
      dismissMutation.mutate({ organizationId, commitmentId });
    },
    [dismissMutation, organizationId]
  );

  const handleVerify = useCallback(
    (commitmentId: string) => {
      verifyMutation.mutate({ organizationId, commitmentId });
    },
    [verifyMutation, organizationId]
  );

  const handleGenerateFollowUp = useCallback(
    (commitmentId: string) => {
      handleFollowUpGenerate(commitmentId);
    },
    [handleFollowUpGenerate]
  );

  const handleThreadClick = useCallback(
    () => {
      toast.message(t("pages.dashboard.commitments.toasts.sourceViewerSoon"));
    },
    [t]
  );

  const handleContactClick = useCallback(
    (email: string) => {
      navigate({ to: "/dashboard/contacts", search: { email } });
    },
    [navigate]
  );

  const handleShowEvidence = useCallback((commitmentId: string) => {
    setEvidenceCommitmentId(commitmentId);
    setEvidenceSheetOpen(true);
  }, []);

  // Selection handlers
  const handleSelectItem = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // Transform UIO data for components
  const commitments: CommitmentCardData[] = (commitmentsData?.items ?? []).map(
    (c) => {
      const dueDate = c.dueDate ? new Date(c.dueDate) : null;
      const daysOverdue =
        dueDate && dueDate < new Date()
          ? Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
          : undefined;
      const details = c.commitmentDetails;
      // Get debtor and creditor from UIO root level (where transformer places them)
      const debtor = c.debtor ?? c.owner;
      const creditor = c.creditor;
      const evidenceQuotes = (c.sources ?? [])
        .map((source) => source.quotedText)
        .filter((value): value is string => Boolean(value));
      const sourceType = c.sources?.[0]?.sourceType ?? undefined;
      return {
        id: c.id,
        title: c.userCorrectedTitle ?? c.canonicalTitle ?? "",
        description: c.canonicalDescription,
        status: (details?.status ?? "pending") as CommitmentCardData["status"],
        priority: (details?.priority ??
          "medium") as CommitmentCardData["priority"],
        direction: (details?.direction ??
          "owed_by_me") as CommitmentCardData["direction"],
        dueDate,
        confidence: c.overallConfidence ?? 0.8,
        isUserVerified: c.isUserVerified ?? undefined,
        evidence: evidenceQuotes.length > 0 ? evidenceQuotes : undefined,
        extractedAt: new Date(c.createdAt),
        debtor: debtor
          ? {
              id: debtor.id,
              displayName: debtor.displayName,
              primaryEmail: debtor.primaryEmail,
              avatarUrl: debtor.avatarUrl,
            }
          : undefined,
        creditor: creditor
          ? {
              id: creditor.id,
              displayName: creditor.displayName,
              primaryEmail: creditor.primaryEmail,
              avatarUrl: creditor.avatarUrl,
            }
          : undefined,
        sourceThread: undefined,
        sourceType: sourceType as CommitmentCardData["sourceType"],
        daysOverdue,
      };
    }
  );

  // Filter by search
  const directionFilteredCommitments =
    direction === "all"
      ? commitments
      : commitments.filter((c) => c.direction === direction);

  const filteredCommitments = searchQuery
    ? directionFilteredCommitments.filter(
        (c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : directionFilteredCommitments;

  // Select all handler (must be after filteredCommitments is defined)
  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedIds(new Set(filteredCommitments.map((c) => c.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [filteredCommitments]
  );

  const stats = statsData ?? {
    total: 0,
    open: 0,
    overdue: 0,
    completed: 0,
  };

  const directionCounts = {
    owedByMe: commitments.filter((c) => c.direction === "owed_by_me").length,
    owedToMe: commitments.filter((c) => c.direction === "owed_to_me").length,
  };

  // Transform UIO detail data for sheet
  const detailCommitment: CommitmentDetailData | null = detailData
    ? (() => {
        const details = detailData.commitmentDetails;
        const debtor = detailData.debtor ?? detailData.owner;
        const creditor = detailData.creditor;
        const evidenceQuotes = (detailData.sources ?? [])
          .map((source) => source.quotedText)
          .filter((value): value is string => Boolean(value));
        return {
          id: detailData.id,
          title:
            detailData.userCorrectedTitle ?? detailData.canonicalTitle ?? "",
          description: detailData.canonicalDescription,
          status: (details?.status ??
            "pending") as CommitmentDetailData["status"],
          priority: (details?.priority ??
            "medium") as CommitmentDetailData["priority"],
          direction: (details?.direction ??
            "owed_by_me") as CommitmentDetailData["direction"],
          dueDate: detailData.dueDate ? new Date(detailData.dueDate) : null,
          createdAt: new Date(detailData.createdAt),
          completedAt: details?.completedAt
            ? new Date(details.completedAt)
            : null,
          confidence: detailData.overallConfidence ?? 0.8,
          isUserVerified: detailData.isUserVerified ?? undefined,
          evidence: evidenceQuotes.length > 0 ? evidenceQuotes : undefined,
          debtor: debtor
            ? {
                id: debtor.id,
                displayName: debtor.displayName,
                primaryEmail: debtor.primaryEmail,
                avatarUrl: debtor.avatarUrl,
              }
            : undefined,
          creditor: creditor
            ? {
                id: creditor.id,
                displayName: creditor.displayName,
                primaryEmail: creditor.primaryEmail,
                avatarUrl: creditor.avatarUrl,
              }
            : undefined,
          sourceThread: undefined,
          snoozedUntil: details?.snoozedUntil
            ? new Date(details.snoozedUntil)
            : null,
          metadata: null,
        };
      })()
    : null;

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          {t("pages.dashboard.commitments.noOrg")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* Direction Tabs */}
            <Tabs
              onValueChange={(v) => setDirection(v as Direction)}
              value={direction}
            >
              <TabsList className="h-8 gap-1 bg-transparent">
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="all"
                >
                  {t("pages.dashboard.commitments.tabs.all")}
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.total}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="owed_by_me"
                >
                  {t("pages.dashboard.commitments.tabs.owedByMe")}
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {directionCounts.owedByMe}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="owed_to_me"
                >
                  {t("pages.dashboard.commitments.tabs.owedToMe")}
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {directionCounts.owedToMe}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Status Filter */}
              <Select
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                value={statusFilter}
              >
                <SelectTrigger className="h-8 w-[120px] text-sm">
                  <SelectValue placeholder={t("pages.dashboard.commitments.filters.status.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("pages.dashboard.commitments.filters.status.active")}</SelectItem>
                  <SelectItem value="overdue">{t("pages.dashboard.commitments.filters.status.overdue")}</SelectItem>
                  <SelectItem value="completed">{t("pages.dashboard.commitments.filters.status.completed")}</SelectItem>
                  <SelectItem value="snoozed">{t("pages.dashboard.commitments.filters.status.snoozed")}</SelectItem>
                </SelectContent>
              </Select>

              {/* Search */}
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 w-[180px] pl-8 text-sm"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("pages.dashboard.commitments.search.placeholder")}
                  value={searchQuery}
                />
              </div>

              {/* View Toggle */}
              <div className="flex items-center gap-0.5 rounded-md border p-0.5">
                <Button
                  className="h-7 w-7"
                  onClick={() => setViewMode("list")}
                  size="icon"
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  className="h-7 w-7"
                  onClick={() => setViewMode("timeline")}
                  size="icon"
                  variant={viewMode === "timeline" ? "secondary" : "ghost"}
                >
                  <Calendar className="h-4 w-4" />
                </Button>
              </div>

              <Button
                className="h-8 w-8"
                onClick={() => refetch()}
                size="icon"
                variant="ghost"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              {/* Keyboard hints */}
              <div className="hidden items-center gap-2 text-muted-foreground text-xs lg:flex">
                <kbd className="rounded bg-muted px-1.5 py-0.5">j/k</kbd>
                <span>nav</span>
                <kbd className="rounded bg-muted px-1.5 py-0.5">1-3</kbd>
                <span>tabs</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {isLoadingCommitments ? (
            <div>
              {/* Row skeletons - matching inbox style */}
              {[...new Array(10)].map((_, i) => (
                <div
                  className="flex h-10 items-center border-border border-b px-3"
                  key={i}
                >
                  <div className="flex w-7 shrink-0 items-center justify-center">
                    <Skeleton className="h-3.5 w-3.5 rounded-[3px]" />
                  </div>
                  <div className="flex w-7 shrink-0 items-center justify-center">
                    <Skeleton className="h-4 w-4" />
                  </div>
                  <div className="flex w-6 shrink-0 items-center justify-center">
                    <Skeleton className="h-4 w-4" />
                  </div>
                  <div className="flex w-7 shrink-0 items-center justify-center">
                    <Skeleton className="h-4 w-4 rounded-full" />
                  </div>
                  <div className="w-[120px] shrink-0 px-1">
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="min-w-0 flex-1 px-2">
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                  <div className="flex w-[140px] shrink-0 items-center justify-end gap-1.5">
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : viewMode === "list" ? (
            filteredCommitments.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="font-medium text-lg">{t("pages.dashboard.commitments.empty.title")}</h3>
                <p className="mt-1 text-muted-foreground text-sm">
                  {t("pages.dashboard.commitments.empty.description")}
                </p>
              </div>
            ) : (
              <div>
                {/* List Header */}
                <CommitmentListHeader
                  allSelected={
                    selectedIds.size === filteredCommitments.length &&
                    filteredCommitments.length > 0
                  }
                  onSelectAll={handleSelectAll}
                  someSelected={
                    selectedIds.size > 0 &&
                    selectedIds.size < filteredCommitments.length
                  }
                />
                {/* Commitment Rows */}
                {filteredCommitments.map((commitment, _index) => (
                  <CommitmentRow
                    commitment={{
                      id: commitment.id,
                      title: commitment.title,
                      description: commitment.description,
                      status: commitment.status,
                      priority: commitment.priority,
                      direction: commitment.direction,
                      dueDate: commitment.dueDate,
                      confidence: commitment.confidence,
                      isUserVerified: commitment.isUserVerified,
                      evidence: commitment.evidence,
                      extractedAt: commitment.extractedAt,
                      debtor: commitment.debtor,
                      creditor: commitment.creditor,
                      sourceThreadId: commitment.sourceThread?.id ?? null,
                      sourceType: commitment.sourceType,
                      daysOverdue: commitment.daysOverdue,
                    }}
                    isActive={selectedCommitment === commitment.id}
                    isSelected={selectedIds.has(commitment.id)}
                    key={commitment.id}
                    onClick={() => {
                      navigate({
                        to: "/dashboard/commitments/$commitmentId",
                        params: { commitmentId: commitment.id },
                      });
                    }}
                    onComplete={() => handleComplete(commitment.id)}
                    onDismiss={() => handleDismiss(commitment.id)}
                    onSelect={handleSelectItem}
                    onShowEvidence={() => handleShowEvidence(commitment.id)}
                    onSnooze={(days) => handleSnooze(commitment.id, days)}
                    onVerify={() => handleVerify(commitment.id)}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="p-4">
              <CommitmentTimeline
                commitments={filteredCommitments}
                onCommitmentClick={(c) => {
                  navigate({
                    to: "/dashboard/commitments/$commitmentId",
                    params: { commitmentId: c.id },
                  });
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Commitment Detail Sheet */}
      <CommitmentDetailSheet
        commitment={detailCommitment}
        onComplete={handleComplete}
        onContactClick={handleContactClick}
        onDismiss={handleDismiss}
        onGenerateFollowUp={handleGenerateFollowUp}
        onOpenChange={setDetailSheetOpen}
        onSnooze={handleSnooze}
        onThreadClick={handleThreadClick}
        onVerify={handleVerify}
        open={detailSheetOpen}
      />

      {/* Evidence Detail Sheet */}
      <EvidenceDetailSheet
        evidence={
          evidenceCommitmentData
            ? {
                id: evidenceCommitmentData.id,
                type: "commitment",
                title:
                  evidenceCommitmentData.userCorrectedTitle ??
                  evidenceCommitmentData.canonicalTitle ??
                  "",
                extractedText:
                  evidenceCommitmentData.canonicalDescription ??
                  evidenceCommitmentData.canonicalTitle ??
                  "",
                confidence: evidenceCommitmentData.overallConfidence ?? 0.8,
                isUserVerified: evidenceCommitmentData.isUserVerified ?? false,
                quotedText:
                  evidenceCommitmentData.sources?.[0]?.quotedText ?? null,
                extractedAt: new Date(evidenceCommitmentData.createdAt),
                modelVersion: "llama-4-maverick",
                confidenceFactors: [
                  {
                    name: "Text Clarity",
                    score: evidenceCommitmentData.overallConfidence ?? 0.8,
                    explanation: "How clear the extracted text is",
                    weight: 0.4,
                  },
                  {
                    name: "Context Relevance",
                    score: 0.8,
                    explanation: "How relevant the context is",
                    weight: 0.35,
                  },
                  {
                    name: "Historical Accuracy",
                    score: 0.85,
                    explanation: "Historical accuracy of extractions",
                    weight: 0.25,
                  },
                ],
              }
            : null
        }
        onOpenChange={setEvidenceSheetOpen}
        onThreadClick={handleThreadClick}
        open={evidenceSheetOpen}
      />
    </div>
  );
}
