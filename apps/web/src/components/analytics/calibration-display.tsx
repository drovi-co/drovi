// =============================================================================
// CALIBRATION METRICS DISPLAY
// =============================================================================
//
// Displays AI confidence calibration using DiBello's Strategic Rehearsal.
// Shows Brier score decomposition: reliability, resolution, uncertainty.
//

import { motion } from "framer-motion";
import { Crosshair, Gauge, Loader2, Target, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Tooltip as UITooltip,
} from "@/components/ui/tooltip";
import { useCalibrationMetrics } from "@/hooks/use-intelligence";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface CalibrationDisplayProps {
  organizationId: string;
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getBrierScoreColor(score: number): string {
  // Brier score: 0 is perfect, 1 is worst
  if (score <= 0.1) {
    return "text-green-500";
  }
  if (score <= 0.25) {
    return "text-amber-500";
  }
  return "text-red-500";
}

function getBrierScoreLabel(score: number): string {
  if (score <= 0.1) {
    return "Excellent";
  }
  if (score <= 0.2) {
    return "Good";
  }
  if (score <= 0.3) {
    return "Fair";
  }
  return "Needs Improvement";
}

function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 0.8) {
    return "#22c55e"; // green
  }
  if (accuracy >= 0.6) {
    return "#f59e0b"; // amber
  }
  return "#ef4444"; // red
}

// =============================================================================
// METRIC CARD COMPONENT
// =============================================================================

interface MetricCardProps {
  label: string;
  value: number;
  description: string;
  icon: React.ElementType;
  maxValue?: number;
  format?: "percentage" | "decimal";
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  maxValue = 1,
  format = "decimal",
}: MetricCardProps) {
  const percentage = Math.round((value / maxValue) * 100);
  const displayValue =
    format === "percentage" ? `${Math.round(value * 100)}%` : value.toFixed(3);

  return (
    <TooltipProvider>
      <UITooltip>
        <TooltipTrigger asChild>
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border bg-card p-4"
            initial={{ opacity: 0, y: 10 }}
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground text-xs">{label}</p>
                <p className="font-bold text-xl">{displayValue}</p>
              </div>
            </div>
            <Progress className="mt-3 h-2" value={percentage} />
          </motion.div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{description}</p>
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function CalibrationDisplay({
  organizationId,
  className,
}: CalibrationDisplayProps) {
  const { data, isLoading } = useCalibrationMetrics({ organizationId });

  const typeData = useMemo(() => {
    if (!data?.calibration_by_type) {
      return [];
    }
    return Object.entries(data.calibration_by_type)
      .map(([type, stats]) => ({
        type: type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        count: stats.count,
        accuracy: stats.accuracy,
        fill: getAccuracyColor(stats.accuracy),
      }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-blue-500" />
            AI Calibration
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

  if (!data || data.total_predictions === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-blue-500" />
            AI Calibration
          </CardTitle>
          <CardDescription>DiBello&apos;s Strategic Rehearsal</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Target className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm">
              No calibration data available yet.
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              Predictions will be tracked as intelligence is processed.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const brierScoreLabel = getBrierScoreLabel(data.brier_score);
  const brierScoreColor = getBrierScoreColor(data.brier_score);
  const evaluationRate =
    data.total_predictions > 0
      ? Math.round((data.evaluated_predictions / data.total_predictions) * 100)
      : 0;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crosshair className="h-5 w-5 text-blue-500" />
          AI Calibration
          <Badge
            className={cn(
              "ml-2",
              data.brier_score <= 0.15
                ? "border-green-500/30 bg-green-500/10 text-green-600"
                : data.brier_score <= 0.25
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
                  : "border-red-500/30 bg-red-500/10 text-red-600"
            )}
            variant="outline"
          >
            {brierScoreLabel}
          </Badge>
        </CardTitle>
        <CardDescription>
          DiBello&apos;s Strategic Rehearsal - Confidence calibration tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Brier Score Overview */}
        <div className="flex items-center justify-between rounded-xl bg-muted/50 p-4">
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">Brier Score</p>
            <p className={cn("font-bold text-3xl", brierScoreColor)}>
              {data.brier_score.toFixed(3)}
            </p>
            <p className="text-muted-foreground text-xs">
              Lower is better (0 = perfect)
            </p>
          </div>
          <div className="text-right">
            <p className="font-medium text-sm">
              {data.total_predictions} predictions
            </p>
            <p className="text-muted-foreground text-xs">
              {evaluationRate}% evaluated
            </p>
          </div>
        </div>

        {/* Score Decomposition */}
        <div>
          <h4 className="mb-3 font-medium text-sm">Score Decomposition</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              description="How close predicted probabilities are to actual outcomes. Lower is better."
              format="decimal"
              icon={Target}
              label="Reliability"
              maxValue={0.5}
              value={data.reliability}
            />
            <MetricCard
              description="How much predictions vary from base rate. Higher is better."
              format="decimal"
              icon={TrendingUp}
              label="Resolution"
              maxValue={0.5}
              value={data.resolution}
            />
            <MetricCard
              description="Base rate variance in the data. Not controllable."
              format="decimal"
              icon={Gauge}
              label="Uncertainty"
              maxValue={0.5}
              value={data.uncertainty}
            />
          </div>
        </div>

        {/* Accuracy by Type */}
        {typeData.length > 0 && (
          <div>
            <h4 className="mb-3 font-medium text-sm">Accuracy by Type</h4>
            <div className="h-[200px] w-full">
              <ResponsiveContainer height="100%" width="100%">
                <BarChart
                  data={typeData}
                  layout="vertical"
                  margin={{ left: 100, right: 20 }}
                >
                  <CartesianGrid
                    className="stroke-muted"
                    horizontal={false}
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    axisLine={false}
                    domain={[0, 1]}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `${Math.round(value * 100)}%`}
                    tickLine={false}
                    type="number"
                  />
                  <YAxis
                    axisLine={false}
                    dataKey="type"
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    type="category"
                    width={90}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!(active && payload?.length)) {
                        return null;
                      }
                      const data = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <p className="font-medium">{data.type}</p>
                          <p className="text-muted-foreground text-sm">
                            {Math.round(data.accuracy * 100)}% accuracy
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {data.count} predictions
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="accuracy" radius={[0, 4, 4, 0]}>
                    {typeData.map((entry) => (
                      <Cell fill={entry.fill} key={entry.type} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Interpretation */}
        <div className="rounded-lg border border-dashed p-4">
          <h4 className="mb-2 font-medium text-sm">
            Understanding Calibration
          </h4>
          <ul className="space-y-2 text-muted-foreground text-sm">
            <li>
              <strong>Reliability:</strong> When the AI says 80% confidence, it
              should be correct ~80% of the time.
            </li>
            <li>
              <strong>Resolution:</strong> Higher values mean the AI
              distinguishes well between likely and unlikely outcomes.
            </li>
            <li>
              <strong>Uncertainty:</strong> Inherent unpredictability in the
              data - not something to optimize.
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export default CalibrationDisplay;
