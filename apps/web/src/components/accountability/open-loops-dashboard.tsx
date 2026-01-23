// =============================================================================
// MY OPEN LOOPS DASHBOARD
// =============================================================================
//
// The command center for accountability. This isn't just a task list - it's
// THE view that answers "What do I owe? What's owed to me? What's overdue?"
//
// This is where trust is maintained or broken. Every open loop is a promise
// that needs resolution.
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format, isPast, isToday, isTomorrow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Loader2,
  MoreHorizontal,
  Pause,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { useCommandBar } from "@/components/email/command-bar";

import { ConfidenceBadge } from "@/components/evidence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface OpenLoopItem {
  id: string;
  title: string;
  description?: string | null;
  status: "pending" | "in_progress" | "overdue" | "waiting" | "snoozed";
  priority: "low" | "medium" | "high" | "urgent";
  direction: "owed_by_me" | "owed_to_me";
  dueDate?: Date | null;
  createdAt: Date;
  confidence: number;
  isUserVerified?: boolean;
  daysOverdue?: number;
  otherParty?: {
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  } | null;
  sourceThread?: {
    id: string;
    subject?: string | null;
  } | null;
}

interface OpenLoopsDashboardProps {
  organizationId: string;
  onCommitmentClick?: (commitmentId: string) => void;
  onThreadClick?: (threadId: string) => void;
  onContactClick?: (email: string) => void;
  onShowEvidence?: (commitmentId: string) => void;
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getUrgencyLevel(
  item: OpenLoopItem
): "critical" | "high" | "medium" | "low" {
  if (item.status === "overdue" || (item.dueDate && isPast(item.dueDate))) {
    return "critical";
  }
  if (item.dueDate && isToday(item.dueDate)) {
    return "high";
  }
  if (item.dueDate && isTomorrow(item.dueDate)) {
    return "medium";
  }
  if (item.priority === "urgent") {
    return "critical";
  }
  if (item.priority === "high") {
    return "high";
  }
  return "low";
}

function getInitials(name: string | null | undefined, email: string): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

// =============================================================================
// SCORE CARD COMPONENT
// =============================================================================

interface ScoreCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ElementType;
  trend?: { value: number; label: string };
  color: "blue" | "green" | "amber" | "red" | "purple";
}

function ScoreCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color,
}: ScoreCardProps) {
  const colorClasses = {
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    green: "bg-green-500/10 text-green-600 dark:text-green-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
    purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  };

  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {title}
            </p>
            <p className="mt-1 font-bold text-2xl">{value}</p>
            {subtitle && (
              <p className="mt-0.5 text-muted-foreground text-xs">{subtitle}</p>
            )}
          </div>
          <div className={cn("rounded-lg p-2", colorClasses[color])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend && (
          <div className="mt-2 flex items-center gap-1 text-xs">
            <TrendingUp
              className={cn(
                "h-3 w-3",
                trend.value >= 0 ? "text-green-500" : "text-red-500"
              )}
            />
            <span
              className={trend.value >= 0 ? "text-green-600" : "text-red-600"}
            >
              {trend.value > 0 ? "+" : ""}
              {trend.value}%
            </span>
            <span className="text-muted-foreground">{trend.label}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// OPEN LOOP ITEM COMPONENT
// =============================================================================

interface OpenLoopItemCardProps {
  item: OpenLoopItem;
  onComplete?: () => void;
  onSnooze?: (days: number) => void;
  onFollowUp?: () => void;
  onClick?: () => void;
  onShowEvidence?: () => void;
  onThreadClick?: () => void;
  isLoading?: boolean;
}

function OpenLoopItemCard({
  item,
  onComplete,
  onSnooze,
  onFollowUp,
  onClick,
  onShowEvidence,
  onThreadClick,
  isLoading,
}: OpenLoopItemCardProps) {
  const urgency = getUrgencyLevel(item);
  const isOverdue =
    item.status === "overdue" || (item.dueDate && isPast(item.dueDate));

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors",
        "border-border/40 border-b hover:bg-accent/50"
      )}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: 10 }}
      layout
      onClick={onClick}
    >
      {/* Urgency Indicator */}
      {urgency === "critical" && (
        <div className="absolute top-0 bottom-0 left-0 w-1 bg-red-500" />
      )}
      {urgency === "high" && (
        <div className="absolute top-0 bottom-0 left-0 w-1 bg-amber-500" />
      )}
      {urgency === "medium" && (
        <div className="absolute top-0 bottom-0 left-0 w-1 bg-blue-500" />
      )}

      {/* Avatar */}
      {item.otherParty ? (
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="bg-muted font-medium text-xs">
            {getInitials(
              item.otherParty.displayName,
              item.otherParty.primaryEmail
            )}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      {/* Direction badge */}
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 font-medium text-xs",
          item.direction === "owed_by_me"
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
        )}
      >
        {item.direction === "owed_by_me" ? "I owe" : "Owed to me"}
      </span>

      {/* Other Person */}
      {item.otherParty && (
        <span className="w-32 shrink-0 truncate font-medium text-foreground/80 text-sm">
          {item.otherParty.displayName ?? item.otherParty.primaryEmail}
        </span>
      )}

      {/* Title */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
        <span className="truncate text-muted-foreground text-sm">
          {item.title}
        </span>
      </div>

      {/* Due Date */}
      {item.dueDate && (
        <span
          className={cn(
            "shrink-0 text-xs",
            isOverdue && "font-medium text-red-600 dark:text-red-400",
            urgency === "high" &&
              !isOverdue &&
              "text-amber-600 dark:text-amber-400",
            urgency === "medium" && "text-blue-600 dark:text-blue-400",
            urgency === "low" && "text-muted-foreground"
          )}
        >
          {isOverdue
            ? `${item.daysOverdue ?? Math.ceil((Date.now() - (item.dueDate?.getTime() ?? Date.now())) / (1000 * 60 * 60 * 24))}d overdue`
            : isToday(item.dueDate)
              ? "Today"
              : isTomorrow(item.dueDate)
                ? "Tomorrow"
                : format(item.dueDate, "MMM d")}
        </span>
      )}

      {/* Actions */}
      <div
        className="flex shrink-0 items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <ConfidenceBadge
          confidence={item.confidence}
          isUserVerified={item.isUserVerified}
          showDetails={false}
          size="sm"
        />

        {onShowEvidence && (
          <button
            className="rounded-md p-1.5 transition-colors hover:bg-background"
            onClick={onShowEvidence}
            title="Show evidence"
            type="button"
          >
            <Eye className="h-4 w-4 text-purple-500" />
          </button>
        )}

        {onComplete && (
          <button
            className="rounded-md p-1.5 transition-colors hover:bg-background"
            disabled={isLoading}
            onClick={onComplete}
            title="Mark complete"
            type="button"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4 text-green-600" />
            )}
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-background"
              type="button"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onShowEvidence && (
              <DropdownMenuItem onClick={onShowEvidence}>
                <Eye className="mr-2 h-4 w-4" />
                Show Evidence
              </DropdownMenuItem>
            )}
            {item.sourceThread && onThreadClick && (
              <DropdownMenuItem onClick={onThreadClick}>
                <ExternalLink className="mr-2 h-4 w-4" />
                View Source Thread
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {onComplete && (
              <DropdownMenuItem onClick={onComplete}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Mark Complete
              </DropdownMenuItem>
            )}
            {onSnooze && (
              <>
                <DropdownMenuItem onClick={() => onSnooze(1)}>
                  <Clock className="mr-2 h-4 w-4" />
                  Snooze 1 day
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSnooze(3)}>
                  <Pause className="mr-2 h-4 w-4" />
                  Snooze 3 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSnooze(7)}>
                  <Pause className="mr-2 h-4 w-4" />
                  Snooze 1 week
                </DropdownMenuItem>
              </>
            )}
            {item.direction === "owed_to_me" && isOverdue && onFollowUp && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onFollowUp}>
                  <Send className="mr-2 h-4 w-4" />
                  Generate Follow-up
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function OpenLoopsDashboard({
  organizationId,
  onCommitmentClick,
  onThreadClick,
  onContactClick,
  onShowEvidence,
  className,
}: OpenLoopsDashboardProps) {
  const trpc = useTRPC();
  const { openCompose } = useCommandBar();
  const [activeTab, setActiveTab] = useState<"all" | "mine" | "others">("all");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["overdue", "today", "this_week"])
  );
  // Track commitment being followed up for passing to compose
  const [pendingFollowUpCommitment, setPendingFollowUpCommitment] =
    useState<OpenLoopItem | null>(null);

  // Fetch open loops (commitments that are not completed)
  const {
    data: loopsData,
    isLoading,
    refetch,
  } = useQuery(
    trpc.commitments.list.queryOptions({
      organizationId,
      limit: 100,
      includeDismissed: false,
    })
  );

  // Mutations
  const completeMutation = useMutation({
    ...trpc.commitments.complete.mutationOptions(),
    onSuccess: () => {
      toast.success("Commitment completed!");
      refetch();
    },
  });

  const snoozeMutation = useMutation({
    ...trpc.commitments.snooze.mutationOptions(),
    onSuccess: () => {
      toast.success("Commitment snoozed");
      refetch();
    },
  });

  const followUpMutation = useMutation({
    ...trpc.commitments.generateFollowUp.mutationOptions(),
    onSuccess: (data) => {
      // Dismiss loading toast
      toast.dismiss("followup-generating");

      // Open compose dialog with the generated follow-up
      if (pendingFollowUpCommitment?.otherParty) {
        openCompose({
          to: [
            {
              email: pendingFollowUpCommitment.otherParty.primaryEmail,
              name:
                pendingFollowUpCommitment.otherParty.displayName ?? undefined,
            },
          ],
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
      setPendingFollowUpCommitment(null);
    },
    onError: () => {
      toast.dismiss("followup-generating");
      setPendingFollowUpCommitment(null);
      toast.error("Failed to generate follow-up");
    },
  });

  // Transform and categorize
  const openLoops: OpenLoopItem[] = useMemo(() => {
    if (!loopsData?.commitments) return [];
    return loopsData.commitments
      .filter((c) => c.status !== "completed" && c.status !== "cancelled")
      .map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        status: c.status as OpenLoopItem["status"],
        priority: c.priority as OpenLoopItem["priority"],
        direction: c.direction as OpenLoopItem["direction"],
        dueDate: c.dueDate ? new Date(c.dueDate) : null,
        createdAt: new Date(c.createdAt),
        confidence: c.confidence,
        isUserVerified: c.isUserVerified ?? undefined,
        otherParty: c.direction === "owed_by_me" ? c.creditor : c.debtor,
        sourceThread: c.sourceConversation,
      }));
  }, [loopsData]);

  // Filter by tab
  const filteredLoops = useMemo(() => {
    switch (activeTab) {
      case "mine":
        return openLoops.filter((l) => l.direction === "owed_by_me");
      case "others":
        return openLoops.filter((l) => l.direction === "owed_to_me");
      default:
        return openLoops;
    }
  }, [openLoops, activeTab]);

  // Categorize by urgency
  const categorizedLoops = useMemo(() => {
    const overdue: OpenLoopItem[] = [];
    const today: OpenLoopItem[] = [];
    const thisWeek: OpenLoopItem[] = [];
    const later: OpenLoopItem[] = [];
    const noDueDate: OpenLoopItem[] = [];

    for (const loop of filteredLoops) {
      if (!loop.dueDate) {
        noDueDate.push(loop);
      } else if (isPast(loop.dueDate) && !isToday(loop.dueDate)) {
        overdue.push(loop);
      } else if (isToday(loop.dueDate)) {
        today.push(loop);
      } else if (loop.dueDate <= addDays(new Date(), 7)) {
        thisWeek.push(loop);
      } else {
        later.push(loop);
      }
    }

    // Sort each category by due date
    const sortByDue = (a: OpenLoopItem, b: OpenLoopItem) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.getTime() - b.dueDate.getTime();
    };

    return {
      overdue: overdue.sort(sortByDue),
      today: today.sort(sortByDue),
      thisWeek: thisWeek.sort(sortByDue),
      later: later.sort(sortByDue),
      noDueDate,
    };
  }, [filteredLoops]);

  // Stats
  const stats = useMemo(() => {
    const mine = openLoops.filter((l) => l.direction === "owed_by_me");
    const others = openLoops.filter((l) => l.direction === "owed_to_me");
    const overdue = openLoops.filter(
      (l) => l.dueDate && isPast(l.dueDate) && !isToday(l.dueDate)
    );
    const completionRate = loopsData?.commitments
      ? Math.round(
          (loopsData.commitments.filter((c) => c.status === "completed")
            .length /
            loopsData.commitments.length) *
            100
        )
      : 0;

    return {
      total: openLoops.length,
      mine: mine.length,
      others: others.length,
      overdue: overdue.length,
      completionRate,
    };
  }, [openLoops, loopsData]);

  // Handlers
  const handleComplete = useCallback(
    (commitmentId: string) => {
      completeMutation.mutate({ organizationId, commitmentId });
    },
    [completeMutation, organizationId]
  );

  const handleSnooze = useCallback(
    (commitmentId: string, days: number) => {
      const until = addDays(new Date(), days);
      snoozeMutation.mutate({ organizationId, commitmentId, until });
    },
    [snoozeMutation, organizationId]
  );

  const handleFollowUp = useCallback(
    (commitmentId: string, item: OpenLoopItem) => {
      // Store the commitment for use in the mutation's onSuccess
      setPendingFollowUpCommitment(item);
      // Show generating toast immediately
      toast.loading("Generating follow-up...", { id: "followup-generating" });
      followUpMutation.mutate({ organizationId, commitmentId });
    },
    [followUpMutation, organizationId]
  );

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Section renderer
  const renderSection = (
    key: string,
    title: string,
    items: OpenLoopItem[],
    icon: React.ElementType,
    color: string
  ) => {
    if (items.length === 0) return null;
    const Icon = icon;
    const isExpanded = expandedSections.has(key);

    return (
      <Collapsible
        className="space-y-2"
        key={key}
        onOpenChange={() => toggleSection(key)}
        open={isExpanded}
      >
        <CollapsibleTrigger asChild>
          <Button
            className="h-auto w-full justify-between rounded-lg px-4 py-3 hover:bg-accent"
            variant="ghost"
          >
            <div className="flex items-center gap-3">
              <div className={cn("rounded-lg p-2", color)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-left">
                <p className="font-medium">{title}</p>
                <p className="text-muted-foreground text-xs">
                  {items.length} item{items.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 pl-4">
            <AnimatePresence>
              {items.map((item) => (
                <OpenLoopItemCard
                  isLoading={completeMutation.isPending}
                  item={item}
                  key={item.id}
                  onClick={() => onCommitmentClick?.(item.id)}
                  onComplete={() => handleComplete(item.id)}
                  onFollowUp={() => handleFollowUp(item.id, item)}
                  onShowEvidence={() => onShowEvidence?.(item.id)}
                  onSnooze={(days) => handleSnooze(item.id, days)}
                  onThreadClick={() =>
                    item.sourceThread && onThreadClick?.(item.sourceThread.id)
                  }
                />
              ))}
            </AnimatePresence>
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl">My Open Loops</h1>
          <p className="mt-1 text-muted-foreground">
            Track every promise - yours and theirs
          </p>
        </div>
        <Button onClick={() => refetch()} size="icon" variant="outline">
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>
      </div>

      {/* Score Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <ScoreCard
          color="blue"
          icon={Clock}
          subtitle="Unresolved commitments"
          title="Total Open"
          value={stats.total}
        />
        <ScoreCard
          color="amber"
          icon={User}
          subtitle="My obligations"
          title="I Owe"
          value={stats.mine}
        />
        <ScoreCard
          color="purple"
          icon={Users}
          subtitle="Waiting on others"
          title="Owed to Me"
          value={stats.others}
        />
        <ScoreCard
          color={stats.overdue > 0 ? "red" : "green"}
          icon={AlertTriangle}
          subtitle={stats.overdue > 0 ? "Needs attention" : "All clear"}
          title="Overdue"
          value={stats.overdue}
        />
      </div>

      {/* Accountability Score */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <span className="font-medium text-sm">Accountability Score</span>
            </div>
            <span className="font-bold text-2xl">{stats.completionRate}%</span>
          </div>
          <Progress className="h-2" value={stats.completionRate} />
          <p className="mt-2 text-muted-foreground text-xs">
            Based on commitment completion rate
          </p>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        value={activeTab}
      >
        <TabsList className="w-full">
          <TabsTrigger className="flex-1" value="all">
            All ({openLoops.length})
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="mine">
            I Owe ({stats.mine})
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="others">
            Owed to Me ({stats.others})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Open Loops List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredLoops.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-green-500" />
            <h3 className="font-medium text-lg">All Clear!</h3>
            <p className="mt-1 text-muted-foreground">
              No open loops. You're all caught up.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="space-y-4 pr-4">
            {renderSection(
              "overdue",
              "Overdue",
              categorizedLoops.overdue,
              AlertCircle,
              "bg-red-500/10 text-red-600"
            )}
            {renderSection(
              "today",
              "Due Today",
              categorizedLoops.today,
              Clock,
              "bg-amber-500/10 text-amber-600"
            )}
            {renderSection(
              "this_week",
              "This Week",
              categorizedLoops.thisWeek,
              Calendar,
              "bg-blue-500/10 text-blue-600"
            )}
            {renderSection(
              "later",
              "Later",
              categorizedLoops.later,
              ArrowRight,
              "bg-gray-500/10 text-gray-600"
            )}
            {renderSection(
              "no_due_date",
              "No Due Date",
              categorizedLoops.noDueDate,
              Clock,
              "bg-gray-500/10 text-gray-500"
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export default OpenLoopsDashboard;
