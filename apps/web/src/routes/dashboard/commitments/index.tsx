// =============================================================================
// COMMITMENTS LEDGER PAGE
// =============================================================================
//
// The command center for accountability. This isn't a task list - it's an
// intelligence surface showing the full landscape of obligations: what you
// owe, what others owe you, urgency, and the evidence behind each commitment.
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Calendar,
  CheckCircle2,
  List,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useCommandBar } from "@/components/email/command-bar";

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
  CommitmentDetailSheet,
  type CommitmentDetailData,
  CommitmentStats,
  CommitmentTimeline,
  type CommitmentCardData,
} from "@/components/dashboards";
import {
  CommitmentRow,
  CommitmentListHeader,
  type CommitmentRowData,
} from "@/components/commitments";
import { EvidenceDetailSheet, type EvidenceData } from "@/components/evidence";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

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
  const { openCompose } = useCommandBar();
  const { data: activeOrg, isPending: orgLoading } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [direction, setDirection] = useState<Direction>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedCommitment, setSelectedCommitment] = useState<string | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [evidenceSheetOpen, setEvidenceSheetOpen] = useState(false);
  const [evidenceCommitmentId, setEvidenceCommitmentId] = useState<string | null>(null);
  const [pendingFollowUpCommitmentId, setPendingFollowUpCommitmentId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch stats
  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    ...trpc.commitments.getStats.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Fetch commitments
  const { data: commitmentsData, isLoading: isLoadingCommitments, refetch } = useQuery({
    ...trpc.commitments.list.queryOptions({
      organizationId,
      limit: 50,
      direction: direction === "all" ? undefined : direction,
      status: statusFilter === "active"
        ? undefined
        : statusFilter === "overdue"
          ? "overdue"
          : statusFilter === "completed"
            ? "completed"
            : "snoozed",
      includeDismissed: false,
    }),
    enabled: !!organizationId,
  });

  // Fetch detailed commitment for sheet
  const { data: detailData } = useQuery({
    ...trpc.commitments.get.queryOptions({
      organizationId,
      commitmentId: selectedCommitment ?? "",
    }),
    enabled: !!organizationId && !!selectedCommitment && detailSheetOpen,
  });

  // Evidence detail query
  const { data: evidenceCommitmentData } = useQuery({
    ...trpc.commitments.get.queryOptions({
      organizationId,
      commitmentId: evidenceCommitmentId ?? "",
    }),
    enabled: !!organizationId && !!evidenceCommitmentId && evidenceSheetOpen,
  });

  // Mutations
  const completeMutation = useMutation({
    ...trpc.commitments.complete.mutationOptions(),
    onSuccess: () => {
      toast.success("Commitment marked complete");
      refetch();
    },
    onError: () => {
      toast.error("Failed to complete commitment");
    },
  });

  const snoozeMutation = useMutation({
    ...trpc.commitments.snooze.mutationOptions(),
    onSuccess: () => {
      toast.success("Commitment snoozed");
      refetch();
    },
    onError: () => {
      toast.error("Failed to snooze commitment");
    },
  });

  const dismissMutation = useMutation({
    ...trpc.commitments.dismiss.mutationOptions(),
    onSuccess: () => {
      toast.success("Commitment dismissed");
      refetch();
    },
    onError: () => {
      toast.error("Failed to dismiss commitment");
    },
  });

  const verifyMutation = useMutation({
    ...trpc.commitments.verify.mutationOptions(),
    onSuccess: () => {
      toast.success("Commitment verified");
      refetch();
    },
    onError: () => {
      toast.error("Failed to verify commitment");
    },
  });

  const followUpMutation = useMutation({
    ...trpc.commitments.generateFollowUp.mutationOptions(),
    onSuccess: (data) => {
      // Dismiss loading toast
      toast.dismiss("followup-generating");

      // Look up the commitment to get the debtor's email
      const commitment = commitmentsData?.commitments?.find(
        (c) => c.id === pendingFollowUpCommitmentId
      );
      const debtor = commitment?.debtor;

      if (debtor?.primaryEmail) {
        openCompose({
          to: [{
            email: debtor.primaryEmail,
            name: debtor.displayName ?? undefined,
          }],
          subject: data.subject,
          body: data.body,
        });
        toast.success("Follow-up draft ready to send!");
      } else {
        // Fallback if no recipient - just show the draft in compose
        openCompose({
          subject: data.subject,
          body: data.body,
        });
        toast.success("Follow-up draft generated - please add recipient");
      }
      setPendingFollowUpCommitmentId(null);
    },
    onError: () => {
      toast.dismiss("followup-generating");
      setPendingFollowUpCommitmentId(null);
      toast.error("Failed to generate follow-up");
    },
  });

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
        const commitments = commitmentsData?.commitments ?? [];
        const currentIndex = commitments.findIndex((c) => c.id === selectedCommitment);
        if (currentIndex < commitments.length - 1) {
          setSelectedCommitment(commitments[currentIndex + 1]?.id ?? null);
        }
      }
      if (e.key === "k") {
        const commitments = commitmentsData?.commitments ?? [];
        const currentIndex = commitments.findIndex((c) => c.id === selectedCommitment);
        if (currentIndex > 0) {
          setSelectedCommitment(commitments[currentIndex - 1]?.id ?? null);
        }
      }
      if (e.key === "Enter" && selectedCommitment) {
        e.preventDefault();
        setDetailSheetOpen(true);
      }
      if (e.key === "Escape" && detailSheetOpen) {
        setDetailSheetOpen(false);
      }
      if (e.key === "1") setDirection("all");
      if (e.key === "2") setDirection("owed_by_me");
      if (e.key === "3") setDirection("owed_to_me");
      if (e.key === "r") refetch();
      if (e.key === "v") setViewMode((v) => (v === "list" ? "timeline" : "list"));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commitmentsData, selectedCommitment, detailSheetOpen, refetch]);

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
      // Store the commitment ID so we can look it up in onSuccess
      setPendingFollowUpCommitmentId(commitmentId);
      // Show generating toast immediately
      toast.loading("Generating follow-up...", { id: "followup-generating" });
      followUpMutation.mutate({ organizationId, commitmentId });
    },
    [followUpMutation, organizationId]
  );

  const handleThreadClick = useCallback(
    (threadId: string) => {
      navigate({ to: "/dashboard/email/thread/$threadId", params: { threadId } });
    },
    [navigate]
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

  // Transform data for components
  const commitments: CommitmentCardData[] = (commitmentsData?.commitments ?? []).map((c) => {
    const dueDate = c.dueDate ? new Date(c.dueDate) : null;
    const daysOverdue = dueDate && dueDate < new Date()
      ? Math.floor((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      : undefined;
    return {
      id: c.id,
      title: c.title,
      description: c.description,
      status: c.status as CommitmentCardData["status"],
      priority: c.priority as CommitmentCardData["priority"],
      direction: c.direction as CommitmentCardData["direction"],
      dueDate,
      confidence: c.confidence,
      isUserVerified: c.isUserVerified ?? undefined,
      evidence: c.metadata?.originalText ? [c.metadata.originalText] : undefined,
      debtor: c.debtor,
      creditor: c.creditor,
      sourceThread: c.sourceThread,
      sourceType: undefined, // Not available in list response
      daysOverdue,
    };
  });

  // Filter by search
  const filteredCommitments = searchQuery
    ? commitments.filter(
        (c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : commitments;

  // Select all handler (must be after filteredCommitments is defined)
  const handleSelectAll = useCallback((selected: boolean) => {
    if (selected) {
      setSelectedIds(new Set(filteredCommitments.map((c) => c.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [filteredCommitments]);

  const stats = statsData ?? {
    total: 0,
    overdue: 0,
    dueThisWeek: 0,
    owedByMe: 0,
    owedToMe: 0,
    completedThisMonth: 0,
  };

  // Transform detail data for sheet
  const detailCommitment: CommitmentDetailData | null = detailData
    ? {
        id: detailData.id,
        title: detailData.title,
        description: detailData.description,
        status: detailData.status as CommitmentDetailData["status"],
        priority: detailData.priority as CommitmentDetailData["priority"],
        direction: detailData.direction as CommitmentDetailData["direction"],
        dueDate: detailData.dueDate ? new Date(detailData.dueDate) : null,
        createdAt: new Date(detailData.createdAt),
        confidence: detailData.confidence,
        isUserVerified: detailData.isUserVerified ?? undefined,
        evidence: detailData.metadata?.originalText ? [detailData.metadata.originalText] : undefined,
        debtor: detailData.debtor,
        creditor: detailData.creditor,
        sourceThread: detailData.sourceThread,
        metadata: detailData.metadata,
      }
    : null;

  if (orgLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select an organization to view commitments</p>
      </div>
    );
  }

  return (
    <div data-no-shell-padding className="h-full">
      <div className="flex flex-col h-[calc(100vh-var(--header-height))]">
        {/* Header */}
        <div className="border-b bg-background">
        <div className="flex items-center justify-between px-4 py-2">
          {/* Direction Tabs */}
          <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)}>
            <TabsList className="h-8 bg-transparent gap-1">
              <TabsTrigger
                value="all"
                className="text-sm px-3 data-[state=active]:bg-accent gap-2"
              >
                All
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                  {stats.total}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="owed_by_me"
                className="text-sm px-3 data-[state=active]:bg-accent gap-2"
              >
                I Owe
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                  {stats.owedByMe}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="owed_to_me"
                className="text-sm px-3 data-[state=active]:bg-accent gap-2"
              >
                Owed to Me
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                  {stats.owedToMe}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Status Filter */}
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger className="h-8 w-[120px] text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="snoozed">Snoozed</SelectItem>
              </SelectContent>
            </Select>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 w-[180px] pl-8 text-sm"
              />
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-0.5 border rounded-md p-0.5">
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "timeline" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setViewMode("timeline")}
              >
                <Calendar className="h-4 w-4" />
              </Button>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Keyboard hints */}
            <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-muted">j/k</kbd>
              <span>nav</span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted">1-3</kbd>
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
              {[...Array(10)].map((_, i) => (
                <div key={i} className="flex items-center h-10 px-3 border-b border-[#191A23]">
                  <div className="w-7 shrink-0 flex items-center justify-center">
                    <Skeleton className="h-3.5 w-3.5 rounded-[3px]" />
                  </div>
                  <div className="w-7 shrink-0 flex items-center justify-center">
                    <Skeleton className="h-4 w-4" />
                  </div>
                  <div className="w-6 shrink-0 flex items-center justify-center">
                    <Skeleton className="h-4 w-4" />
                  </div>
                  <div className="w-7 shrink-0 flex items-center justify-center">
                    <Skeleton className="h-4 w-4 rounded-full" />
                  </div>
                  <div className="w-[120px] shrink-0 px-1">
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex-1 min-w-0 px-2">
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                  <div className="shrink-0 w-[140px] flex items-center justify-end gap-1.5">
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : viewMode === "list" ? (
            filteredCommitments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                  <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium">No commitments found</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Commitments are automatically extracted from your emails
                </p>
              </div>
            ) : (
              <div>
                {/* List Header */}
                <CommitmentListHeader
                  onSelectAll={handleSelectAll}
                  allSelected={selectedIds.size === filteredCommitments.length && filteredCommitments.length > 0}
                  someSelected={selectedIds.size > 0 && selectedIds.size < filteredCommitments.length}
                />
                {/* Commitment Rows */}
                {filteredCommitments.map((commitment, index) => (
                  <CommitmentRow
                    key={commitment.id}
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
                      debtor: commitment.debtor,
                      creditor: commitment.creditor,
                      sourceType: commitment.sourceType,
                      daysOverdue: commitment.daysOverdue,
                    }}
                    isSelected={selectedIds.has(commitment.id)}
                    isActive={selectedCommitment === commitment.id}
                    onSelect={handleSelectItem}
                    onClick={() => {
                      setSelectedCommitment(commitment.id);
                      setDetailSheetOpen(true);
                    }}
                    onComplete={() => handleComplete(commitment.id)}
                    onSnooze={(days) => handleSnooze(commitment.id, days)}
                    onShowEvidence={() => handleShowEvidence(commitment.id)}
                    onDismiss={() => handleDismiss(commitment.id)}
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
                  setSelectedCommitment(c.id);
                  setDetailSheetOpen(true);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Commitment Detail Sheet */}
      <CommitmentDetailSheet
        commitment={detailCommitment}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        onComplete={handleComplete}
        onSnooze={handleSnooze}
        onDismiss={handleDismiss}
        onVerify={handleVerify}
        onThreadClick={handleThreadClick}
        onContactClick={handleContactClick}
        onGenerateFollowUp={handleGenerateFollowUp}
      />

      {/* Evidence Detail Sheet */}
      <EvidenceDetailSheet
        open={evidenceSheetOpen}
        onOpenChange={setEvidenceSheetOpen}
        evidence={
          evidenceCommitmentData
            ? {
                id: evidenceCommitmentData.id,
                type: "commitment",
                title: evidenceCommitmentData.title,
                extractedText: evidenceCommitmentData.description ?? evidenceCommitmentData.title,
                confidence: evidenceCommitmentData.confidence,
                isUserVerified: evidenceCommitmentData.isUserVerified ?? false,
                quotedText: evidenceCommitmentData.metadata?.originalText ?? null,
                extractedAt: new Date(evidenceCommitmentData.createdAt),
                modelVersion: "gpt-4o",
                confidenceFactors: [
                  { name: "Text Clarity", score: evidenceCommitmentData.confidence, explanation: "How clear the extracted text is", weight: 0.4 },
                  { name: "Context Relevance", score: 0.8, explanation: "How relevant the context is", weight: 0.35 },
                  { name: "Historical Accuracy", score: 0.85, explanation: "Historical accuracy of extractions", weight: 0.25 },
                ],
              }
            : null
        }
        onThreadClick={handleThreadClick}
      />
    </div>
  );
}
