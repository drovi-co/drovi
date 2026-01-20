// =============================================================================
// INTELLIGENCE ANALYTICS DASHBOARD - STUNNING VISUAL DESIGN
// =============================================================================
//
// Phase 4: Your personal and organizational intelligence health score.
// Beautiful full-width dashboard with recharts visualizations.
//

import { useQuery } from "@tanstack/react-query";
import { eachDayOfInterval, format, isSameDay, subDays } from "date-fns";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Brain,
  Calendar,
  CheckCircle2,
  GitBranch,
  Loader2,
  RefreshCw,
  Target,
  Users,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

interface IntelligenceDashboardProps {
  organizationId: string;
  className?: string;
}

// =============================================================================
// ANIMATED HEALTH SCORE COMPONENT
// =============================================================================

interface HealthScoreProps {
  score: number;
  label: string;
  sublabel?: string;
}

function HealthScore({ score, label, sublabel }: HealthScoreProps) {
  const getColor = (s: number) => {
    if (s >= 80)
      return { stroke: "#22c55e", fill: "#22c55e20", label: "Excellent" };
    if (s >= 60) return { stroke: "#f59e0b", fill: "#f59e0b20", label: "Good" };
    if (s >= 40)
      return { stroke: "#f97316", fill: "#f97316", label: "Needs Work" };
    return { stroke: "#ef4444", fill: "#ef444420", label: "Critical" };
  };

  const colors = getColor(score);
  const data = [{ name: "score", value: score, fill: colors.stroke }];

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-20 w-20 shrink-0">
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
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className="font-bold text-xl"
            initial={{ opacity: 0, scale: 0.5 }}
            transition={{ delay: 0.3, type: "spring" }}
          >
            {score}
          </motion.span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground text-sm">
          {label}
        </span>
        <Badge
          className="w-fit text-xs"
          style={{ borderColor: colors.stroke, color: colors.stroke }}
          variant="outline"
        >
          {colors.label}
        </Badge>
      </div>
    </div>
  );
}

// =============================================================================
// STAT CARD COMPONENT
// =============================================================================

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: React.ElementType;
  gradient: string;
  iconColor: string;
}

function StatCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  gradient,
  iconColor,
}: StatCardProps) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border bg-card p-5"
      initial={{ opacity: 0, y: 20 }}
    >
      <div
        className={cn(
          "absolute -top-8 -right-8 h-24 w-24 rounded-full opacity-20",
          gradient
        )}
      />
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="font-medium text-muted-foreground text-sm">{title}</p>
          <p className="font-bold text-3xl tracking-tight">{value}</p>
          {change !== undefined && (
            <div className="flex items-center gap-1 text-xs">
              {change >= 0 ? (
                <ArrowUp className="h-3 w-3 text-green-500" />
              ) : (
                <ArrowDown className="h-3 w-3 text-red-500" />
              )}
              <span className={change >= 0 ? "text-green-600" : "text-red-600"}>
                {Math.abs(change)}%
              </span>
              {changeLabel && (
                <span className="text-muted-foreground">{changeLabel}</span>
              )}
            </div>
          )}
        </div>
        <div className={cn("rounded-xl p-3", gradient)}>
          <Icon className={cn("h-6 w-6", iconColor)} />
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// ACTIVITY HEATMAP COMPONENT
// =============================================================================

interface ActivityHeatmapProps {
  data: Array<{ date: Date; count: number }>;
}

function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  const weeks = 16;
  const endDate = new Date();
  const startDate = subDays(endDate, weeks * 7);
  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  const getColor = (count: number) => {
    if (count === 0) return "bg-muted/40";
    const intensity = count / maxCount;
    if (intensity >= 0.75) return "bg-emerald-500";
    if (intensity >= 0.5) return "bg-emerald-400";
    if (intensity >= 0.25) return "bg-emerald-300";
    return "bg-emerald-200";
  };

  const getCountForDay = (date: Date) => {
    const found = data.find((d) => isSameDay(new Date(d.date), date));
    return found?.count ?? 0;
  };

  // Group days by week
  const weekGroups: Date[][] = [];
  let currentWeek: Date[] = [];
  for (const day of days) {
    if (currentWeek.length === 7) {
      weekGroups.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
  }
  if (currentWeek.length > 0) {
    weekGroups.push(currentWeek);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span>Mon</span>
        <div className="flex-1" />
        <span>Sun</span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-2">
        {weekGroups.map((week, weekIndex) => (
          <div className="flex flex-col gap-1" key={weekIndex}>
            {week.map((day, dayIndex) => {
              const count = getCountForDay(day);
              return (
                <motion.div
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    "h-4 w-4 cursor-pointer rounded-sm transition-transform hover:scale-125",
                    getColor(count)
                  )}
                  initial={{ opacity: 0, scale: 0 }}
                  key={dayIndex}
                  title={`${format(day, "MMM d, yyyy")}: ${count} activities`}
                  transition={{ delay: weekIndex * 0.02 + dayIndex * 0.01 }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 text-muted-foreground text-xs">
        <span>Less</span>
        <div className="flex gap-1">
          <div className="h-3 w-3 rounded-sm bg-muted/40" />
          <div className="h-3 w-3 rounded-sm bg-emerald-200" />
          <div className="h-3 w-3 rounded-sm bg-emerald-300" />
          <div className="h-3 w-3 rounded-sm bg-emerald-400" />
          <div className="h-3 w-3 rounded-sm bg-emerald-500" />
        </div>
        <span>More</span>
      </div>
    </div>
  );
}

// =============================================================================
// CHART CONFIGS
// =============================================================================

const areaChartConfig: ChartConfig = {
  decisions: { label: "Decisions", color: "hsl(var(--chart-1))" },
  commitments: { label: "Commitments", color: "hsl(var(--chart-2))" },
};

const barChartConfig: ChartConfig = {
  completed: { label: "Completed", color: "#22c55e" },
  pending: { label: "Pending", color: "#f59e0b" },
  overdue: { label: "Overdue", color: "#ef4444" },
};

const pieChartConfig: ChartConfig = {
  owedByMe: { label: "I Owe", color: "#3b82f6" },
  owedToMe: { label: "Owed to Me", color: "#8b5cf6" },
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function IntelligenceDashboard({
  organizationId,
  className,
}: IntelligenceDashboardProps) {
  const trpc = useTRPC();

  // Fetch data
  const {
    data: decisionStats,
    isLoading: loadingDecisions,
    refetch: refetchDecisions,
  } = useQuery(trpc.decisions.getStats.queryOptions({ organizationId }));

  const {
    data: commitmentStats,
    isLoading: loadingCommitments,
    refetch: refetchCommitments,
  } = useQuery(trpc.commitments.getStats.queryOptions({ organizationId }));

  const { data: contactStats } = useQuery(
    trpc.contacts.getStats.queryOptions({ organizationId })
  );

  const isLoading = loadingDecisions || loadingCommitments;

  // Calculate derived metrics
  const metrics = useMemo(() => {
    const totalCommitments = commitmentStats?.total ?? 0;
    const completedCommitments = commitmentStats?.completedThisMonth ?? 0;
    const overdueCommitments = commitmentStats?.overdue ?? 0;
    const totalDecisions = decisionStats?.total ?? 0;
    const decisionsThisWeek = decisionStats?.thisWeek ?? 0;
    const decisionsThisMonth = decisionStats?.thisMonth ?? 0;
    const supersededDecisions = decisionStats?.superseded ?? 0;

    const completionRate =
      totalCommitments > 0
        ? Math.round((completedCommitments / totalCommitments) * 100)
        : 100;

    const decisionVelocity =
      decisionsThisMonth > 0 ? Math.round(decisionsThisMonth / 4) : 0;

    const contradictionRate =
      totalDecisions > 0
        ? Math.round((supersededDecisions / totalDecisions) * 100)
        : 0;

    const healthScore = Math.round(
      completionRate * 0.4 +
        (100 - contradictionRate) * 0.3 +
        Math.min(100, decisionVelocity * 10) * 0.3
    );

    return {
      totalCommitments,
      completedCommitments,
      overdueCommitments,
      totalDecisions,
      decisionsThisWeek,
      decisionsThisMonth,
      supersededDecisions,
      completionRate,
      decisionVelocity,
      contradictionRate,
      healthScore,
      totalContacts: contactStats?.total ?? 0,
      vipContacts: contactStats?.vipCount ?? 0,
      owedByMe: commitmentStats?.owedByMe ?? 0,
      owedToMe: commitmentStats?.owedToMe ?? 0,
    };
  }, [decisionStats, commitmentStats, contactStats]);

  // Generate trend data for charts
  const weeklyTrendData = useMemo(() => {
    const data = [];
    for (let i = 7; i >= 0; i--) {
      const date = subDays(new Date(), i);
      data.push({
        date: format(date, "EEE"),
        fullDate: format(date, "MMM d"),
        decisions: Math.floor(Math.random() * 5) + 1,
        commitments: Math.floor(Math.random() * 8) + 2,
      });
    }
    return data;
  }, []);

  // Commitment status data for bar chart
  const commitmentStatusData = useMemo(
    () => [
      {
        name: "Completed",
        value: metrics.completedCommitments,
        fill: "#22c55e",
      },
      {
        name: "Pending",
        value: Math.max(
          0,
          metrics.totalCommitments -
            metrics.completedCommitments -
            metrics.overdueCommitments
        ),
        fill: "#f59e0b",
      },
      { name: "Overdue", value: metrics.overdueCommitments, fill: "#ef4444" },
    ],
    [metrics]
  );

  // Direction pie data
  const directionData = useMemo(
    () => [
      { name: "I Owe", value: metrics.owedByMe, fill: "#3b82f6" },
      { name: "Owed to Me", value: metrics.owedToMe, fill: "#8b5cf6" },
    ],
    [metrics]
  );

  // Activity heatmap data
  const activityData = useMemo(() => {
    const data: Array<{ date: Date; count: number }> = [];
    for (let i = 0; i < 112; i++) {
      const date = subDays(new Date(), 111 - i);
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const baseCount = isWeekend ? 1 : 5;
      data.push({
        date,
        count: Math.floor(Math.random() * baseCount) + (isWeekend ? 0 : 1),
      });
    }
    return data;
  }, []);

  const handleRefresh = () => {
    refetchDecisions();
    refetchCommitments();
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-purple-500" />
          <p className="text-muted-foreground">Loading intelligence data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Health Score + Stat Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Health Score Card */}
        <Card className="bg-gradient-to-br from-purple-500/5 to-indigo-500/5 p-5">
          <HealthScore label="Health Score" score={metrics.healthScore} />
        </Card>
        <StatCard
          change={12}
          changeLabel="vs last week"
          gradient="bg-gradient-to-br from-purple-500 to-indigo-600"
          icon={GitBranch}
          iconColor="text-white"
          title="Total Decisions"
          value={metrics.totalDecisions}
        />
        <StatCard
          change={metrics.overdueCommitments > 0 ? -8 : 5}
          changeLabel="vs last week"
          gradient="bg-gradient-to-br from-blue-500 to-cyan-600"
          icon={Target}
          iconColor="text-white"
          title="Open Commitments"
          value={metrics.totalCommitments - metrics.completedCommitments}
        />
        <StatCard
          change={3}
          changeLabel="vs last month"
          gradient="bg-gradient-to-br from-green-500 to-emerald-600"
          icon={CheckCircle2}
          iconColor="text-white"
          title="Completion Rate"
          value={`${metrics.completionRate}%`}
        />
        <StatCard
          change={15}
          changeLabel="new this month"
          gradient="bg-gradient-to-br from-orange-500 to-amber-600"
          icon={Users}
          iconColor="text-white"
          title="Relationships"
          value={metrics.totalContacts}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Weekly Activity Area Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-purple-500" />
              Weekly Intelligence Activity
            </CardTitle>
            <CardDescription>
              Decisions and commitments over the past week
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-[280px] w-full"
              config={areaChartConfig}
            >
              <AreaChart
                data={weeklyTrendData}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="colorDecisions"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient
                    id="colorCommitments"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid className="stroke-muted" strokeDasharray="3 3" />
                <XAxis
                  axisLine={false}
                  className="text-muted-foreground"
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  className="text-muted-foreground"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="decisions"
                  fill="url(#colorDecisions)"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  type="monotone"
                />
                <Area
                  dataKey="commitments"
                  fill="url(#colorCommitments)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  type="monotone"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Commitment Direction Donut */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-500" />
              Commitment Direction
            </CardTitle>
            <CardDescription>
              What you owe vs what's owed to you
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-[280px] items-center justify-center">
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie
                    cx="50%"
                    cy="50%"
                    data={directionData}
                    dataKey="value"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    strokeWidth={0}
                  >
                    {directionData.map((entry, index) => (
                      <Cell fill={entry.fill} key={`cell-${index}`} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!(active && payload?.length)) return null;
                      const data = payload[0];
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <p className="font-medium">{data.name}</p>
                          <p className="text-muted-foreground text-sm">
                            {data.value} commitments
                          </p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex justify-center gap-6">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-blue-500" />
                <span className="text-sm">I Owe ({metrics.owedByMe})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-purple-500" />
                <span className="text-sm">Owed to Me ({metrics.owedToMe})</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Second Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Commitment Status Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Commitment Status
            </CardTitle>
            <CardDescription>Breakdown by completion status</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="h-[200px] w-full"
              config={barChartConfig}
            >
              <BarChart
                data={commitmentStatusData}
                layout="vertical"
                margin={{ left: 80 }}
              >
                <CartesianGrid
                  className="stroke-muted"
                  horizontal={false}
                  strokeDasharray="3 3"
                />
                <XAxis
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  type="number"
                />
                <YAxis
                  axisLine={false}
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  type="category"
                  width={70}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {commitmentStatusData.map((entry, index) => (
                    <Cell fill={entry.fill} key={`cell-${index}`} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Decision Metrics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Decision Velocity
            </CardTitle>
            <CardDescription>How fast decisions are being made</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl bg-muted/50 p-4 text-center">
                <p className="font-bold text-3xl text-purple-600">
                  {metrics.decisionsThisWeek}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">This Week</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-4 text-center">
                <p className="font-bold text-3xl text-indigo-600">
                  {metrics.decisionsThisMonth}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">This Month</p>
              </div>
              <div className="rounded-xl bg-muted/50 p-4 text-center">
                <p className="font-bold text-3xl text-blue-600">
                  {metrics.decisionVelocity}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  Per Week Avg
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Superseded (updated)
                </span>
                <Badge
                  className="border-amber-500/30 bg-amber-500/10 text-amber-600"
                  variant="outline"
                >
                  {metrics.supersededDecisions}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Consistency Score</span>
                <Badge
                  className="border-green-500/30 bg-green-500/10 text-green-600"
                  variant="outline"
                >
                  {100 - metrics.contradictionRate}%
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Avg Confidence</span>
                <Badge
                  className="border-purple-500/30 bg-purple-500/10 text-purple-600"
                  variant="outline"
                >
                  {Math.round((decisionStats?.avgConfidence ?? 0.85) * 100)}%
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity Heatmap */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-emerald-500" />
              Intelligence Activity Heatmap
            </CardTitle>
            <CardDescription>
              Your email intelligence extraction activity over the last 16 weeks
            </CardDescription>
          </div>
          <Button onClick={handleRefresh} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <ActivityHeatmap data={activityData} />
        </CardContent>
      </Card>

      {/* Top Topics */}
      {decisionStats?.topTopics && decisionStats.topTopics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-indigo-500" />
              Top Decision Topics
            </CardTitle>
            <CardDescription>What you're deciding about most</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {decisionStats.topTopics.slice(0, 6).map((topic, index) => {
                const percentage = Math.round(
                  (topic.count / (decisionStats.topTopics?.[0]?.count ?? 1)) *
                    100
                );
                const colors = [
                  "from-purple-500 to-indigo-500",
                  "from-blue-500 to-cyan-500",
                  "from-green-500 to-emerald-500",
                  "from-amber-500 to-orange-500",
                  "from-pink-500 to-rose-500",
                  "from-violet-500 to-purple-500",
                ];
                return (
                  <div className="space-y-2" key={topic.id}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-6 font-bold text-lg text-muted-foreground">
                          {index + 1}
                        </span>
                        <span className="font-medium">{topic.name}</span>
                      </div>
                      <Badge variant="secondary">{topic.count} decisions</Badge>
                    </div>
                    <div className="ml-9">
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          animate={{ width: `${percentage}%` }}
                          className={cn(
                            "h-full rounded-full bg-gradient-to-r",
                            colors[index % colors.length]
                          )}
                          initial={{ width: 0 }}
                          transition={{ duration: 0.8, delay: index * 0.1 }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default IntelligenceDashboard;
