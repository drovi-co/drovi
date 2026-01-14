// =============================================================================
// OPEN LOOPS CARD COMPONENT
// =============================================================================
//
// Shows unanswered questions and pending items that need follow-up.
// Visual staleness indicators show how long items have been waiting.
//

import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  HelpCircle,
  MessageCircleQuestion,
  Clock,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

interface OpenLoop {
  id: string;
  type: "unanswered_question" | "pending_request" | "unfulfilled_promise" | "awaiting_response";
  description: string;
  owner?: string | null;
  sourceMessageId?: string;
  sourceThreadId?: string;
  sourceQuotedText?: string;
  age?: number | null; // days
  priority?: "low" | "medium" | "high" | null;
  createdAt?: Date;
}

interface OpenLoopsCardProps {
  loops: OpenLoop[];
  onLoopClick?: (threadId: string) => void;
}

function getLoopTypeIcon(type: OpenLoop["type"]) {
  switch (type) {
    case "unanswered_question":
      return <MessageCircleQuestion className="h-4 w-4" />;
    case "pending_request":
      return <Clock className="h-4 w-4" />;
    case "unfulfilled_promise":
      return <HelpCircle className="h-4 w-4" />;
    case "awaiting_response":
      return <MessageCircleQuestion className="h-4 w-4" />;
    default:
      return <HelpCircle className="h-4 w-4" />;
  }
}

function getLoopTypeLabel(type: OpenLoop["type"]) {
  switch (type) {
    case "unanswered_question":
      return "Question";
    case "pending_request":
      return "Request";
    case "unfulfilled_promise":
      return "Promise";
    case "awaiting_response":
      return "Waiting";
    default:
      return "Loop";
  }
}

function getStalenessClass(age?: number | null) {
  if (!age) return "text-muted-foreground";
  if (age > 7) return "text-red-500";
  if (age > 3) return "text-amber-500";
  return "text-muted-foreground";
}

export function OpenLoopsCard({ loops, onLoopClick }: OpenLoopsCardProps) {
  const displayLoops = loops.slice(0, 5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-card rounded-xl border overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/10">
            <HelpCircle className="h-4 w-4 text-amber-500" />
          </div>
          <h3 className="font-semibold text-sm">Open Loops</h3>
          {displayLoops.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-700 dark:text-amber-400">
              {loops.length}
            </span>
          )}
        </div>
        <Link to="/dashboard/email">
          <Button variant="ghost" size="sm" className="text-xs h-7">
            View All
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>

      {/* Content */}
      <div className="divide-y">
        {displayLoops.length === 0 ? (
          <div className="p-6 text-center">
            <MessageCircleQuestion className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No open loops</p>
            <p className="text-xs text-muted-foreground mt-1">
              All questions answered, all promises fulfilled
            </p>
          </div>
        ) : (
          displayLoops.map((loop, index) => (
            <motion.button
              key={loop.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => loop.sourceThreadId && onLoopClick?.(loop.sourceThreadId)}
              className="w-full p-3 hover:bg-muted/30 transition-colors text-left group"
            >
              <div className="flex items-start gap-3">
                {/* Type icon */}
                <div className="mt-0.5 p-1.5 rounded-lg bg-muted flex-shrink-0">
                  {getLoopTypeIcon(loop.type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-muted">
                      {getLoopTypeLabel(loop.type)}
                    </span>
                    {loop.priority === "high" && (
                      <span className="text-xs font-medium text-red-500">High priority</span>
                    )}
                  </div>

                  <p className="text-sm line-clamp-2">
                    {loop.sourceQuotedText || loop.description}
                  </p>

                  <div className="flex items-center gap-3 mt-1.5">
                    {loop.owner && (
                      <span className="text-xs text-muted-foreground">
                        From {loop.owner}
                      </span>
                    )}
                    {loop.age !== null && loop.age !== undefined && (
                      <span className={`text-xs ${getStalenessClass(loop.age)}`}>
                        {loop.age} day{loop.age !== 1 ? "s" : ""} ago
                      </span>
                    )}
                    {loop.createdAt && !loop.age && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(loop.createdAt, { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Staleness indicator */}
                {loop.age && loop.age > 3 && (
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      loop.age > 7 ? "bg-red-500" : "bg-amber-500"
                    }`}
                  />
                )}
              </div>
            </motion.button>
          ))
        )}
      </div>
    </motion.div>
  );
}
