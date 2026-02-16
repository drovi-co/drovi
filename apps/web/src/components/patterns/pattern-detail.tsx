// =============================================================================
// PATTERN DETAIL COMPONENT
// =============================================================================
//
// Full detail view for recognition patterns using Klein's RPD framework.
// Shows salient features, expectations, action, goals, and match history.
//

import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@memorystack/ui-core/collapsible";
import { ScrollArea } from "@memorystack/ui-core/scroll-area";
import { Separator } from "@memorystack/ui-core/separator";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@memorystack/ui-core/sheet";
import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Eye,
  Lightbulb,
  Loader2,
  Target,
  ThumbsDown,
  ThumbsUp,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Pattern } from "./pattern-card";

// =============================================================================
// TYPES
// =============================================================================

interface PatternMatch {
  id: string;
  episodeId: string;
  episodeTitle: string;
  matchedAt: string;
  confidence: number;
  wasCorrect: boolean | null;
  userFeedback: string | null;
}

interface PatternDetailProps {
  pattern: Pattern;
  matches?: PatternMatch[];
  isLoadingMatches?: boolean;
  onConfirmMatch?: (matchId: string) => void;
  onRejectMatch?: (matchId: string, reason?: string) => void;
  onClose?: () => void;
}

// =============================================================================
// SECTION COMPONENT
// =============================================================================

interface SectionProps {
  title: string;
  icon: React.ElementType;
  iconColor?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({
  title,
  icon: Icon,
  iconColor = "text-muted-foreground",
  children,
  defaultOpen = true,
}: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible onOpenChange={setIsOpen} open={isOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="flex w-full items-center justify-between rounded-lg p-2 transition-colors hover:bg-muted/50"
          type="button"
        >
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4", iconColor)} />
            <span className="font-medium text-sm">{title}</span>
          </div>
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-2 pt-2 pb-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// =============================================================================
// MATCH CARD COMPONENT
// =============================================================================

interface MatchCardProps {
  match: PatternMatch;
  onConfirm?: () => void;
  onReject?: () => void;
}

function MatchCard({ match, onConfirm, onReject }: MatchCardProps) {
  return (
    <motion.div
      animate={{ opacity: 1, x: 0 }}
      className="rounded-lg border bg-card p-3"
      initial={{ opacity: 0, x: -10 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="line-clamp-1 font-medium text-sm">
            {match.episodeTitle}
          </p>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Clock className="h-3 w-3" />
            <span>
              {format(new Date(match.matchedAt), "MMM d, yyyy 'at' h:mm a")}
            </span>
          </div>
        </div>
        <Badge
          className={cn(
            "text-xs",
            match.confidence >= 0.8
              ? "border-green-500/30 bg-green-500/10 text-green-600"
              : match.confidence >= 0.6
                ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
                : "border-gray-500/30 bg-gray-500/10 text-gray-600"
          )}
          variant="outline"
        >
          {Math.round(match.confidence * 100)}%
        </Badge>
      </div>

      {match.wasCorrect === null ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            className="h-7 flex-1"
            onClick={onConfirm}
            size="sm"
            variant="outline"
          >
            <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
            Correct
          </Button>
          <Button
            className="h-7 flex-1"
            onClick={onReject}
            size="sm"
            variant="outline"
          >
            <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
            Incorrect
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {match.wasCorrect ? (
            <div className="flex items-center gap-1.5 text-green-600">
              <Check className="h-3.5 w-3.5" />
              <span>Confirmed correct</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-red-600">
              <X className="h-3.5 w-3.5" />
              <span>Marked incorrect</span>
            </div>
          )}
          {match.userFeedback && (
            <span className="text-muted-foreground">
              - "{match.userFeedback}"
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PatternDetail({
  pattern,
  matches = [],
  isLoadingMatches = false,
  onConfirmMatch,
  onRejectMatch,
  onClose,
}: PatternDetailProps) {
  const accuracyPercent = Math.round(pattern.accuracyRate * 100);
  const totalFeedback = pattern.timesConfirmed + pattern.timesRejected;
  const confirmedPercent =
    totalFeedback > 0
      ? Math.round((pattern.timesConfirmed / totalFeedback) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="px-6 pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <SheetTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-purple-500" />
              {pattern.name}
            </SheetTitle>
            <SheetDescription className="line-clamp-2">
              {pattern.description}
            </SheetDescription>
          </div>
          {onClose && (
            <Button
              className="h-8 w-8 shrink-0"
              onClick={onClose}
              size="icon"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SheetHeader>

      <ScrollArea className="flex-1 px-6 py-4">
        <div className="space-y-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-muted/50 p-3 text-center">
              <p className="font-bold text-2xl text-purple-600">
                {pattern.timesMatched}
              </p>
              <p className="text-muted-foreground text-xs">Total Matches</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3 text-center">
              <p
                className={cn(
                  "font-bold text-2xl",
                  accuracyPercent >= 80
                    ? "text-green-600"
                    : accuracyPercent >= 60
                      ? "text-amber-600"
                      : "text-red-600"
                )}
              >
                {accuracyPercent}%
              </p>
              <p className="text-muted-foreground text-xs">Accuracy</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3 text-center">
              <p className="font-bold text-2xl text-blue-600">
                +{Math.round(pattern.confidenceBoost * 100)}%
              </p>
              <p className="text-muted-foreground text-xs">Confidence Boost</p>
            </div>
          </div>

          {/* Feedback Progress */}
          {totalFeedback > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">User Feedback</span>
                <span className="font-medium">
                  {pattern.timesConfirmed} / {totalFeedback} confirmed
                </span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-green-500 transition-all"
                  style={{ width: `${confirmedPercent}%` }}
                />
                <div
                  className="bg-red-500 transition-all"
                  style={{ width: `${100 - confirmedPercent}%` }}
                />
              </div>
            </div>
          )}

          <Separator />

          {/* Klein's RPD Components */}
          <Section
            defaultOpen
            icon={Eye}
            iconColor="text-blue-500"
            title="Salient Features"
          >
            <p className="mb-3 text-muted-foreground text-xs">
              What makes this situation distinctive and recognizable
            </p>
            <div className="space-y-2">
              {pattern.salientFeatures.map((feature, index) => (
                <div
                  className="flex items-start gap-2 rounded-lg bg-blue-500/5 p-2"
                  key={index}
                >
                  <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section
            defaultOpen
            icon={Lightbulb}
            iconColor="text-amber-500"
            title="Typical Expectations"
          >
            <p className="mb-3 text-muted-foreground text-xs">
              What usually happens next when this pattern is detected
            </p>
            <div className="space-y-2">
              {pattern.typicalExpectations.map((expectation, index) => (
                <div
                  className="flex items-start gap-2 rounded-lg bg-amber-500/5 p-2"
                  key={index}
                >
                  <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span className="text-sm">{expectation}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section
            defaultOpen
            icon={Zap}
            iconColor="text-green-500"
            title="Suggested Action"
          >
            <p className="mb-3 text-muted-foreground text-xs">
              The recommended response when this pattern matches
            </p>
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
              <p className="text-sm">{pattern.typicalAction}</p>
            </div>
          </Section>

          <Section
            icon={Target}
            iconColor="text-purple-500"
            title="Plausible Goals"
          >
            <p className="mb-3 text-muted-foreground text-xs">
              Why this pattern matters - potential objectives
            </p>
            <div className="space-y-2">
              {pattern.plausibleGoals.map((goal, index) => (
                <div
                  className="flex items-start gap-2 rounded-lg bg-purple-500/5 p-2"
                  key={index}
                >
                  <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
                  <span className="text-sm">{goal}</span>
                </div>
              ))}
            </div>
          </Section>

          <Separator />

          {/* Match History */}
          <Section
            defaultOpen={matches.length > 0}
            icon={Clock}
            iconColor="text-muted-foreground"
            title={`Recent Matches (${matches.length})`}
          >
            {isLoadingMatches ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : matches.length === 0 ? (
              <div className="py-6 text-center">
                <Target className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-muted-foreground text-sm">
                  No matches recorded yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {matches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    onConfirm={() => onConfirmMatch?.(match.id)}
                    onReject={() => onRejectMatch?.(match.id)}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Technical Details (collapsed by default) */}
          <Section
            defaultOpen={false}
            icon={Code}
            iconColor="text-muted-foreground"
            title="Technical Details"
          >
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pattern ID</span>
                <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                  {pattern.id.slice(0, 12)}...
                </code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Domain</span>
                <Badge variant="secondary">{pattern.domain}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">
                  Confidence Threshold
                </span>
                <span className="font-mono">
                  {Math.round(pattern.confidenceThreshold * 100)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>
                  {format(new Date(pattern.createdAt), "MMM d, yyyy")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Last Updated</span>
                <span>
                  {format(new Date(pattern.updatedAt), "MMM d, yyyy")}
                </span>
              </div>
            </div>
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}

export default PatternDetail;
