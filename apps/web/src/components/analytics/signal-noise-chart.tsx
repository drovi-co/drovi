// =============================================================================
// SIGNAL VS NOISE CHART
// =============================================================================
//
// Visualizes signal quality using Wheeler's Statistical Process Control.
// Shows ratio of special cause signals to common cause noise.
//

import { motion } from "framer-motion";
import { Activity, Loader2, Signal, Waves, Zap } from "lucide-react";
import { useMemo } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { useSignalNoiseStats } from "@/hooks/use-intelligence";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface SignalNoiseChartProps {
  organizationId: string;
  days?: number;
  className?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const COLORS = {
  signal: "#22c55e", // green-500
  noise: "#6b7280", // gray-500
  uncertain: "#f59e0b", // amber-500
};

const ZONE_CONFIG = {
  A: { label: "Zone A (>2σ)", color: "bg-green-500", description: "True signal" },
  B: { label: "Zone B (1-2σ)", color: "bg-amber-500", description: "Possible signal" },
  C: { label: "Zone C (<1σ)", color: "bg-gray-400", description: "Common cause" },
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function SignalNoiseChart({
  organizationId,
  days = 30,
  className,
}: SignalNoiseChartProps) {
  const { data, isLoading } = useSignalNoiseStats({ organizationId, days });

  const pieData = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Signals", value: data.signals, fill: COLORS.signal },
      { name: "Noise", value: data.noise, fill: COLORS.noise },
      { name: "Uncertain", value: data.uncertain, fill: COLORS.uncertain },
    ].filter((item) => item.value > 0);
  }, [data]);

  const zoneData = useMemo(() => {
    if (!data?.by_zone) return [];
    return Object.entries(data.by_zone).map(([zone, count]) => ({
      zone: zone as keyof typeof ZONE_CONFIG,
      count,
      percentage: data.total_intelligence > 0
        ? Math.round((count / data.total_intelligence) * 100)
        : 0,
    }));
  }, [data]);

  const signalRatioPercent = data ? Math.round(data.signal_ratio * 100) : 0;

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Signal className="h-5 w-5 text-green-500" />
            Signal Quality
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.total_intelligence === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Signal className="h-5 w-5 text-green-500" />
            Signal Quality
          </CardTitle>
          <CardDescription>
            Wheeler&apos;s Statistical Process Control
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Activity className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
              No intelligence data available for the last {days} days.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Signal className="h-5 w-5 text-green-500" />
          Signal Quality
          <Badge
            className={cn(
              "ml-2",
              signalRatioPercent >= 50
                ? "bg-green-500/10 text-green-600 border-green-500/30"
                : signalRatioPercent >= 25
                  ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                  : "bg-gray-500/10 text-gray-600 border-gray-500/30"
            )}
            variant="outline"
          >
            {signalRatioPercent}% Signal
          </Badge>
        </CardTitle>
        <CardDescription>
          Wheeler&apos;s Statistical Process Control - Last {days} days
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Pie Chart */}
          <div className="flex flex-col items-center">
            <div className="h-[200px] w-full">
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie
                    cx="50%"
                    cy="50%"
                    data={pieData}
                    dataKey="value"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {pieData.map((entry) => (
                      <Cell fill={entry.fill} key={entry.name} />
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
                            {data.value} items
                          </p>
                        </div>
                      );
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span className="text-sm">Signal ({data.signals})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-gray-500" />
                <span className="text-sm">Noise ({data.noise})</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-amber-500" />
                <span className="text-sm">Uncertain ({data.uncertain})</span>
              </div>
            </div>
          </div>

          {/* Stats & Control Zones */}
          <div className="space-y-6">
            {/* Key Stats */}
            <div className="grid grid-cols-2 gap-4">
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl bg-gradient-to-br from-green-500/10 to-green-500/5 p-4 text-center"
                initial={{ opacity: 0, scale: 0.95 }}
              >
                <Zap className="mx-auto mb-2 h-6 w-6 text-green-500" />
                <p className="font-bold text-2xl">{data.signals}</p>
                <p className="text-muted-foreground text-xs">True Signals</p>
              </motion.div>
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl bg-gradient-to-br from-gray-500/10 to-gray-500/5 p-4 text-center"
                initial={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: 0.1 }}
              >
                <Waves className="mx-auto mb-2 h-6 w-6 text-gray-500" />
                <p className="font-bold text-2xl">{data.noise}</p>
                <p className="text-muted-foreground text-xs">Common Cause</p>
              </motion.div>
            </div>

            {/* Control Chart Zones */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm">Control Chart Zones</h4>
              {zoneData.map((zone) => {
                const config = ZONE_CONFIG[zone.zone];
                return (
                  <div className="space-y-1" key={zone.zone}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        {config.label}
                      </span>
                      <span className="font-medium">{zone.count}</span>
                    </div>
                    <Progress
                      className="h-2"
                      indicatorClassName={config.color}
                      value={zone.percentage}
                    />
                    <p className="text-muted-foreground text-xs">
                      {config.description}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Summary */}
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-sm">
                <span className="font-medium">{data.total_intelligence}</span>{" "}
                intelligence items analyzed.{" "}
                {signalRatioPercent >= 50 ? (
                  <span className="text-green-600">
                    Excellent signal quality!
                  </span>
                ) : signalRatioPercent >= 25 ? (
                  <span className="text-amber-600">
                    Moderate signal quality - consider filtering.
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    High noise ratio - most variations are common cause.
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default SignalNoiseChart;
