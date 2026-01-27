// =============================================================================
// CONTACT INTELLIGENCE DASHBOARD
// =============================================================================
//
// Comprehensive view of contact relationship intelligence including:
// - Health scores and trends
// - Engagement metrics
// - Open loops and commitments
// - Alerts and risk indicators
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  Bell,
  BellOff,
  Brain,
  CheckCircle2,
  Heart,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface ContactIntelligenceDashboardProps {
  contactId: string;
  organizationId: string;
  onRefresh?: () => void;
  className?: string;
}

// =============================================================================
// SCORE RING COMPONENT
// =============================================================================

interface ScoreRingProps {
  score: number | null | undefined;
  label: string;
  icon: React.ElementType;
  color: string;
  description?: string;
}

function ScoreRing({
  score,
  label,
  icon: Icon,
  color,
  description,
}: ScoreRingProps) {
  const normalizedScore =
    score !== null && score !== undefined ? Math.round(score * 100) : 0;
  const data = [{ name: label, value: normalizedScore, fill: color }];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-20 w-20">
        <ResponsiveContainer height="100%" width="100%">
          <RadialBarChart
            barSize={8}
            cx="50%"
            cy="50%"
            data={data}
            endAngle={-270}
            innerRadius="65%"
            outerRadius="100%"
            startAngle={90}
          >
            <RadialBar
              background={{ fill: "hsl(var(--muted))" }}
              cornerRadius={6}
              dataKey="value"
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className="font-bold text-lg"
            initial={{ opacity: 0, scale: 0.5 }}
            transition={{ delay: 0.2 }}
          >
            {normalizedScore}
          </motion.span>
        </div>
      </div>
      <div className="text-center">
        <p className="font-medium text-sm">{label}</p>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// TREND INDICATOR
// =============================================================================

function TrendIndicator({ trend, change }: { trend: string; change: number }) {
  const isPositive = trend === "improving";
  const isNegative = trend === "declining";

  if (trend === "stable") {
    return (
      <span className="flex items-center gap-1 text-muted-foreground text-xs">
        <span className="h-2 w-2 rounded-full bg-gray-400" />
        Stable
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs",
        isPositive && "text-green-600",
        isNegative && "text-red-600"
      )}
    >
      {isPositive ? (
        <TrendingUp className="h-3 w-3" />
      ) : (
        <TrendingDown className="h-3 w-3" />
      )}
      {Math.abs(change)}%
    </span>
  );
}

// =============================================================================
// ALERT ITEM COMPONENT
// =============================================================================

interface AlertItemProps {
  alert: {
    id: string;
    alertType: string;
    severity: string;
    message: string;
    createdAt: Date | string;
  };
  onAcknowledge?: (id: string) => void;
  onDismiss?: (id: string) => void;
}

function AlertItem({ alert, onAcknowledge, onDismiss }: AlertItemProps) {
  const severityColors = {
    critical: "bg-red-500/10 border-red-500/30 text-red-600",
    high: "bg-orange-500/10 border-orange-500/30 text-orange-600",
    medium: "bg-amber-500/10 border-amber-500/30 text-amber-600",
    low: "bg-blue-500/10 border-blue-500/30 text-blue-600",
  };

  const severityIcons = {
    critical: AlertCircle,
    high: Bell,
    medium: Bell,
    low: Bell,
  };

  const SeverityIcon =
    severityIcons[alert.severity as keyof typeof severityIcons] ?? Bell;
  const colorClass =
    severityColors[alert.severity as keyof typeof severityColors] ??
    severityColors.medium;

  return (
    <motion.div
      animate={{ opacity: 1, x: 0 }}
      className={cn("rounded-lg border p-3", colorClass)}
      initial={{ opacity: 0, x: -10 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <SeverityIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium text-sm">{alert.message}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {formatDistanceToNow(new Date(alert.createdAt), {
                addSuffix: true,
              })}
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="h-6 w-6" size="icon" variant="ghost">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onAcknowledge?.(alert.id)}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Acknowledge
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDismiss?.(alert.id)}>
              <BellOff className="mr-2 h-4 w-4" />
              Dismiss
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ContactIntelligenceDashboard({
  contactId,
  organizationId,
  onRefresh,
  className,
}: ContactIntelligenceDashboardProps) {
  const trpc = useTRPC();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch contact intelligence
  const {
    data: intelligence,
    isLoading,
    refetch: refetchIntelligence,
  } = useQuery(
    trpc.contactIntelligence.getLatest.queryOptions({
      organizationId,
      contactId,
    })
  );

  // Fetch trends
  const { data: healthTrend } = useQuery(
    trpc.contactIntelligence.getTrends.queryOptions({
      organizationId,
      contactId,
      metric: "health_score",
      days: 30,
    })
  );

  const { data: engagementTrend } = useQuery(
    trpc.contactIntelligence.getTrends.queryOptions({
      organizationId,
      contactId,
      metric: "engagement_score",
      days: 30,
    })
  );

  // Fetch alerts for this contact
  const { data: alertsData, refetch: refetchAlerts } = useQuery(
    trpc.contactIntelligence.listAlerts.queryOptions({
      organizationId,
      contactId,
      status: ["active"],
      limit: 5,
    })
  );

  // Mutations
  const acknowledgeMutation = useMutation(
    trpc.contactIntelligence.acknowledgeAlert.mutationOptions({
      onSuccess: () => refetchAlerts(),
    })
  );

  const dismissMutation = useMutation(
    trpc.contactIntelligence.dismissAlert.mutationOptions({
      onSuccess: () => refetchAlerts(),
    })
  );

  const analyzeMutation = useMutation(
    trpc.contactIntelligence.analyze.mutationOptions({
      onSuccess: () => {
        refetchIntelligence();
        onRefresh?.();
      },
    })
  );

  // Prepare trend chart data
  const trendChartData = useMemo(() => {
    if (!healthTrend?.dataPoints) {
      return [];
    }
    return healthTrend.dataPoints.map((point) => ({
      date: format(new Date(point.timestamp), "MMM d"),
      health: Math.round(point.value * 100),
    }));
  }, [healthTrend]);

  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await analyzeMutation.mutateAsync({
        organizationId,
        contactId,
        forceRefresh: true,
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="grid grid-cols-4 gap-4">
          {[...new Array(4)].map((_, i) => (
            <Skeleton className="h-32 w-full" key={i} />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!intelligence) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-12">
          <Brain className="h-12 w-12 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium">No Intelligence Data</p>
            <p className="text-muted-foreground text-sm">
              Run analysis to generate insights for this contact
            </p>
          </div>
          <Button disabled={isRefreshing} onClick={handleRefresh}>
            {isRefreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Analyze Contact
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { contact, scores, lifecycle, graph, flags, snapshot } = intelligence;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarImage src={contact.avatarUrl ?? undefined} />
            <AvatarFallback className="text-lg">
              {contact.displayName?.slice(0, 2).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-xl">{contact.displayName}</h2>
              {flags.isVip && (
                <Star className="h-5 w-5 fill-amber-500 text-amber-500" />
              )}
              {flags.isAtRisk && (
                <Badge className="text-xs" variant="destructive">
                  At Risk
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {contact.title && contact.company
                ? `${contact.title} at ${contact.company}`
                : (contact.company ?? contact.primaryEmail)}
            </p>
          </div>
        </div>
        <Button
          disabled={isRefreshing}
          onClick={handleRefresh}
          size="sm"
          variant="outline"
        >
          {isRefreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Score Rings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-purple-500" />
            Relationship Health
          </CardTitle>
          <CardDescription>
            AI-computed relationship metrics and trends
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-around gap-6">
            <div className="flex flex-col items-center gap-2">
              <ScoreRing
                color="#22c55e"
                icon={Heart}
                label="Health"
                score={scores.healthScore}
              />
              {healthTrend && (
                <TrendIndicator
                  change={healthTrend.changePercent}
                  trend={healthTrend.trend}
                />
              )}
            </div>
            <div className="flex flex-col items-center gap-2">
              <ScoreRing
                color="#3b82f6"
                icon={Activity}
                label="Engagement"
                score={scores.engagementScore}
              />
              {engagementTrend && (
                <TrendIndicator
                  change={engagementTrend.changePercent}
                  trend={engagementTrend.trend}
                />
              )}
            </div>
            <ScoreRing
              color="#f59e0b"
              icon={Star}
              label="Importance"
              score={scores.importanceScore}
            />
            <ScoreRing
              color="#8b5cf6"
              icon={MessageSquare}
              label="Sentiment"
              score={scores.sentimentScore}
            />
          </div>
        </CardContent>
      </Card>

      {/* Trend Chart & Lifecycle */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Health Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Health Score Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {trendChartData.length > 0 ? (
              <ResponsiveContainer height={180} width="100%">
                <AreaChart data={trendChartData}>
                  <defs>
                    <linearGradient
                      id="healthGradient"
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    className="stroke-muted"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    axisLine={false}
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    axisLine={false}
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!(active && payload?.[0])) {
                        return null;
                      }
                      const data = payload[0].payload as {
                        date: string;
                        health: number;
                      };
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <p className="font-medium">{data.date}</p>
                          <p className="text-muted-foreground text-sm">
                            Health: {data.health}%
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Area
                    dataKey="health"
                    fill="url(#healthGradient)"
                    stroke="#22c55e"
                    strokeWidth={2}
                    type="monotone"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[180px] items-center justify-center text-muted-foreground">
                No trend data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lifecycle & Role Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="h-4 w-4 text-indigo-500" />
              Profile Intelligence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs">Lifecycle Stage</p>
                <p className="mt-1 font-medium capitalize">
                  {lifecycle.stage ?? "Unknown"}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs">Role Type</p>
                <p className="mt-1 font-medium capitalize">
                  {lifecycle.roleType?.replace(/_/g, " ") ?? "Unknown"}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs">Seniority</p>
                <p className="mt-1 font-medium capitalize">
                  {lifecycle.seniorityLevel?.replace(/_/g, " ") ?? "Unknown"}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs">Influence Score</p>
                <p className="mt-1 font-medium">
                  {graph.influenceScore !== null
                    ? `${Math.round(graph.influenceScore * 100)}%`
                    : "N/A"}
                </p>
              </div>
            </div>

            {graph.communityIds && graph.communityIds.length > 0 && (
              <div>
                <p className="mb-2 text-muted-foreground text-xs">
                  Communities
                </p>
                <div className="flex flex-wrap gap-2">
                  {graph.communityIds.slice(0, 5).map((community) => (
                    <Badge
                      className="text-xs"
                      key={community}
                      variant="secondary"
                    >
                      <Users className="mr-1 h-3 w-3" />
                      {community}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Alerts */}
      {alertsData && alertsData.alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-amber-500" />
              Active Alerts
              <Badge className="ml-auto" variant="secondary">
                {alertsData.alerts.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alertsData.alerts.map((alert) => (
              <AlertItem
                alert={alert}
                key={alert.id}
                onAcknowledge={(id) =>
                  acknowledgeMutation.mutate({ organizationId, alertId: id })
                }
                onDismiss={(id) =>
                  dismissMutation.mutate({ organizationId, alertId: id })
                }
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Brief & Insights */}
      {snapshot?.brief !== undefined && snapshot?.brief !== null ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-500" />
              AI Brief
            </CardTitle>
            <CardDescription>
              Generated{" "}
              {intelligence.lastAnalyzedAt
                ? formatDistanceToNow(new Date(intelligence.lastAnalyzedAt), {
                    addSuffix: true,
                  })
                : "recently"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const brief = snapshot.brief as {
                summary?: string;
                keyInsights?: string[];
              } | null;
              if (!brief) {
                return null;
              }
              return (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {brief.summary && (
                    <p className="mb-4 text-foreground">{brief.summary}</p>
                  )}
                  {brief.keyInsights && brief.keyInsights.length > 0 && (
                    <div>
                      <h4 className="mb-2 font-medium text-sm">Key Insights</h4>
                      <ul className="space-y-1">
                        {brief.keyInsights.map((insight: string, i: number) => (
                          <li
                            className="flex items-start gap-2 text-muted-foreground text-sm"
                            key={i}
                          >
                            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
                            {insight}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default ContactIntelligenceDashboard;
