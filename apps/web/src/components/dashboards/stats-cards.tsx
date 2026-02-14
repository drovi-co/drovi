// =============================================================================
// STATS CARDS COMPONENTS
// =============================================================================
//
// Reusable stats cards for dashboards showing key metrics at a glance.
// These are the command-center surfaces that give users instant awareness
// of their intelligence landscape.
//

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  GitBranch,
  Heart,
  MessageSquare,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  trend?: {
    value: number;
    label: string;
    isPositive?: boolean;
  };
  variant?: "default" | "primary" | "success" | "warning" | "danger";
  className?: string;
}

interface StatsGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

// =============================================================================
// STAT CARD
// =============================================================================

export function StatCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  variant = "default",
  className,
}: StatCardProps) {
  const variantStyles = {
    default: "bg-card",
    primary: "bg-primary/5 border-primary/20",
    success:
      "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800",
    warning:
      "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800",
    danger: "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800",
  };

  const iconStyles = {
    default: "text-muted-foreground",
    primary: "text-primary",
    success: "text-green-600 dark:text-green-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
  };

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={cn(variantStyles[variant], className)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="font-medium text-muted-foreground text-sm">
            {title}
          </CardTitle>
          <Icon className={cn("h-4 w-4", iconStyles[variant])} />
        </CardHeader>
        <CardContent>
          <div className="font-bold text-2xl">{value}</div>
          {description && (
            <p className="mt-1 text-muted-foreground text-xs">{description}</p>
          )}
          {trend && (
            <div className="mt-2 flex items-center gap-1">
              {trend.isPositive ? (
                <ArrowUp className="h-3 w-3 text-green-600" />
              ) : (
                <ArrowDown className="h-3 w-3 text-red-600" />
              )}
              <span
                className={cn(
                  "font-medium text-xs",
                  trend.isPositive ? "text-green-600" : "text-red-600"
                )}
              >
                {trend.value}%
              </span>
              <span className="text-muted-foreground text-xs">
                {trend.label}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// =============================================================================
// STATS GRID
// =============================================================================

export function StatsGrid({
  children,
  columns = 4,
  className,
}: StatsGridProps) {
  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-4", gridCols[columns], className)}>
      {children}
    </div>
  );
}

// =============================================================================
// COMMITMENT STATS
// =============================================================================

interface CommitmentStatsProps {
  stats: {
    total: number;
    overdue: number;
    dueThisWeek: number;
    owedByMe: number;
    owedToMe: number;
    completedThisMonth: number;
  };
}

export function CommitmentStats({ stats }: CommitmentStatsProps) {
  return (
    <StatsGrid>
      <StatCard
        description="Open commitments"
        icon={MessageSquare}
        title="Total Active"
        value={stats.total}
      />
      <StatCard
        description="Need immediate attention"
        icon={AlertCircle}
        title="Overdue"
        value={stats.overdue}
        variant={stats.overdue > 0 ? "danger" : "default"}
      />
      <StatCard
        description="Coming up soon"
        icon={Calendar}
        title="Due This Week"
        value={stats.dueThisWeek}
        variant={stats.dueThisWeek > 5 ? "warning" : "default"}
      />
      <StatCard
        description="This month"
        icon={Check}
        title="Completed"
        value={stats.completedThisMonth}
        variant="success"
      />
    </StatsGrid>
  );
}

// =============================================================================
// DECISION STATS
// =============================================================================

interface DecisionStatsProps {
  stats: {
    total: number;
    thisWeek: number;
    thisMonth: number;
    superseded: number;
    avgConfidence: number;
    verifiedCount: number;
  };
}

export function DecisionStats({ stats }: DecisionStatsProps) {
  return (
    <StatsGrid>
      <StatCard
        description="In decision log"
        icon={GitBranch}
        title="Total Decisions"
        value={stats.total}
      />
      <StatCard
        description="New decisions"
        icon={Calendar}
        title="This Week"
        value={stats.thisWeek}
      />
      <StatCard
        description="User confirmed"
        icon={Check}
        title="Verified"
        value={stats.verifiedCount}
        variant="success"
      />
      <StatCard
        description="AI extraction confidence"
        icon={TrendingUp}
        title="Avg. Confidence"
        value={`${Math.round(stats.avgConfidence * 100)}%`}
        variant={
          stats.avgConfidence >= 0.7
            ? "success"
            : stats.avgConfidence >= 0.5
              ? "warning"
              : "danger"
        }
      />
    </StatsGrid>
  );
}

// =============================================================================
// CONTACT STATS
// =============================================================================

interface ContactStatsProps {
  stats: {
    total: number;
    vipCount: number;
    atRiskCount: number;
    recentlyActiveCount: number;
    needsAttentionCount: number;
    avgHealthScore: number;
  };
}

export function ContactStats({ stats }: ContactStatsProps) {
  return (
    <StatsGrid>
      <StatCard
        description="In your network"
        icon={Users}
        title="Total Contacts"
        value={stats.total}
      />
      <StatCard
        description="High priority"
        icon={Star}
        title="VIP Contacts"
        value={stats.vipCount}
        variant="primary"
      />
      <StatCard
        description="Need attention"
        icon={TrendingDown}
        title="At Risk"
        value={stats.atRiskCount}
        variant={stats.atRiskCount > 0 ? "danger" : "default"}
      />
      <StatCard
        description="Relationship health"
        icon={Heart}
        title="Avg. Health"
        value={`${Math.round(stats.avgHealthScore * 100)}%`}
        variant={
          stats.avgHealthScore >= 0.7
            ? "success"
            : stats.avgHealthScore >= 0.5
              ? "warning"
              : "danger"
        }
      />
    </StatsGrid>
  );
}
