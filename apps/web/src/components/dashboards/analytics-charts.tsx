// =============================================================================
// ANALYTICS CHARTS COMPONENTS
// =============================================================================
//
// Foundation for analytics visualizations. These charts show trends and
// patterns across commitments, decisions, and communications. Not just
// vanity metrics - actionable intelligence about your work patterns.
//

import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format, subDays, eachDayOfInterval } from "date-fns";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export function CommitmentTrendChart({ data, className }: CommitmentTrendChartProps) {
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
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.success} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.success} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
              />
              <YAxis className="text-xs fill-muted-foreground" tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="created"
                stroke={CHART_COLORS.blue}
                fillOpacity={1}
                fill="url(#colorCreated)"
                name="Created"
              />
              <Area
                type="monotone"
                dataKey="completed"
                stroke={CHART_COLORS.success}
                fillOpacity={1}
                fill="url(#colorCompleted)"
                name="Completed"
              />
              <Line
                type="monotone"
                dataKey="overdue"
                stroke={CHART_COLORS.danger}
                strokeDasharray="5 5"
                name="Overdue"
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

export function DecisionCategoryChart({ data, className }: DecisionCategoryChartProps) {
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
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={100}
                fill="#8884d8"
                dataKey="count"
                nameKey="category"
                label={({ category, percent }) =>
                  `${category}: ${(percent * 100).toFixed(0)}%`
                }
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color ?? COLORS[index % COLORS.length]}
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

export function RelationshipHealthChart({ data, className }: RelationshipHealthChartProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">Relationship Health Distribution</CardTitle>
        <CardDescription>Contacts by health score range</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" className="text-xs fill-muted-foreground" />
              <YAxis
                dataKey="range"
                type="category"
                className="text-xs fill-muted-foreground"
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
                  <Cell key={`cell-${index}`} fill={entry.color} />
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

export function CommunicationVolumeChart({ data, className }: CommunicationVolumeChartProps) {
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
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
              />
              <YAxis className="text-xs fill-muted-foreground" tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="sent"
                stroke={CHART_COLORS.blue}
                strokeWidth={2}
                dot={false}
                name="Sent"
              />
              <Line
                type="monotone"
                dataKey="received"
                stroke={CHART_COLORS.purple}
                strokeWidth={2}
                dot={false}
                name="Received"
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

export function Sparkline({ data, color = CHART_COLORS.primary, className }: SparklineProps) {
  const chartData = data.map((value, index) => ({ index, value }));

  return (
    <div className={cn("h-8 w-24", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
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
