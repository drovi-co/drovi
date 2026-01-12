// =============================================================================
// STATS CARDS COMPONENTS
// =============================================================================
//
// Reusable stats cards for dashboards showing key metrics at a glance.
// These are the command-center surfaces that give users instant awareness
// of their intelligence landscape.
//

import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Check,
  Clock,
  GitBranch,
  Heart,
  MessageSquare,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    success: "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800",
    warning: "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800",
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={cn(variantStyles[variant], className)}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <Icon className={cn("h-4 w-4", iconStyles[variant])} />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{value}</div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
          {trend && (
            <div className="flex items-center gap-1 mt-2">
              {trend.isPositive ? (
                <ArrowUp className="h-3 w-3 text-green-600" />
              ) : (
                <ArrowDown className="h-3 w-3 text-red-600" />
              )}
              <span
                className={cn(
                  "text-xs font-medium",
                  trend.isPositive ? "text-green-600" : "text-red-600"
                )}
              >
                {trend.value}%
              </span>
              <span className="text-xs text-muted-foreground">{trend.label}</span>
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

export function StatsGrid({ children, columns = 4, className }: StatsGridProps) {
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
        title="Total Active"
        value={stats.total}
        icon={MessageSquare}
        description="Open commitments"
      />
      <StatCard
        title="Overdue"
        value={stats.overdue}
        icon={AlertCircle}
        variant={stats.overdue > 0 ? "danger" : "default"}
        description="Need immediate attention"
      />
      <StatCard
        title="Due This Week"
        value={stats.dueThisWeek}
        icon={Calendar}
        variant={stats.dueThisWeek > 5 ? "warning" : "default"}
        description="Coming up soon"
      />
      <StatCard
        title="Completed"
        value={stats.completedThisMonth}
        icon={Check}
        variant="success"
        description="This month"
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
        title="Total Decisions"
        value={stats.total}
        icon={GitBranch}
        description="In decision log"
      />
      <StatCard
        title="This Week"
        value={stats.thisWeek}
        icon={Calendar}
        description="New decisions"
      />
      <StatCard
        title="Verified"
        value={stats.verifiedCount}
        icon={Check}
        variant="success"
        description="User confirmed"
      />
      <StatCard
        title="Avg. Confidence"
        value={`${Math.round(stats.avgConfidence * 100)}%`}
        icon={TrendingUp}
        variant={stats.avgConfidence >= 0.7 ? "success" : stats.avgConfidence >= 0.5 ? "warning" : "danger"}
        description="AI extraction confidence"
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
        title="Total Contacts"
        value={stats.total}
        icon={Users}
        description="In your network"
      />
      <StatCard
        title="VIP Contacts"
        value={stats.vipCount}
        icon={Star}
        variant="primary"
        description="High priority"
      />
      <StatCard
        title="At Risk"
        value={stats.atRiskCount}
        icon={TrendingDown}
        variant={stats.atRiskCount > 0 ? "danger" : "default"}
        description="Need attention"
      />
      <StatCard
        title="Avg. Health"
        value={`${Math.round(stats.avgHealthScore * 100)}%`}
        icon={Heart}
        variant={stats.avgHealthScore >= 0.7 ? "success" : stats.avgHealthScore >= 0.5 ? "warning" : "danger"}
        description="Relationship health"
      />
    </StatsGrid>
  );
}
