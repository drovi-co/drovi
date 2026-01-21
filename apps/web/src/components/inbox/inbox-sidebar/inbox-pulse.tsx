// =============================================================================
// INBOX PULSE COMPONENT
// =============================================================================
//
// Quick stats visualization showing inbox health metrics.
// Displays unread, starred, urgent counts with response time.
//

import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Mail,
  Minus,
  Star,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface InboxStats {
  unread: number;
  starred: number;
  urgent: number;
  avgResponseTimeHours?: number;
  responseTrend?: "faster" | "slower" | "stable";
}

interface InboxPulseProps {
  stats: InboxStats;
  className?: string;
}

function StatItem({
  icon: Icon,
  label,
  value,
  color,
  index,
}: {
  icon: typeof Mail;
  label: string;
  value: number;
  color: string;
  index: number;
}) {
  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center gap-1"
      initial={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: 0.2 + index * 0.05 }}
    >
      <div className={cn("rounded-lg p-1.5", color)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <span className="font-medium text-base tabular-nums">{value}</span>
      <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
        {label}
      </span>
    </motion.div>
  );
}

function TrendIndicator({
  trend,
  responseTime,
}: {
  trend: "faster" | "slower" | "stable";
  responseTime?: number;
}) {
  const config = {
    faster: {
      icon: ArrowDown,
      color: "text-emerald-600/70 dark:text-emerald-400/70",
      label: "Faster than usual",
    },
    slower: {
      icon: ArrowUp,
      color: "text-amber-600/70 dark:text-amber-400/70",
      label: "Slower than usual",
    },
    stable: {
      icon: Minus,
      color: "text-muted-foreground",
      label: "About average",
    },
  };

  const { icon: TrendIcon, color, label } = config[trend];

  return (
    <div className="flex items-center justify-center gap-2">
      <TrendIcon className={cn("h-3 w-3", color)} />
      <span className="text-muted-foreground text-xs">
        {responseTime !== undefined && (
          <span className="font-medium text-foreground">
            {responseTime < 1
              ? `${Math.round(responseTime * 60)}m`
              : `${responseTime.toFixed(1)}h`}
          </span>
        )}{" "}
        avg response · {label}
      </span>
    </div>
  );
}

export function InboxPulse({ stats, className }: InboxPulseProps) {
  const hasActivity = stats.unread > 0 || stats.starred > 0 || stats.urgent > 0;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn("overflow-hidden rounded-xl border bg-card", className)}
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.2 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1">
            <Activity className="h-3.5 w-3.5 text-primary-foreground/60" />
          </div>
          <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
            Inbox Pulse
          </h4>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Stats grid */}
        <div className="mb-4 grid grid-cols-3 gap-2">
          <StatItem
            color="bg-indigo-500/10 text-indigo-600/80 dark:text-indigo-400/80"
            icon={Mail}
            index={0}
            label="Unread"
            value={stats.unread}
          />
          <StatItem
            color="bg-amber-500/10 text-amber-600/80 dark:text-amber-400/80"
            icon={Star}
            index={1}
            label="Starred"
            value={stats.starred}
          />
          <StatItem
            color="bg-rose-500/10 text-rose-600/80 dark:text-rose-400/80"
            icon={AlertCircle}
            index={2}
            label="Urgent"
            value={stats.urgent}
          />
        </div>

        {/* Visual bar */}
        <div className="mb-3 flex h-1 overflow-hidden rounded-full bg-muted">
          {hasActivity && (
            <>
              <motion.div
                animate={{ width: `${Math.min((stats.unread / 50) * 100, 60)}%` }}
                className="bg-indigo-400/60 dark:bg-indigo-500/50"
                initial={{ width: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
              />
              <motion.div
                animate={{
                  width: `${Math.min((stats.starred / 20) * 100, 25)}%`,
                }}
                className="bg-amber-400/60 dark:bg-amber-500/50"
                initial={{ width: 0 }}
                transition={{ delay: 0.35, duration: 0.5 }}
              />
              <motion.div
                animate={{ width: `${Math.min((stats.urgent / 10) * 100, 15)}%` }}
                className="bg-rose-400/60 dark:bg-rose-500/50"
                initial={{ width: 0 }}
                transition={{ delay: 0.4, duration: 0.5 }}
              />
            </>
          )}
        </div>

        {/* Response time */}
        {stats.responseTrend && (
          <TrendIndicator
            responseTime={stats.avgResponseTimeHours}
            trend={stats.responseTrend}
          />
        )}

        {/* Zero inbox celebration */}
        {!hasActivity && (
          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary/10 py-2"
            initial={{ opacity: 0, scale: 0.9 }}
            transition={{ delay: 0.3 }}
          >
            <Zap className="h-4 w-4 text-emerald-600/70 dark:text-emerald-400/70" />
            <span className="font-medium text-emerald-600/80 text-sm dark:text-emerald-400/80">
              Inbox Zero!
            </span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
