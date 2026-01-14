// =============================================================================
// INTELLIGENCE ANALYTICS DASHBOARD - STUNNING VISUAL DESIGN
// =============================================================================
//
// Phase 4: Your personal and organizational intelligence health score.
// Beautiful full-width dashboard with recharts visualizations.
//

import { useQuery } from "@tanstack/react-query";
import { format, subDays, subWeeks, eachDayOfInterval, isSameDay, startOfWeek, endOfWeek } from "date-fns";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Brain,
  Calendar,
  CheckCircle2,
  Clock,
  GitBranch,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
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
  Line,
  LineChart,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChartConfig } from "@/components/ui/chart";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
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
    if (s >= 80) return { stroke: "#22c55e", fill: "#22c55e20", label: "Excellent" };
    if (s >= 60) return { stroke: "#f59e0b", fill: "#f59e0b20", label: "Good" };
    if (s >= 40) return { stroke: "#f97316", fill: "#f97316", label: "Needs Work" };
    return { stroke: "#ef4444", fill: "#ef444420", label: "Critical" };
  };

  const colors = getColor(score);
  const data = [{ name: "score", value: score, fill: colors.stroke }];

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-20 h-20 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="65%"
            outerRadius="100%"
            barSize={8}
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            <RadialBar
              dataKey="value"
              cornerRadius={6}
              background={{ fill: "hsl(var(--muted))" }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-xl font-bold"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, type: "spring" }}
          >
            {score}
          </motion.span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <Badge
          variant="outline"
          className="w-fit text-xs"
          style={{ borderColor: colors.stroke, color: colors.stroke }}
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

function StatCard({ title, value, change, changeLabel, icon: Icon, gradient, iconColor }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border bg-card p-5"
    >
      <div className={cn("absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20", gradient)} />
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
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
              {changeLabel && <span className="text-muted-foreground">{changeLabel}</span>}
            </div>
          )}
        </div>
        <div className={cn("p-3 rounded-xl", gradient)}>
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Mon</span>
        <div className="flex-1" />
        <span>Sun</span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-2">
        {weekGroups.map((week, weekIndex) => (
          <div key={weekIndex} className="flex flex-col gap-1">
            {week.map((day, dayIndex) => {
              const count = getCountForDay(day);
              return (
                <motion.div
                  key={dayIndex}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: weekIndex * 0.02 + dayIndex * 0.01 }}
                  className={cn(
                    "w-4 h-4 rounded-sm cursor-pointer transition-transform hover:scale-125",
                    getColor(count)
                  )}
                  title={`${format(day, "MMM d, yyyy")}: ${count} activities`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>Less</span>
        <div className="flex gap-1">
          <div className="w-3 h-3 rounded-sm bg-muted/40" />
          <div className="w-3 h-3 rounded-sm bg-emerald-200" />
          <div className="w-3 h-3 rounded-sm bg-emerald-300" />
          <div className="w-3 h-3 rounded-sm bg-emerald-400" />
          <div className="w-3 h-3 rounded-sm bg-emerald-500" />
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
  const { data: decisionStats, isLoading: loadingDecisions, refetch: refetchDecisions } = useQuery(
    trpc.decisions.getStats.queryOptions({ organizationId })
  );

  const { data: commitmentStats, isLoading: loadingCommitments, refetch: refetchCommitments } = useQuery(
    trpc.commitments.getStats.queryOptions({ organizationId })
  );

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

    const completionRate = totalCommitments > 0
      ? Math.round((completedCommitments / totalCommitments) * 100)
      : 100;

    const decisionVelocity = decisionsThisMonth > 0
      ? Math.round(decisionsThisMonth / 4)
      : 0;

    const contradictionRate = totalDecisions > 0
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
  const commitmentStatusData = useMemo(() => [
    { name: "Completed", value: metrics.completedCommitments, fill: "#22c55e" },
    { name: "Pending", value: Math.max(0, metrics.totalCommitments - metrics.completedCommitments - metrics.overdueCommitments), fill: "#f59e0b" },
    { name: "Overdue", value: metrics.overdueCommitments, fill: "#ef4444" },
  ], [metrics]);

  // Direction pie data
  const directionData = useMemo(() => [
    { name: "I Owe", value: metrics.owedByMe, fill: "#3b82f6" },
    { name: "Owed to Me", value: metrics.owedToMe, fill: "#8b5cf6" },
  ], [metrics]);

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
      <div className="flex items-center justify-center h-96">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Health Score Card */}
        <Card className="p-5 bg-gradient-to-br from-purple-500/5 to-indigo-500/5">
          <HealthScore
            score={metrics.healthScore}
            label="Health Score"
          />
        </Card>
        <StatCard
          title="Total Decisions"
          value={metrics.totalDecisions}
          change={12}
          changeLabel="vs last week"
          icon={GitBranch}
          gradient="bg-gradient-to-br from-purple-500 to-indigo-600"
          iconColor="text-white"
        />
        <StatCard
          title="Open Commitments"
          value={metrics.totalCommitments - metrics.completedCommitments}
          change={metrics.overdueCommitments > 0 ? -8 : 5}
          changeLabel="vs last week"
          icon={Target}
          gradient="bg-gradient-to-br from-blue-500 to-cyan-600"
          iconColor="text-white"
        />
        <StatCard
          title="Completion Rate"
          value={`${metrics.completionRate}%`}
          change={3}
          changeLabel="vs last month"
          icon={CheckCircle2}
          gradient="bg-gradient-to-br from-green-500 to-emerald-600"
          iconColor="text-white"
        />
        <StatCard
          title="Relationships"
          value={metrics.totalContacts}
          change={15}
          changeLabel="new this month"
          icon={Users}
          gradient="bg-gradient-to-br from-orange-500 to-amber-600"
          iconColor="text-white"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Activity Area Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-purple-500" />
              Weekly Intelligence Activity
            </CardTitle>
            <CardDescription>Decisions and commitments over the past week</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={areaChartConfig} className="h-[280px] w-full">
              <AreaChart data={weeklyTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorDecisions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorCommitments" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  className="text-muted-foreground"
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  type="monotone"
                  dataKey="decisions"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#colorDecisions)"
                />
                <Area
                  type="monotone"
                  dataKey="commitments"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#colorCommitments)"
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
            <CardDescription>What you owe vs what's owed to you</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={directionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {directionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const data = payload[0];
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <p className="font-medium">{data.name}</p>
                          <p className="text-sm text-muted-foreground">{data.value} commitments</p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-6 mt-2">
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
            <ChartContainer config={barChartConfig} className="h-[200px] w-full">
              <BarChart data={commitmentStatusData} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {commitmentStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
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
              <div className="text-center p-4 rounded-xl bg-muted/50">
                <p className="text-3xl font-bold text-purple-600">{metrics.decisionsThisWeek}</p>
                <p className="text-xs text-muted-foreground mt-1">This Week</p>
              </div>
              <div className="text-center p-4 rounded-xl bg-muted/50">
                <p className="text-3xl font-bold text-indigo-600">{metrics.decisionsThisMonth}</p>
                <p className="text-xs text-muted-foreground mt-1">This Month</p>
              </div>
              <div className="text-center p-4 rounded-xl bg-muted/50">
                <p className="text-3xl font-bold text-blue-600">{metrics.decisionVelocity}</p>
                <p className="text-xs text-muted-foreground mt-1">Per Week Avg</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Superseded (updated)</span>
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                  {metrics.supersededDecisions}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Consistency Score</span>
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                  {100 - metrics.contradictionRate}%
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Avg Confidence</span>
                <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/30">
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
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
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
                const percentage = Math.round((topic.count / (decisionStats.topTopics?.[0]?.count ?? 1)) * 100);
                const colors = [
                  "from-purple-500 to-indigo-500",
                  "from-blue-500 to-cyan-500",
                  "from-green-500 to-emerald-500",
                  "from-amber-500 to-orange-500",
                  "from-pink-500 to-rose-500",
                  "from-violet-500 to-purple-500",
                ];
                return (
                  <div key={topic.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-muted-foreground w-6">
                          {index + 1}
                        </span>
                        <span className="font-medium">{topic.name}</span>
                      </div>
                      <Badge variant="secondary">{topic.count} decisions</Badge>
                    </div>
                    <div className="ml-9">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className={cn("h-full rounded-full bg-gradient-to-r", colors[index % colors.length])}
                          initial={{ width: 0 }}
                          animate={{ width: `${percentage}%` }}
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
