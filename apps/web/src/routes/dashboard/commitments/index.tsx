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
import { AnimatePresence, motion } from "framer-motion";
import {
  Calendar,
  List,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  CommitmentCard,
  CommitmentStats,
  CommitmentTimeline,
  type CommitmentCardData,
} from "@/components/dashboards";
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
  const { data: activeOrg, isPending: orgLoading } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [direction, setDirection] = useState<Direction>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedCommitment, setSelectedCommitment] = useState<string | null>(null);

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
    onSuccess: () => {
      toast.success("Follow-up draft generated", {
        description: "Check your drafts to send",
      });
    },
    onError: () => {
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
      if (e.key === "1") setDirection("all");
      if (e.key === "2") setDirection("owed_by_me");
      if (e.key === "3") setDirection("owed_to_me");
      if (e.key === "r") refetch();
      if (e.key === "v") setViewMode((v) => (v === "list" ? "timeline" : "list"));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commitmentsData, selectedCommitment, refetch]);

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

  // Transform data for components
  const commitments: CommitmentCardData[] = (commitmentsData?.commitments ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    status: c.status as CommitmentCardData["status"],
    priority: c.priority as CommitmentCardData["priority"],
    direction: c.direction as CommitmentCardData["direction"],
    dueDate: c.dueDate ? new Date(c.dueDate) : null,
    confidence: c.confidence,
    isUserVerified: c.isUserVerified ?? undefined,
    evidence: c.metadata?.originalText ? [c.metadata.originalText] : undefined,
    debtor: c.debtor,
    creditor: c.creditor,
    sourceThread: c.sourceThread,
  }));

  // Filter by search
  const filteredCommitments = searchQuery
    ? commitments.filter(
        (c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : commitments;

  const stats = statsData ?? {
    total: 0,
    overdue: 0,
    dueThisWeek: 0,
    owedByMe: 0,
    owedToMe: 0,
    completedThisMonth: 0,
  };

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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Commitment Ledger</h1>
              <p className="text-sm text-muted-foreground">
                Track obligations and follow through
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Settings className="h-4 w-4 mr-2" />
                    Digest Settings
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Daily Digest Settings</SheetTitle>
                    <SheetDescription>
                      Configure how and when you receive commitment summaries
                    </SheetDescription>
                  </SheetHeader>
                  <div className="py-6 space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Digest configuration coming soon...
                    </p>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          {/* Stats */}
          {isLoadingStats ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <CommitmentStats stats={stats} />
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="container flex items-center gap-4">
          {/* Direction Tabs */}
          <Tabs value={direction} onValueChange={(v) => setDirection(v as Direction)}>
            <TabsList>
              <TabsTrigger value="all">
                All
                <Badge variant="secondary" className="ml-2 text-xs">
                  {stats.total}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="owed_by_me">
                I Owe
                <Badge variant="secondary" className="ml-2 text-xs">
                  {stats.owedByMe}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="owed_to_me">
                Owed to Me
                <Badge variant="secondary" className="ml-2 text-xs">
                  {stats.owedToMe}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger className="w-[140px]">
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
          <div className="flex-1 max-w-xs">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search commitments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "timeline" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("timeline")}
            >
              <Calendar className="h-4 w-4" />
            </Button>
          </div>

          {/* Keyboard hints */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 rounded bg-muted">j/k</kbd>
            <span>navigate</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted">1-3</kbd>
            <span>tabs</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted">v</kbd>
            <span>view</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="container py-6">
            {isLoadingCommitments ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </div>
            ) : viewMode === "list" ? (
              <AnimatePresence mode="popLayout">
                <div className="space-y-3">
                  {filteredCommitments.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center py-12"
                    >
                      <p className="text-muted-foreground">No commitments found</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Commitments are automatically extracted from your emails
                      </p>
                    </motion.div>
                  ) : (
                    filteredCommitments.map((commitment) => (
                      <CommitmentCard
                        key={commitment.id}
                        commitment={commitment}
                        isSelected={selectedCommitment === commitment.id}
                        onSelect={() => setSelectedCommitment(commitment.id)}
                        onComplete={handleComplete}
                        onSnooze={handleSnooze}
                        onDismiss={handleDismiss}
                        onVerify={handleVerify}
                        onThreadClick={handleThreadClick}
                        onContactClick={handleContactClick}
                        onGenerateFollowUp={handleGenerateFollowUp}
                      />
                    ))
                  )}
                </div>
              </AnimatePresence>
            ) : (
              <CommitmentTimeline
                commitments={filteredCommitments}
                onCommitmentClick={(c) => setSelectedCommitment(c.id)}
              />
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
