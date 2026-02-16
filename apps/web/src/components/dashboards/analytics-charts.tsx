// =============================================================================
// ANALYTICS CHARTS COMPONENTS
// =============================================================================
//
// Foundation for analytics visualizations. These charts show trends and
// patterns across commitments, decisions, and communications. Not just
// vanity metrics - actionable intelligence about your work patterns.
//

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { eachDayOfInterval, format, subDays } from "date-fns";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface ChartData {
  date: string;
  value: number;
  [key: string]: string | number;
}

interface CommitmentTrendChartProps {
  data: Array<{
    date: Date;
    created: number;
    completed: number;
    overdue: number;
  }>;
  className?: string;
}

interface DecisionCategoryChartProps {
  data: Array<{
    category: string;
    count: number;
    color?: string;
  }>;
  className?: string;
}

interface RelationshipHealthChartProps {
  data: Array<{
    range: string;
    count: number;
    color: string;
  }>;
  className?: string;
}

interface CommunicationVolumeChartProps {
  data: Array<{
    date: Date;
    sent: number;
    received: number;
  }>;
  className?: string;
}

// =============================================================================
// COLORS
// =============================================================================

const CHART_COLORS = {
  primary: "hsl(var(--primary))",
  secondary: "hsl(var(--secondary))",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  muted: "hsl(var(--muted-foreground))",
};

// =============================================================================
// COMMITMENT TREND CHART
// =============================================================================

export function CommitmentTrendChart({
  data,
  className,
}: CommitmentTrendChartProps) {
  const chartData = data.map((d) => ({
    date: format(d.date, "MMM d"),
    created: d.created,
    completed: d.completed,
    overdue: d.overdue,
  }));

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Commitment Trends</CardTitle>
        <CardDescription>Created vs completed over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorCreated" x1="0" x2="0" y1="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={CHART_COLORS.blue}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={CHART_COLORS.blue}
                    stopOpacity={0}
                  />
                </linearGradient>
                <linearGradient id="colorCompleted" x1="0" x2="0" y1="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={CHART_COLORS.success}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={CHART_COLORS.success}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid className="stroke-muted" strokeDasharray="3 3" />
              <XAxis
                className="fill-muted-foreground text-xs"
                dataKey="date"
                tick={{ fontSize: 12 }}
              />
              <YAxis
                className="fill-muted-foreground text-xs"
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Area
                dataKey="created"
                fill="url(#colorCreated)"
                fillOpacity={1}
                name="Created"
                stroke={CHART_COLORS.blue}
                type="monotone"
              />
              <Area
                dataKey="completed"
                fill="url(#colorCompleted)"
                fillOpacity={1}
                name="Completed"
                stroke={CHART_COLORS.success}
                type="monotone"
              />
              <Line
                dataKey="overdue"
                name="Overdue"
                stroke={CHART_COLORS.danger}
                strokeDasharray="5 5"
                type="monotone"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// DECISION CATEGORY CHART
// =============================================================================

export function DecisionCategoryChart({
  data,
  className,
}: DecisionCategoryChartProps) {
  const COLORS = [
    CHART_COLORS.purple,
    CHART_COLORS.blue,
    CHART_COLORS.success,
    CHART_COLORS.warning,
    CHART_COLORS.danger,
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Decisions by Topic</CardTitle>
        <CardDescription>Distribution across categories</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <PieChart>
              <Pie
                cx="50%"
                cy="50%"
                data={data}
                dataKey="count"
                fill="#8884d8"
                label={({ category, percent }) =>
                  `${category}: ${(percent * 100).toFixed(0)}%`
                }
                labelLine={false}
                nameKey="category"
                outerRadius={100}
              >
                {data.map((entry, index) => (
                  <Cell
                    fill={entry.color ?? COLORS[index % COLORS.length]}
                    key={`cell-${index}`}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// RELATIONSHIP HEALTH CHART
// =============================================================================

export function RelationshipHealthChart({
  data,
  className,
}: RelationshipHealthChartProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">
          Relationship Health Distribution
        </CardTitle>
        <CardDescription>Contacts by health score range</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid className="stroke-muted" strokeDasharray="3 3" />
              <XAxis className="fill-muted-foreground text-xs" type="number" />
              <YAxis
                className="fill-muted-foreground text-xs"
                dataKey="range"
                type="category"
                width={80}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="count" name="Contacts">
                {data.map((entry, index) => (
                  <Cell fill={entry.color} key={`cell-${index}`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// COMMUNICATION VOLUME CHART
// =============================================================================

export function CommunicationVolumeChart({
  data,
  className,
}: CommunicationVolumeChartProps) {
  const chartData = data.map((d) => ({
    date: format(d.date, "MMM d"),
    sent: d.sent,
    received: d.received,
  }));

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Email Volume</CardTitle>
        <CardDescription>Sent vs received over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer height="100%" width="100%">
            <LineChart data={chartData}>
              <CartesianGrid className="stroke-muted" strokeDasharray="3 3" />
              <XAxis
                className="fill-muted-foreground text-xs"
                dataKey="date"
                tick={{ fontSize: 12 }}
              />
              <YAxis
                className="fill-muted-foreground text-xs"
                tick={{ fontSize: 12 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Line
                dataKey="sent"
                dot={false}
                name="Sent"
                stroke={CHART_COLORS.blue}
                strokeWidth={2}
                type="monotone"
              />
              <Line
                dataKey="received"
                dot={false}
                name="Received"
                stroke={CHART_COLORS.purple}
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// MINI SPARKLINE
// =============================================================================

interface SparklineProps {
  data: number[];
  color?: string;
  className?: string;
}

export function Sparkline({
  data,
  color = CHART_COLORS.primary,
  className,
}: SparklineProps) {
  const chartData = data.map((value, index) => ({ index, value }));

  return (
    <div className={cn("h-8 w-24", className)}>
      <ResponsiveContainer height="100%" width="100%">
        <LineChart data={chartData}>
          <Line
            dataKey="value"
            dot={false}
            stroke={color}
            strokeWidth={1.5}
            type="monotone"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// =============================================================================
// HELPER: GENERATE SAMPLE DATA
// =============================================================================

export function generateSampleCommitmentTrendData(days = 30) {
  const today = new Date();
  const dates = eachDayOfInterval({
    start: subDays(today, days),
    end: today,
  });

  return dates.map((date) => ({
    date,
    created: Math.floor(Math.random() * 10) + 1,
    completed: Math.floor(Math.random() * 8),
    overdue: Math.floor(Math.random() * 3),
  }));
}

export function generateSampleCommunicationData(days = 30) {
  const today = new Date();
  const dates = eachDayOfInterval({
    start: subDays(today, days),
    end: today,
  });

  return dates.map((date) => ({
    date,
    sent: Math.floor(Math.random() * 30) + 5,
    received: Math.floor(Math.random() * 50) + 10,
  }));
}
