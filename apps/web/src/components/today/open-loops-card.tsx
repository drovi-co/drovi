// =============================================================================
// OPEN LOOPS CARD COMPONENT
// =============================================================================
//
// Shows unanswered questions and pending items that need follow-up.
// Visual staleness indicators show how long items have been waiting.
//

import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Clock,
  HelpCircle,
  MessageCircleQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface OpenLoop {
  id: string;
  type:
    | "unanswered_question"
    | "pending_request"
    | "unfulfilled_promise"
    | "awaiting_response";
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
  if (!age) {
    return "text-muted-foreground";
  }
  if (age > 7) {
    return "text-red-500";
  }
  if (age > 3) {
    return "text-amber-500";
  }
  return "text-muted-foreground";
}

export function OpenLoopsCard({ loops, onLoopClick }: OpenLoopsCardProps) {
  const displayLoops = loops.slice(0, 5);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border bg-card"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.2 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-amber-500/10 p-1.5">
            <HelpCircle className="h-4 w-4 text-amber-500" />
          </div>
          <h3 className="font-semibold text-sm">Open Loops</h3>
          {displayLoops.length > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-medium text-amber-700 text-xs dark:text-amber-400">
              {loops.length}
            </span>
          )}
        </div>
        <Link to="/dashboard/inbox">
          <Button className="h-7 text-xs" size="sm" variant="ghost">
            View All
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>

      {/* Content */}
      <div className="divide-y">
        {displayLoops.length === 0 ? (
          <div className="p-6 text-center">
            <MessageCircleQuestion className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">No open loops</p>
            <p className="mt-1 text-muted-foreground text-xs">
              All questions answered, all promises fulfilled
            </p>
          </div>
        ) : (
          displayLoops.map((loop, index) => (
            <motion.button
              animate={{ opacity: 1, x: 0 }}
              className="group w-full p-3 text-left transition-colors hover:bg-muted/30"
              initial={{ opacity: 0, x: -10 }}
              key={loop.id}
              onClick={() =>
                loop.sourceThreadId && onLoopClick?.(loop.sourceThreadId)
              }
              transition={{ delay: index * 0.05 }}
            >
              <div className="flex items-start gap-3">
                {/* Type icon */}
                <div className="mt-0.5 flex-shrink-0 rounded-lg bg-muted p-1.5">
                  {getLoopTypeIcon(loop.type)}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-xs">
                      {getLoopTypeLabel(loop.type)}
                    </span>
                    {loop.priority === "high" && (
                      <span className="font-medium text-red-500 text-xs">
                        High priority
                      </span>
                    )}
                  </div>

                  <p className="line-clamp-2 text-sm">
                    {loop.sourceQuotedText || loop.description}
                  </p>

                  <div className="mt-1.5 flex items-center gap-3">
                    {loop.owner && (
                      <span className="text-muted-foreground text-xs">
                        From {loop.owner}
                      </span>
                    )}
                    {loop.age !== null && loop.age !== undefined && (
                      <span
                        className={`text-xs ${getStalenessClass(loop.age)}`}
                      >
                        {loop.age} day{loop.age !== 1 ? "s" : ""} ago
                      </span>
                    )}
                    {loop.createdAt && !loop.age && (
                      <span className="text-muted-foreground text-xs">
                        {formatDistanceToNow(loop.createdAt, {
                          addSuffix: true,
                        })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Staleness indicator */}
                {loop.age && loop.age > 3 && (
                  <div
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${
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
