// =============================================================================
// GREETING HEADER COMPONENT
// =============================================================================
//
// Personalized greeting with time-aware message and AI-generated summary
// of what needs attention today.
//

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { format } from "date-fns";

interface GreetingHeaderProps {
  userName?: string;
  overdueCount: number;
  decisionsCount: number;
  atRiskCount: number;
  openLoopsCount: number;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function buildSummaryLine(
  overdueCount: number,
  decisionsCount: number,
  atRiskCount: number,
  openLoopsCount: number
): string {
  const parts: string[] = [];

  if (overdueCount > 0) {
    parts.push(`${overdueCount} commitment${overdueCount > 1 ? "s" : ""} overdue`);
  }
  if (decisionsCount > 0) {
    parts.push(`${decisionsCount} recent decision${decisionsCount > 1 ? "s" : ""}`);
  }
  if (atRiskCount > 0) {
    parts.push(`${atRiskCount} relationship${atRiskCount > 1 ? "s" : ""} at risk`);
  }
  if (openLoopsCount > 0) {
    parts.push(`${openLoopsCount} open loop${openLoopsCount > 1 ? "s" : ""}`);
  }

  if (parts.length === 0) {
    return "All caught up! Your inbox is under control.";
  }

  return parts.join(" \u2022 ");
}

export function GreetingHeader({
  userName,
  overdueCount,
  decisionsCount,
  atRiskCount,
  openLoopsCount,
}: GreetingHeaderProps) {
  const greeting = getGreeting();
  const firstName = userName?.split(" ")[0] ?? "there";
  const today = format(new Date(), "EEEE, MMMM d, yyyy");
  const summary = buildSummaryLine(overdueCount, decisionsCount, atRiskCount, openLoopsCount);

  const hasUrgent = overdueCount > 0 || atRiskCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary/10 via-background to-background border p-6 mb-6"
    >
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-primary/5 to-transparent rounded-full blur-3xl" />
      <div className="absolute -bottom-8 -left-8 w-48 h-48 bg-gradient-to-tr from-accent/10 to-transparent rounded-full blur-2xl" />

      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <motion.h1
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="text-3xl font-bold tracking-tight"
            >
              {greeting}, {firstName}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="text-muted-foreground"
            >
              {today}
            </motion.p>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            className="flex items-center gap-2 text-xs bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-full border"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">Intelligence Summary</span>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className={`mt-4 flex items-center gap-2 text-sm ${
            hasUrgent ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          }`}
        >
          {hasUrgent && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
          )}
          <span className="font-medium">{summary}</span>
        </motion.div>
      </div>
    </motion.div>
  );
}
