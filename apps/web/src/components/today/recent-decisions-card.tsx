// =============================================================================
// RECENT DECISIONS CARD COMPONENT
// =============================================================================
//
// Shows key decisions from the past week with topic tags.
// Quick access to decision log.
//

import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Decision {
  id: string;
  title: string;
  statement: string;
  rationale?: string | null;
  decidedAt: Date;
  confidence: number;
  topicIds?: string[] | null;
  sourceThread?: {
    id: string;
    subject?: string | null;
  } | null;
  owners?: Array<{
    displayName?: string | null;
    primaryEmail?: string;
  }>;
}

interface RecentDecisionsCardProps {
  decisions: Decision[];
  onDecisionClick?: (id: string) => void;
  onThreadClick?: (threadId: string) => void;
}

// Topic color mapping (simple hash-based)
function getTopicColor(topicId: string): string {
  const colors = [
    "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    "bg-green-500/10 text-green-700 dark:text-green-400",
    "bg-pink-500/10 text-pink-700 dark:text-pink-400",
    "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  ];
  const hash = topicId
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export function RecentDecisionsCard({
  decisions,
  onDecisionClick,
  onThreadClick,
}: RecentDecisionsCardProps) {
  const displayDecisions = decisions.slice(0, 5);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border bg-card"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.3 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-purple-500/10 p-1.5">
            <BookOpen className="h-4 w-4 text-purple-500" />
          </div>
          <h3 className="font-semibold text-sm">Recent Decisions</h3>
          {displayDecisions.length > 0 && (
            <span className="rounded-full bg-purple-500/20 px-2 py-0.5 font-medium text-purple-700 text-xs dark:text-purple-400">
              {decisions.length}
            </span>
          )}
        </div>
        <Link to="/dashboard/decisions">
          <Button className="h-7 text-xs" size="sm" variant="ghost">
            Decision Log
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>

      {/* Content */}
      <div className="divide-y">
        {displayDecisions.length === 0 ? (
          <div className="p-6 text-center">
            <BookOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No recent decisions</p>
            <p className="mt-1 text-muted-foreground text-xs">
              Decisions will appear as they're extracted from your emails
            </p>
          </div>
        ) : (
          displayDecisions.map((decision, index) => (
            <motion.button
              animate={{ opacity: 1, x: 0 }}
              className="group w-full p-3 text-left transition-colors hover:bg-muted/30"
              initial={{ opacity: 0, x: -10 }}
              key={decision.id}
              onClick={() => onDecisionClick?.(decision.id)}
              transition={{ delay: index * 0.05 }}
            >
              <div className="flex items-start gap-3">
                {/* Check icon */}
                <div className="mt-0.5 flex-shrink-0">
                  <CheckSquare className="h-4 w-4 text-purple-500" />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 font-medium text-sm">
                    {decision.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
                    {decision.statement}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      {format(new Date(decision.decidedAt), "MMM d")}
                    </span>

                    {decision.owners && decision.owners.length > 0 && (
                      <>
                        <span className="text-muted-foreground text-xs">•</span>
                        <span className="text-muted-foreground text-xs">
                          {decision.owners[0]?.displayName ||
                            decision.owners[0]?.primaryEmail ||
                            "Unknown"}
                        </span>
                      </>
                    )}

                    {/* Confidence indicator */}
                    <div className="ml-auto flex items-center gap-1">
                      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-purple-500"
                          style={{ width: `${decision.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {Math.round(decision.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.button>
          ))
        )}
      </div>
    </motion.div>
  );
}
