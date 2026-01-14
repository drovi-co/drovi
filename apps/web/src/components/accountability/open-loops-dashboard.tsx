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

import { useQuery, useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNow, isPast, isToday, isTomorrow, addDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  Loader2,
  Mail,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

function getUrgencyLevel(item: OpenLoopItem): "critical" | "high" | "medium" | "low" {
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

function ScoreCard({ title, value, subtitle, icon: Icon, trend, color }: ScoreCardProps) {
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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          <div className={cn("p-2 rounded-lg", colorClasses[color])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend && (
          <div className="flex items-center gap-1 mt-2 text-xs">
            <TrendingUp className={cn(
              "h-3 w-3",
              trend.value >= 0 ? "text-green-500" : "text-red-500"
            )} />
            <span className={trend.value >= 0 ? "text-green-600" : "text-red-600"}>
              {trend.value > 0 ? "+" : ""}{trend.value}%
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
  const isOverdue = item.status === "overdue" || (item.dueDate && isPast(item.dueDate));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "group relative flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors",
        "border-b border-border/40 hover:bg-accent/50"
      )}
      onClick={onClick}
    >
      {/* Urgency Indicator */}
      {urgency === "critical" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
      )}
      {urgency === "high" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
      )}
      {urgency === "medium" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" />
      )}

      {/* Avatar */}
      {item.otherParty ? (
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="text-xs bg-muted font-medium">
            {getInitials(item.otherParty.displayName, item.otherParty.primaryEmail)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="h-9 w-9 shrink-0 rounded-full bg-muted flex items-center justify-center">
          <User className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      {/* Direction badge */}
      <span className={cn(
        "text-xs font-medium px-1.5 py-0.5 rounded shrink-0",
        item.direction === "owed_by_me"
          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
          : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
      )}>
        {item.direction === "owed_by_me" ? "I owe" : "Owed to me"}
      </span>

      {/* Other Person */}
      {item.otherParty && (
        <span className="w-32 shrink-0 truncate text-sm font-medium text-foreground/80">
          {item.otherParty.displayName ?? item.otherParty.primaryEmail}
        </span>
      )}

      {/* Title */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="text-sm truncate text-muted-foreground">{item.title}</span>
      </div>

      {/* Due Date */}
      {item.dueDate && (
        <span className={cn(
          "text-xs shrink-0",
          isOverdue && "text-red-600 dark:text-red-400 font-medium",
          urgency === "high" && !isOverdue && "text-amber-600 dark:text-amber-400",
          urgency === "medium" && "text-blue-600 dark:text-blue-400",
          urgency === "low" && "text-muted-foreground"
        )}>
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
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <ConfidenceBadge
          confidence={item.confidence}
          isUserVerified={item.isUserVerified}
          size="sm"
          showDetails={false}
        />

        {onShowEvidence && (
          <button
            type="button"
            onClick={onShowEvidence}
            className="p-1.5 rounded-md hover:bg-background transition-colors"
            title="Show evidence"
          >
            <Eye className="h-4 w-4 text-purple-500" />
          </button>
        )}

        {onComplete && (
          <button
            type="button"
            onClick={onComplete}
            disabled={isLoading}
            className="p-1.5 rounded-md hover:bg-background transition-colors"
            title="Mark complete"
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
              type="button"
              className="p-1.5 rounded-md hover:bg-background transition-colors"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onShowEvidence && (
              <DropdownMenuItem onClick={onShowEvidence}>
                <Eye className="h-4 w-4 mr-2" />
                Show Evidence
              </DropdownMenuItem>
            )}
            {item.sourceThread && onThreadClick && (
              <DropdownMenuItem onClick={onThreadClick}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Source Thread
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {onComplete && (
              <DropdownMenuItem onClick={onComplete}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark Complete
              </DropdownMenuItem>
            )}
            {onSnooze && (
              <>
                <DropdownMenuItem onClick={() => onSnooze(1)}>
                  <Clock className="h-4 w-4 mr-2" />
                  Snooze 1 day
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSnooze(3)}>
                  <Pause className="h-4 w-4 mr-2" />
                  Snooze 3 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSnooze(7)}>
                  <Pause className="h-4 w-4 mr-2" />
                  Snooze 1 week
                </DropdownMenuItem>
              </>
            )}
            {item.direction === "owed_to_me" && isOverdue && onFollowUp && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onFollowUp}>
                  <Send className="h-4 w-4 mr-2" />
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
  const [pendingFollowUpCommitment, setPendingFollowUpCommitment] = useState<OpenLoopItem | null>(null);

  // Fetch open loops (commitments that are not completed)
  const { data: loopsData, isLoading, refetch } = useQuery(
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
          to: [{
            email: pendingFollowUpCommitment.otherParty.primaryEmail,
            name: pendingFollowUpCommitment.otherParty.displayName ?? undefined,
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
        sourceThread: c.sourceThread,
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
          (loopsData.commitments.filter((c) => c.status === "completed").length /
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
        key={key}
        open={isExpanded}
        onOpenChange={() => toggleSection(key)}
        className="space-y-2"
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between h-auto py-3 px-4 rounded-lg hover:bg-accent"
          >
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", color)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-left">
                <p className="font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">
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
                  key={item.id}
                  item={item}
                  onClick={() => onCommitmentClick?.(item.id)}
                  onComplete={() => handleComplete(item.id)}
                  onSnooze={(days) => handleSnooze(item.id, days)}
                  onFollowUp={() => handleFollowUp(item.id, item)}
                  onShowEvidence={() => onShowEvidence?.(item.id)}
                  onThreadClick={() =>
                    item.sourceThread && onThreadClick?.(item.sourceThread.id)
                  }
                  isLoading={completeMutation.isPending}
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
          <h1 className="text-2xl font-bold">My Open Loops</h1>
          <p className="text-muted-foreground mt-1">
            Track every promise - yours and theirs
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()}>
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
        </Button>
      </div>

      {/* Score Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <ScoreCard
          title="Total Open"
          value={stats.total}
          subtitle="Unresolved commitments"
          icon={Clock}
          color="blue"
        />
        <ScoreCard
          title="I Owe"
          value={stats.mine}
          subtitle="My obligations"
          icon={User}
          color="amber"
        />
        <ScoreCard
          title="Owed to Me"
          value={stats.others}
          subtitle="Waiting on others"
          icon={Users}
          color="purple"
        />
        <ScoreCard
          title="Overdue"
          value={stats.overdue}
          subtitle={stats.overdue > 0 ? "Needs attention" : "All clear"}
          icon={AlertTriangle}
          color={stats.overdue > 0 ? "red" : "green"}
        />
      </div>

      {/* Accountability Score */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <span className="font-medium text-sm">Accountability Score</span>
            </div>
            <span className="text-2xl font-bold">{stats.completionRate}%</span>
          </div>
          <Progress value={stats.completionRate} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">
            Based on commitment completion rate
          </p>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">
            All ({openLoops.length})
          </TabsTrigger>
          <TabsTrigger value="mine" className="flex-1">
            I Owe ({stats.mine})
          </TabsTrigger>
          <TabsTrigger value="others" className="flex-1">
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
            <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
            <h3 className="font-medium text-lg">All Clear!</h3>
            <p className="text-muted-foreground mt-1">
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
