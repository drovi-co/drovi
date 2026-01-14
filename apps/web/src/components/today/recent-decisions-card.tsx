// =============================================================================
// RECENT DECISIONS CARD COMPONENT
// =============================================================================
//
// Shows key decisions from the past week with topic tags.
// Quick access to decision log.
//

import { motion } from "framer-motion";
import { format } from "date-fns";
import { ArrowRight, BookOpen, CheckSquare } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  const hash = topicId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="bg-card rounded-xl border overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-purple-500/10">
            <BookOpen className="h-4 w-4 text-purple-500" />
          </div>
          <h3 className="font-semibold text-sm">Recent Decisions</h3>
          {displayDecisions.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-700 dark:text-purple-400">
              {decisions.length}
            </span>
          )}
        </div>
        <Link to="/dashboard/decisions">
          <Button variant="ghost" size="sm" className="text-xs h-7">
            Decision Log
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>

      {/* Content */}
      <div className="divide-y">
        {displayDecisions.length === 0 ? (
          <div className="p-6 text-center">
            <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No recent decisions</p>
            <p className="text-xs text-muted-foreground mt-1">
              Decisions will appear as they're extracted from your emails
            </p>
          </div>
        ) : (
          displayDecisions.map((decision, index) => (
            <motion.button
              key={decision.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => onDecisionClick?.(decision.id)}
              className="w-full p-3 hover:bg-muted/30 transition-colors text-left group"
            >
              <div className="flex items-start gap-3">
                {/* Check icon */}
                <div className="mt-0.5 flex-shrink-0">
                  <CheckSquare className="h-4 w-4 text-purple-500" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm line-clamp-1">{decision.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {decision.statement}
                  </p>

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(decision.decidedAt), "MMM d")}
                    </span>

                    {decision.owners && decision.owners.length > 0 && (
                      <>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">
                          {decision.owners[0]?.displayName ||
                            decision.owners[0]?.primaryEmail ||
                            "Unknown"}
                        </span>
                      </>
                    )}

                    {/* Confidence indicator */}
                    <div className="flex items-center gap-1 ml-auto">
                      <div className="h-1.5 w-12 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full"
                          style={{ width: `${decision.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
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
