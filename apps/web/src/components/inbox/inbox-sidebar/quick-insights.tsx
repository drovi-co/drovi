// =============================================================================
// QUICK INSIGHTS COMPONENT
// =============================================================================
//
// AI-powered insights showing open loops, decisions, active contacts.
// Each insight is clickable and navigates to relevant view.
//

import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Clock,
  HelpCircle,
  Lightbulb,
  Sparkles,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface Insight {
  id: string;
  type: "open_loops" | "decisions" | "active_contact" | "stale_threads" | "trend";
  title: string;
  count?: number;
  link?: string;
  color: "amber" | "purple" | "blue" | "red" | "green";
}

interface QuickInsightsProps {
  insights: Insight[];
  onInsightClick?: (insight: Insight) => void;
  maxVisible?: number;
  className?: string;
}

function getInsightIcon(type: Insight["type"]) {
  switch (type) {
    case "open_loops":
      return HelpCircle;
    case "decisions":
      return Star;
    case "active_contact":
      return Users;
    case "stale_threads":
      return Clock;
    case "trend":
      return TrendingUp;
    default:
      return Lightbulb;
  }
}

function getInsightColor(color: Insight["color"]) {
  switch (color) {
    case "amber":
      return {
        bg: "bg-amber-500/10",
        text: "text-amber-600/70 dark:text-amber-400/70",
        badge: "bg-amber-500/15 text-amber-600/80 dark:text-amber-400/80",
      };
    case "purple":
      return {
        bg: "bg-violet-500/10",
        text: "text-violet-600/70 dark:text-violet-400/70",
        badge: "bg-violet-500/15 text-violet-600/80 dark:text-violet-400/80",
      };
    case "blue":
      return {
        bg: "bg-indigo-500/10",
        text: "text-indigo-600/70 dark:text-indigo-400/70",
        badge: "bg-indigo-500/15 text-indigo-600/80 dark:text-indigo-400/80",
      };
    case "red":
      return {
        bg: "bg-rose-500/10",
        text: "text-rose-600/70 dark:text-rose-400/70",
        badge: "bg-rose-500/15 text-rose-600/80 dark:text-rose-400/80",
      };
    case "green":
      return {
        bg: "bg-emerald-500/10",
        text: "text-emerald-600/70 dark:text-emerald-400/70",
        badge: "bg-emerald-500/15 text-emerald-600/80 dark:text-emerald-400/80",
      };
    default:
      return {
        bg: "bg-muted",
        text: "text-muted-foreground",
        badge: "bg-muted text-muted-foreground",
      };
  }
}

function InsightItem({
  insight,
  onClick,
  index,
}: {
  insight: Insight;
  onClick?: (insight: Insight) => void;
  index: number;
}) {
  const Icon = getInsightIcon(insight.type);
  const colors = getInsightColor(insight.color);

  const content = (
    <motion.div
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
        "hover:bg-muted/50",
        insight.link && "cursor-pointer"
      )}
      initial={{ opacity: 0, x: -10 }}
      onClick={() => !insight.link && onClick?.(insight)}
      transition={{ delay: index * 0.03 }}
    >
      {/* Icon */}
      <div className={cn("shrink-0 rounded-lg p-1.5", colors.bg)}>
        <Icon className={cn("h-3.5 w-3.5", colors.text)} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{insight.title}</p>
      </div>

      {/* Count badge or arrow */}
      {insight.count !== undefined ? (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[10px]",
            colors.badge
          )}
        >
          {insight.count}
        </span>
      ) : (
        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </motion.div>
  );

  if (insight.link) {
    return (
      <Link key={insight.id} to={insight.link}>
        {content}
      </Link>
    );
  }

  return <div key={insight.id}>{content}</div>;
}

export function QuickInsights({
  insights,
  onInsightClick,
  maxVisible = 3,
  className,
}: QuickInsightsProps) {
  const visibleInsights = insights.slice(0, maxVisible);

  if (visibleInsights.length === 0) {
    return null;
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn("overflow-hidden rounded-xl border bg-card", className)}
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.25 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1">
            <Sparkles className="h-3.5 w-3.5 text-primary-foreground/60" />
          </div>
          <h4 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
            Insights
          </h4>
        </div>
      </div>

      {/* Content */}
      <div className="divide-y divide-border/50">
        {visibleInsights.map((insight, index) => (
          <InsightItem
            index={index}
            insight={insight}
            key={insight.id}
            onClick={onInsightClick}
          />
        ))}
      </div>
    </motion.div>
  );
}
