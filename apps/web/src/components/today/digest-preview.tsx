// =============================================================================
// DIGEST PREVIEW COMPONENT
// =============================================================================
//
// Shows quick stats and health metrics for the week.
// Preview of the daily digest.
//

import { motion } from "framer-motion";
import {
  BarChart3,
  CheckCircle2,
  Mail,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

interface DigestStats {
  emailsProcessed: number;
  commitmentsTracked: number;
  decisionsRecorded: number;
  avgResponseTime?: number; // hours
  prevAvgResponseTime?: number; // hours, for comparison
}

interface DigestPreviewProps {
  stats: DigestStats;
}

function TrendIndicator({
  current,
  previous,
}: {
  current?: number;
  previous?: number;
}) {
  if (!(current && previous)) {
    return null;
  }

  const diff = ((previous - current) / previous) * 100;
  const isImproving = diff > 0;

  if (Math.abs(diff) < 5) {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs ${
        isImproving ? "text-green-500" : "text-red-500"
      }`}
    >
      {isImproving ? (
        <TrendingDown className="h-3 w-3" />
      ) : (
        <TrendingUp className="h-3 w-3" />
      )}
      {Math.abs(Math.round(diff))}%
    </span>
  );
}

export function DigestPreview({ stats }: DigestPreviewProps) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border bg-gradient-to-r from-muted/50 via-muted/30 to-muted/50 p-4"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.5 }}
    >
      <div className="mb-3 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-muted-foreground text-sm uppercase tracking-wider">
          This Week
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {/* Emails processed */}
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-background p-2">
            <Mail className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <p className="font-bold text-xl">{stats.emailsProcessed}</p>
            <p className="text-muted-foreground text-xs">Emails processed</p>
          </div>
        </div>

        {/* Commitments tracked */}
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-background p-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </div>
          <div>
            <p className="font-bold text-xl">{stats.commitmentsTracked}</p>
            <p className="text-muted-foreground text-xs">Commitments tracked</p>
          </div>
        </div>

        {/* Decisions recorded */}
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-background p-2">
            <Target className="h-4 w-4 text-purple-500" />
          </div>
          <div>
            <p className="font-bold text-xl">{stats.decisionsRecorded}</p>
            <p className="text-muted-foreground text-xs">Decisions recorded</p>
          </div>
        </div>

        {/* Response time */}
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-background p-2">
            <TrendingUp className="h-4 w-4 text-amber-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-xl">
                {stats.avgResponseTime
                  ? `${stats.avgResponseTime.toFixed(1)}h`
                  : "N/A"}
              </p>
              <TrendIndicator
                current={stats.avgResponseTime}
                previous={stats.prevAvgResponseTime}
              />
            </div>
            <p className="text-muted-foreground text-xs">Avg response time</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
