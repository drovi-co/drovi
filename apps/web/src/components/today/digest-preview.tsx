// =============================================================================
// DIGEST PREVIEW COMPONENT
// =============================================================================
//
// Shows quick stats and health metrics for the week.
// Preview of the daily digest.
//

import { motion } from "framer-motion";
import { BarChart3, Mail, CheckCircle2, Target, TrendingUp, TrendingDown } from "lucide-react";

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

function TrendIndicator({ current, previous }: { current?: number; previous?: number }) {
  if (!current || !previous) return null;

  const diff = ((previous - current) / previous) * 100;
  const isImproving = diff > 0;

  if (Math.abs(diff) < 5) return null;

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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-gradient-to-r from-muted/50 via-muted/30 to-muted/50 rounded-xl border p-4"
    >
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          This Week
        </h3>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Emails processed */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-background">
            <Mail className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <p className="text-xl font-bold">{stats.emailsProcessed}</p>
            <p className="text-xs text-muted-foreground">Emails processed</p>
          </div>
        </div>

        {/* Commitments tracked */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-background">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </div>
          <div>
            <p className="text-xl font-bold">{stats.commitmentsTracked}</p>
            <p className="text-xs text-muted-foreground">Commitments tracked</p>
          </div>
        </div>

        {/* Decisions recorded */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-background">
            <Target className="h-4 w-4 text-purple-500" />
          </div>
          <div>
            <p className="text-xl font-bold">{stats.decisionsRecorded}</p>
            <p className="text-xs text-muted-foreground">Decisions recorded</p>
          </div>
        </div>

        {/* Response time */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-background">
            <TrendingUp className="h-4 w-4 text-amber-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xl font-bold">
                {stats.avgResponseTime ? `${stats.avgResponseTime.toFixed(1)}h` : "N/A"}
              </p>
              <TrendIndicator
                current={stats.avgResponseTime}
                previous={stats.prevAvgResponseTime}
              />
            </div>
            <p className="text-xs text-muted-foreground">Avg response time</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
