"use client";

/**
 * Console Chart Components
 *
 * Visualization components for the Console:
 * - TimeHistogram: Datadog-style bar histogram for time distribution
 * - TimeseriesChart: Line chart for data over time
 * - TopListChart: Horizontal bar chart for top values
 * - PieChart: Distribution chart
 */

import { format, formatDistanceToNow } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart as RechartsPie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// =============================================================================
// TIME HISTOGRAM (Datadog-style)
// =============================================================================

export interface TimeHistogramDataPoint {
  timestamp: string;
  count: number;
}

export interface TimeHistogramProps {
  data: TimeHistogramDataPoint[];
  className?: string;
  height?: number;
  barColor?: string;
}

export function TimeHistogram({
  data,
  className,
  height = 80,
  barColor = "#f87171", // Coral/red like Datadog
}: TimeHistogramProps) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/30",
          className
        )}
        style={{ height }}
      >
        <p className="text-muted-foreground text-xs">No data in time range</p>
      </div>
    );
  }

  // Calculate max for scale
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  // Format time labels for X axis (show first, middle, and last)
  const getTimeLabel = (index: number) => {
    if (data.length === 0) return "";
    const point = data[index];
    if (!point) return "";
    return format(new Date(point.timestamp), "HH:mm");
  };

  // Calculate which labels to show (evenly spaced)
  const labelCount = 8;
  const step = Math.max(1, Math.floor(data.length / labelCount));

  return (
    <div className={cn("relative", className)}>
      {/* Y-axis labels */}
      <div className="absolute left-0 top-0 flex h-full flex-col justify-between pt-2 pb-5 pr-2 text-right text-muted-foreground text-[10px]">
        <span>{maxCount >= 1000 ? `${(maxCount / 1000).toFixed(0)}k` : maxCount}</span>
        <span>0</span>
      </div>

      {/* Chart area */}
      <div className="ml-8" style={{ height }}>
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            barCategoryGap={1}
            data={data}
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          >
            <XAxis
              axisLine={{ stroke: "hsl(var(--border))" }}
              dataKey="timestamp"
              fontSize={10}
              interval={step - 1}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={(value) => format(new Date(value), "HH:mm")}
              tickLine={false}
              tickMargin={4}
            />
            <YAxis domain={[0, maxCount]} hide />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload?.length) {
                  const point = payload[0].payload as TimeHistogramDataPoint;
                  return (
                    <div className="rounded-md border bg-background px-2 py-1 text-xs shadow-lg">
                      <p className="font-medium">
                        {format(new Date(point.timestamp), "MMM d, HH:mm")}
                      </p>
                      <p className="text-muted-foreground">
                        {point.count.toLocaleString()} items
                      </p>
                    </div>
                  );
                }
                return null;
              }}
              cursor={{ fill: "hsl(var(--muted)/0.3)" }}
            />
            <Bar
              dataKey="count"
              fill={barColor}
              radius={[1, 1, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// =============================================================================
// TIMESERIES CHART
// =============================================================================

export interface TimeseriesDataPoint {
  timestamp: string;
  count: number;
}

export interface TimeseriesChartProps {
  data: TimeseriesDataPoint[];
  className?: string;
  height?: number;
}

const timeseriesConfig: ChartConfig = {
  count: {
    label: "Count",
    color: "hsl(var(--primary))",
  },
};

export function TimeseriesChart({
  data,
  className,
  height = 300,
}: TimeseriesChartProps) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border bg-muted/30",
          className
        )}
        style={{ height }}
      >
        <p className="text-muted-foreground text-sm">No timeseries data available</p>
      </div>
    );
  }

  // Format data for recharts
  const chartData = data.map((point) => ({
    ...point,
    date: format(new Date(point.timestamp), "MMM d"),
    time: format(new Date(point.timestamp), "HH:mm"),
  }));

  return (
    <div className={cn("rounded-lg border bg-background p-4", className)}>
      <ChartContainer className="aspect-auto" config={timeseriesConfig} style={{ height }}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="date"
            fontSize={11}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis
            axisLine={false}
            fontSize={11}
            tickLine={false}
            tickMargin={8}
            width={40}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  if (payload?.[0]?.payload?.timestamp) {
                    return format(
                      new Date(payload[0].payload.timestamp),
                      "PPp"
                    );
                  }
                  return "";
                }}
              />
            }
          />
          <Line
            dataKey="count"
            dot={false}
            stroke="var(--color-count)"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

// =============================================================================
// TOP LIST CHART
// =============================================================================

export interface TopListItem {
  name: string;
  value: number;
  percentage?: number;
}

export interface TopListChartProps {
  data: TopListItem[];
  className?: string;
  maxItems?: number;
  showPercentage?: boolean;
  colorScheme?: "default" | "rainbow";
}

// Vercel-style monochrome + blue accent colors
const COLORS = [
  "#000000",
  "#404040",
  "#737373",
  "#a3a3a3",
  "#d4d4d4",
  "#0070f3",
  "#171717",
  "#525252",
  "#262626",
  "#0070f3",
];

export function TopListChart({
  data,
  className,
  maxItems = 10,
  showPercentage = true,
  colorScheme = "default",
}: TopListChartProps) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex h-64 items-center justify-center rounded-lg border bg-muted/30",
          className
        )}
      >
        <p className="text-muted-foreground text-sm">No data available</p>
      </div>
    );
  }

  // Sort and limit data
  const sortedData = [...data]
    .sort((a, b) => b.value - a.value)
    .slice(0, maxItems);

  // Calculate total for percentages
  const total = sortedData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className={cn("space-y-2 rounded-lg border bg-background p-4", className)}>
      {sortedData.map((item, index) => {
        const percentage = item.percentage ?? (total > 0 ? (item.value / total) * 100 : 0);
        const color = colorScheme === "rainbow" ? COLORS[index % COLORS.length] : "hsl(var(--primary))";

        return (
          <div className="group flex items-center gap-3" key={item.name}>
            {/* Rank */}
            <span className="w-6 shrink-0 text-right text-muted-foreground text-xs">
              {index + 1}
            </span>

            {/* Bar */}
            <div className="flex-1">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate font-medium">{item.name}</span>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>{item.value.toLocaleString()}</span>
                  {showPercentage && (
                    <span className="w-12 text-right text-xs">
                      {percentage.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${percentage}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// PIE CHART
// =============================================================================

export interface PieChartProps {
  data: TopListItem[];
  className?: string;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}

export function ConsolePieChart({
  data,
  className,
  height = 300,
  innerRadius = 60,
  outerRadius = 100,
}: PieChartProps) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border bg-muted/30",
          className
        )}
        style={{ height }}
      >
        <p className="text-muted-foreground text-sm">No data available</p>
      </div>
    );
  }

  // Calculate total
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className={cn("rounded-lg border bg-background p-4", className)}>
      <ResponsiveContainer height={height} width="100%">
        <RechartsPie>
          <Pie
            cx="50%"
            cy="50%"
            data={data}
            dataKey="value"
            innerRadius={innerRadius}
            labelLine={false}
            nameKey="name"
            outerRadius={outerRadius}
          >
            {data.map((_, index) => (
              <Cell
                fill={COLORS[index % COLORS.length]}
                key={`cell-${index}`}
              />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload?.length) {
                const item = payload[0].payload as TopListItem;
                const percentage = ((item.value / total) * 100).toFixed(1);
                return (
                  <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-lg">
                    <p className="font-medium">{item.name}</p>
                    <p className="text-muted-foreground">
                      {item.value.toLocaleString()} ({percentage}%)
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
        </RechartsPie>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap justify-center gap-4">
        {data.map((item, index) => (
          <div className="flex items-center gap-1.5" key={item.name}>
            <div
              className="size-3 rounded-full"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span className="text-muted-foreground text-xs">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// GROUPED BAR CHART
// =============================================================================

export interface GroupedData {
  group: string;
  items: Array<{ name: string; value: number }>;
}

export interface GroupedBarChartProps {
  data: GroupedData[];
  className?: string;
  height?: number;
}

export function GroupedBarChart({
  data,
  className,
  height = 300,
}: GroupedBarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border bg-muted/30",
          className
        )}
        style={{ height }}
      >
        <p className="text-muted-foreground text-sm">No grouped data available</p>
      </div>
    );
  }

  // Transform data for recharts
  const chartData = data.map((group) => {
    const obj: Record<string, string | number> = { name: group.group };
    for (const item of group.items) {
      obj[item.name] = item.value;
    }
    return obj;
  });

  // Get all unique item names
  const itemNames = [...new Set(data.flatMap((g) => g.items.map((i) => i.name)))];

  return (
    <div className={cn("rounded-lg border bg-background p-4", className)}>
      <ResponsiveContainer height={height} width="100%">
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="name"
            fontSize={11}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis
            axisLine={false}
            fontSize={11}
            tickLine={false}
            tickMargin={8}
            width={40}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload?.length) {
                return (
                  <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-lg">
                    <p className="mb-1 font-medium">{label}</p>
                    {payload.map((entry, index) => (
                      <div
                        className="flex items-center gap-2"
                        key={entry.dataKey}
                      >
                        <div
                          className="size-2 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="text-muted-foreground">
                          {entry.dataKey}:
                        </span>
                        <span>{Number(entry.value).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                );
              }
              return null;
            }}
          />
          {itemNames.map((name, index) => (
            <Bar
              dataKey={name}
              fill={COLORS[index % COLORS.length]}
              key={name}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
