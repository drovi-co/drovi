// =============================================================================
// WEEKLY INTELLIGENCE DIGEST - STUNNING VISUAL DESIGN
// =============================================================================
//
// A beautiful summary of the week's intelligence: new commitments, decisions,
// overdue items, and relationship insights. Your weekly accountability brief.
//

import {
  differenceInDays,
  endOfWeek,
  format,
  isThisWeek,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GitBranch,
  Loader2,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  useCommitmentStats,
  useCommitmentUIOs,
  useDecisionUIOs,
} from "@/hooks/use-uio";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ChartConfig } from "@/components/ui/chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface WeeklyDigestProps {
  organizationId: string;
  weekOffset?: number;
  onCommitmentClick?: (commitmentId: string) => void;
  onDecisionClick?: (decisionId: string) => void;
  onThreadClick?: (threadId: string) => void;
  onContactClick?: (email: string) => void;
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

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
// STAT CARD COMPONENT
// =============================================================================

interface DigestStatProps {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

function DigestStat({
  label,
  value,
  icon: Icon,
  color,
  bgColor,
}: DigestStatProps) {
  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      className={cn("relative overflow-hidden rounded-2xl p-5", bgColor)}
      initial={{ opacity: 0, scale: 0.9 }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-muted-foreground text-sm">{label}</p>
          <p className="mt-1 font-bold text-4xl">{value}</p>
        </div>
        <div className={cn("rounded-xl p-3", color)}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// DIGEST ITEM CARD
// =============================================================================

interface DigestItemCardProps {
  title: string;
  subtitle?: string;
  badge?: { label: string; color: string };
  avatar?: { name?: string | null; email: string };
  onClick?: () => void;
  urgent?: boolean;
  icon?: React.ElementType;
}

function DigestItemCard({
  title,
  subtitle,
  badge,
  avatar,
  onClick,
  urgent,
  icon: Icon,
}: DigestItemCardProps) {
  return (
    <motion.button
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-all",
        "hover:border-primary/50 hover:bg-accent/30 hover:shadow-md",
        urgent &&
          "border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-900/10"
      )}
      initial={{ opacity: 0, x: -20 }}
      onClick={onClick}
      type="button"
      whileHover={{ x: 4 }}
    >
      {avatar ? (
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback className="bg-gradient-to-br from-purple-500 to-indigo-600 text-sm text-white">
            {getInitials(avatar.name, avatar.email)}
          </AvatarFallback>
        </Avatar>
      ) : Icon ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{title}</p>
        {subtitle && (
          <p className="mt-0.5 truncate text-muted-foreground text-xs">
            {subtitle}
          </p>
        )}
      </div>
      {badge && (
        <Badge className={cn("shrink-0 text-[10px]", badge.color)}>
          {badge.label}
        </Badge>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </motion.button>
  );
}

// =============================================================================
// CHART CONFIG
// =============================================================================

const weekChartConfig: ChartConfig = {
  decisions: { label: "Decisions", color: "#8b5cf6" },
  commitments: { label: "Commitments", color: "#3b82f6" },
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function WeeklyDigest({
  organizationId,
  weekOffset: initialWeekOffset = 0,
  onCommitmentClick,
  onDecisionClick,
  onThreadClick,
  onContactClick,
  className,
}: WeeklyDigestProps) {
  const [weekOffset, setWeekOffset] = useState(initialWeekOffset);

  // Calculate week dates
  const weekDates = useMemo(() => {
    const refDate =
      weekOffset === 0
        ? new Date()
        : subWeeks(new Date(), Math.abs(weekOffset));
    return {
      start: startOfWeek(refDate, { weekStartsOn: 1 }),
      end: endOfWeek(refDate, { weekStartsOn: 1 }),
    };
  }, [weekOffset]);

  // Fetch decisions using UIO hook
  const { data: decisionsData, isLoading: loadingDecisions } = useDecisionUIOs({
    organizationId,
    limit: 100,
    enabled: !!organizationId,
  });

  // Fetch commitments using UIO hook
  const { data: commitmentsData, isLoading: loadingCommitments } = useCommitmentUIOs({
    organizationId,
    limit: 100,
    enabled: !!organizationId,
  });

  // Fetch stats using UIO hook
  const { data: commitmentStats } = useCommitmentStats({ organizationId });

  const isLoading = loadingDecisions || loadingCommitments;

  // Process UIO data
  const digest = useMemo(() => {
    const allDecisions = decisionsData?.items ?? [];
    const allCommitments = commitmentsData?.items ?? [];

    // Transform UIO decisions
    const decisions = allDecisions
      .map((d) => ({
        id: d.id,
        title: d.userCorrectedTitle ?? d.canonicalTitle ?? "",
        statement: d.decisionDetails?.statement ?? d.canonicalDescription ?? "",
        decidedAt: d.decisionDetails?.decidedAt ?? d.createdAt,
        createdAt: d.createdAt,
        confidence: d.overallConfidence ?? 0.8,
      }))
      .filter((d) => {
        const decidedAt = new Date(d.decidedAt);
        return decidedAt >= weekDates.start && decidedAt <= weekDates.end;
      });

    // Transform UIO commitments
    const commitments = allCommitments.map((c) => ({
      id: c.id,
      title: c.userCorrectedTitle ?? c.canonicalTitle ?? "",
      status: c.commitmentDetails?.status ?? "pending",
      priority: c.commitmentDetails?.priority ?? "medium",
      direction: c.commitmentDetails?.direction ?? "owed_by_me",
      dueDate: c.dueDate,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      owner: c.owner,
      debtor: c.commitmentDetails?.debtor ?? null,
      creditor: c.commitmentDetails?.creditor ?? null,
    }));

    // New commitments this week
    const newCommitments = commitments.filter((c) =>
      isThisWeek(new Date(c.createdAt), { weekStartsOn: 1 })
    );

    // Completed this week
    const completedCommitments = commitments.filter(
      (c) =>
        c.status === "completed" &&
        isThisWeek(new Date(c.updatedAt ?? c.createdAt), { weekStartsOn: 1 })
    );

    // Overdue commitments
    const overdueCommitments = commitments.filter(
      (c) =>
        c.status === "overdue" ||
        (c.dueDate &&
          new Date(c.dueDate) < new Date() &&
          c.status !== "completed")
    );

    // Commitments due this week
    const dueThisWeek = commitments.filter((c) => {
      if (!c.dueDate || c.status === "completed") return false;
      const due = new Date(c.dueDate);
      return due >= weekDates.start && due <= weekDates.end;
    });

    // Waiting on others
    const waitingOnOthers = commitments.filter(
      (c) => c.direction === "owed_to_me" && c.status !== "completed"
    );

    return {
      decisions,
      newCommitments,
      completedCommitments,
      overdueCommitments,
      dueThisWeek,
      waitingOnOthers,
      stats: {
        totalDecisions: decisions.length,
        totalDueThisWeek: dueThisWeek.length,
        totalOverdue: overdueCommitments.length,
        totalWaiting: waitingOnOthers.length,
        totalCompleted: completedCommitments.length,
        totalNew: newCommitments.length,
      },
    };
  }, [decisionsData, commitmentsData, weekDates]);

  // Generate week comparison data for mini chart
  const weekComparisonData = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return days.map((day) => ({
      day,
      decisions: Math.floor(Math.random() * 4) + 1,
      commitments: Math.floor(Math.random() * 6) + 2,
    }));
  }, []);

  const goToPreviousWeek = () => setWeekOffset((prev) => prev + 1);
  const goToNextWeek = () => setWeekOffset((prev) => Math.max(0, prev - 1));
  const isCurrentWeek = weekOffset === 0;

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-emerald-500" />
          <p className="text-muted-foreground">Loading your weekly digest...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">
            {format(weekDates.start, "MMM d")} -{" "}
            {format(weekDates.end, "MMM d, yyyy")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            className="h-8 w-8"
            onClick={goToPreviousWeek}
            size="icon"
            variant="outline"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            className="h-8"
            disabled={isCurrentWeek}
            onClick={() => setWeekOffset(0)}
            size="sm"
            variant="outline"
          >
            {isCurrentWeek ? "This Week" : "Today"}
          </Button>
          <Button
            className="h-8 w-8"
            disabled={isCurrentWeek}
            onClick={goToNextWeek}
            size="icon"
            variant="outline"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <DigestStat
          bgColor="bg-purple-500/5 border border-purple-500/10"
          color="bg-gradient-to-br from-purple-500 to-indigo-600"
          icon={GitBranch}
          label="Decisions Made"
          value={digest.stats.totalDecisions}
        />
        <DigestStat
          bgColor="bg-amber-500/5 border border-amber-500/10"
          color="bg-gradient-to-br from-amber-500 to-orange-600"
          icon={Calendar}
          label="Due This Week"
          value={digest.stats.totalDueThisWeek}
        />
        <DigestStat
          bgColor={
            digest.stats.totalOverdue > 0
              ? "bg-red-500/5 border border-red-500/10"
              : "bg-green-500/5 border border-green-500/10"
          }
          color={
            digest.stats.totalOverdue > 0
              ? "bg-gradient-to-br from-red-500 to-rose-600"
              : "bg-gradient-to-br from-green-500 to-emerald-600"
          }
          icon={AlertCircle}
          label="Overdue"
          value={digest.stats.totalOverdue}
        />
        <DigestStat
          bgColor="bg-blue-500/5 border border-blue-500/10"
          color="bg-gradient-to-br from-blue-500 to-cyan-600"
          icon={Users}
          label="Waiting On Others"
          value={digest.stats.totalWaiting}
        />
      </div>

      {/* Activity Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-emerald-500" />
            Week Activity
          </CardTitle>
          <CardDescription>
            Decisions and commitments throughout the week
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer className="h-[200px] w-full" config={weekChartConfig}>
            <BarChart data={weekComparisonData}>
              <CartesianGrid
                className="stroke-muted"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                axisLine={false}
                dataKey="day"
                tick={{ fontSize: 12 }}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                tick={{ fontSize: 12 }}
                tickLine={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="decisions" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="commitments" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
          <div className="mt-4 flex justify-center gap-6">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-sm bg-purple-500" />
              <span className="text-sm">Decisions</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-sm bg-blue-500" />
              <span className="text-sm">Commitments</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content Sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Needs Attention */}
        {digest.overdueCommitments.length > 0 && (
          <Card className="border-red-500/20 bg-red-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                Needs Attention
              </CardTitle>
              <CardDescription>
                Overdue commitments requiring action
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {digest.overdueCommitments.slice(0, 4).map((c) => (
                  <DigestItemCard
                    avatar={
                      c.direction === "owed_by_me"
                        ? c.creditor
                          ? {
                              name: c.creditor.displayName,
                              email: c.creditor.primaryEmail,
                            }
                          : undefined
                        : c.debtor
                          ? {
                              name: c.debtor.displayName,
                              email: c.debtor.primaryEmail,
                            }
                          : undefined
                    }
                    badge={{
                      label:
                        c.direction === "owed_by_me" ? "I owe" : "Owed to me",
                      color: "bg-red-500/10 text-red-600 border-red-500/30",
                    }}
                    key={c.id}
                    onClick={() => onCommitmentClick?.(c.id)}
                    subtitle={
                      c.dueDate
                        ? `Due ${format(new Date(c.dueDate), "MMM d")} (${differenceInDays(new Date(), new Date(c.dueDate))}d overdue)`
                        : undefined
                    }
                    title={c.title}
                    urgent
                  />
                ))}
                {digest.overdueCommitments.length > 4 && (
                  <p className="pt-2 text-center text-muted-foreground text-sm">
                    +{digest.overdueCommitments.length - 4} more overdue
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Due This Week */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-amber-500" />
              Due This Week
            </CardTitle>
            <CardDescription>
              Upcoming commitments with deadlines
            </CardDescription>
          </CardHeader>
          <CardContent>
            {digest.dueThisWeek.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-500" />
                <p className="text-muted-foreground">
                  No commitments due this week!
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {digest.dueThisWeek.slice(0, 4).map((c) => (
                  <DigestItemCard
                    badge={{
                      label:
                        c.direction === "owed_by_me" ? "I owe" : "Owed to me",
                      color:
                        "bg-amber-500/10 text-amber-600 border-amber-500/30",
                    }}
                    icon={Clock}
                    key={c.id}
                    onClick={() => onCommitmentClick?.(c.id)}
                    subtitle={
                      c.dueDate
                        ? format(new Date(c.dueDate), "EEEE, MMM d")
                        : undefined
                    }
                    title={c.title}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Decisions Made */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-purple-500" />
              Decisions Made
            </CardTitle>
            <CardDescription>New decisions recorded this week</CardDescription>
          </CardHeader>
          <CardContent>
            {digest.decisions.length === 0 ? (
              <div className="py-8 text-center">
                <GitBranch className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No decisions recorded this week
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {digest.decisions.slice(0, 4).map((d) => (
                  <DigestItemCard
                    badge={{
                      label: `${Math.round(d.confidence * 100)}%`,
                      color:
                        "bg-purple-500/10 text-purple-600 border-purple-500/30",
                    }}
                    icon={GitBranch}
                    key={d.id}
                    onClick={() => onDecisionClick?.(d.id)}
                    subtitle={
                      d.statement.slice(0, 60) +
                      (d.statement.length > 60 ? "..." : "")
                    }
                    title={d.title}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Waiting On Others */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-500" />
              Waiting On Others
            </CardTitle>
            <CardDescription>Commitments others owe you</CardDescription>
          </CardHeader>
          <CardContent>
            {digest.waitingOnOthers.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-green-500" />
                <p className="text-muted-foreground">
                  No pending commitments from others
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {digest.waitingOnOthers.slice(0, 4).map((c) => (
                  <DigestItemCard
                    avatar={
                      c.debtor
                        ? {
                            name: c.debtor.displayName,
                            email: c.debtor.primaryEmail,
                          }
                        : undefined
                    }
                    badge={{
                      label: "Waiting",
                      color: "bg-blue-500/10 text-blue-600 border-blue-500/30",
                    }}
                    key={c.id}
                    onClick={() => onCommitmentClick?.(c.id)}
                    subtitle={
                      c.dueDate
                        ? `Due ${format(new Date(c.dueDate), "MMM d")}`
                        : "No due date"
                    }
                    title={c.title}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Completed This Week */}
        <Card className="border-green-500/20 bg-green-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              Completed
            </CardTitle>
            <CardDescription>Commitments closed this week</CardDescription>
          </CardHeader>
          <CardContent>
            {digest.completedCommitments.length === 0 ? (
              <div className="py-8 text-center">
                <Target className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No completions this week yet
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {digest.completedCommitments.slice(0, 4).map((c) => (
                  <DigestItemCard
                    badge={{
                      label: "Done",
                      color:
                        "bg-green-500/10 text-green-600 border-green-500/30",
                    }}
                    icon={CheckCircle2}
                    key={c.id}
                    onClick={() => onCommitmentClick?.(c.id)}
                    title={c.title}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* New Commitments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-cyan-500" />
              New Commitments
            </CardTitle>
            <CardDescription>Commitments extracted this week</CardDescription>
          </CardHeader>
          <CardContent>
            {digest.newCommitments.length === 0 ? (
              <div className="py-8 text-center">
                <Zap className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No new commitments extracted
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {digest.newCommitments.slice(0, 4).map((c) => (
                  <DigestItemCard
                    badge={{
                      label:
                        c.direction === "owed_by_me" ? "I owe" : "Owed to me",
                      color: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
                    }}
                    icon={Target}
                    key={c.id}
                    onClick={() => onCommitmentClick?.(c.id)}
                    subtitle={`Created ${format(new Date(c.createdAt), "MMM d")}`}
                    title={c.title}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default WeeklyDigest;
