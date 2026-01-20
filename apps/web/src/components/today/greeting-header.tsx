// =============================================================================
// GREETING HEADER COMPONENT
// =============================================================================
//
// Personalized greeting with time-aware message and AI-generated summary
// of what needs attention today.
//

import { format } from "date-fns";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

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
    parts.push(
      `${overdueCount} commitment${overdueCount > 1 ? "s" : ""} overdue`
    );
  }
  if (decisionsCount > 0) {
    parts.push(
      `${decisionsCount} recent decision${decisionsCount > 1 ? "s" : ""}`
    );
  }
  if (atRiskCount > 0) {
    parts.push(
      `${atRiskCount} relationship${atRiskCount > 1 ? "s" : ""} at risk`
    );
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
  const summary = buildSummaryLine(
    overdueCount,
    decisionsCount,
    atRiskCount,
    openLoopsCount
  );

  const hasUrgent = overdueCount > 0 || atRiskCount > 0;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="relative mb-6 overflow-hidden rounded-xl border bg-gradient-to-br from-primary/10 via-background to-background p-6"
      initial={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5 }}
    >
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 h-64 w-64 rounded-full bg-gradient-to-bl from-primary/5 to-transparent blur-3xl" />
      <div className="absolute -bottom-8 -left-8 h-48 w-48 rounded-full bg-gradient-to-tr from-accent/10 to-transparent blur-2xl" />

      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <motion.h1
              animate={{ opacity: 1, x: 0 }}
              className="font-bold text-3xl tracking-tight"
              initial={{ opacity: 0, x: -10 }}
              transition={{ delay: 0.2 }}
            >
              {greeting}, {firstName}
            </motion.h1>
            <motion.p
              animate={{ opacity: 1, x: 0 }}
              className="text-muted-foreground"
              initial={{ opacity: 0, x: -10 }}
              transition={{ delay: 0.3 }}
            >
              {today}
            </motion.p>
          </div>

          <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1.5 text-xs backdrop-blur-sm"
            initial={{ opacity: 0, scale: 0.8 }}
            transition={{ delay: 0.4 }}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">Intelligence Summary</span>
          </motion.div>
        </div>

        <motion.div
          animate={{ opacity: 1 }}
          className={`mt-4 flex items-center gap-2 text-sm ${
            hasUrgent
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
          initial={{ opacity: 0 }}
          transition={{ delay: 0.5 }}
        >
          {hasUrgent && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
          )}
          <span className="font-medium">{summary}</span>
        </motion.div>
      </div>
    </motion.div>
  );
}
