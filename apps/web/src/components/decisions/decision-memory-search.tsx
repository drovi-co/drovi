// =============================================================================
// DECISION MEMORY SEARCH
// =============================================================================
//
// The "What did we decide about X?" interface. This is THE killer feature -
// users ask natural language questions and get evidence-backed answers with
// clickable citations. Not just search results - actual memory retrieval.
//

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowRight,
  Clock,
  ExternalLink,
  Eye,
  GitBranch,
  Lightbulb,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  ThumbsUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConfidenceBadge } from "@/components/evidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

export interface DecisionSearchResult {
  id: string;
  title: string;
  statement: string;
  rationale?: string | null;
  decidedAt: Date;
  confidence: number;
  relevanceScore?: number;
  isUserVerified?: boolean;
  isSuperseded?: boolean;
  sourceThread?: {
    id: string;
    subject?: string | null;
  } | null;
  topics?: Array<{
    id: string;
    name: string;
  }>;
}

export interface DecisionMemorySearchProps {
  organizationId: string;
  /** Callback when a decision is clicked */
  onDecisionClick: (decisionId: string) => void;
  /** Callback to view source thread */
  onThreadClick?: (threadId: string) => void;
  /** Callback to show evidence */
  onShowEvidence?: (decisionId: string) => void;
  /** Initial query (optional) */
  initialQuery?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether to show in embedded mode (less chrome) */
  embedded?: boolean;
  /** Optional className */
  className?: string;
}

// =============================================================================
// SUGGESTED QUERIES
// =============================================================================

const suggestedQueries = [
  "What did we decide about pricing?",
  "Who approved the new design?",
  "What was decided about the timeline?",
  "Any decisions about hiring?",
  "What policy changes were made?",
];

// =============================================================================
// COMPONENT
// =============================================================================

export function DecisionMemorySearch({
  organizationId,
  onDecisionClick,
  onThreadClick,
  onShowEvidence,
  initialQuery = "",
  placeholder = "What did we decide about...?",
  embedded = false,
  className,
}: DecisionMemorySearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trpc = useTRPC();

  // Query decisions using natural language
  const {
    data: searchResults,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    ...trpc.decisions.query.queryOptions({
      organizationId,
      query: submittedQuery,
      limit: 10,
    }),
    enabled: submittedQuery.length > 2,
    staleTime: 60_000, // Cache for 1 minute
  });

  const handleSearch = useCallback(() => {
    if (query.trim().length > 2) {
      setSubmittedQuery(query.trim());
    }
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch]
  );

  const handleSuggestedClick = useCallback((suggestion: string) => {
    setQuery(suggestion);
    setSubmittedQuery(suggestion);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setSubmittedQuery("");
    inputRef.current?.focus();
  }, []);

  // Focus input on mount
  useEffect(() => {
    if (!embedded) {
      inputRef.current?.focus();
    }
  }, [embedded]);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Search Header */}
      {!embedded && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-purple-500" />
            <h2 className="font-semibold text-lg">Decision Memory</h2>
          </div>
          <p className="text-muted-foreground text-sm">
            Ask questions about past decisions. Get evidence-backed answers with
            citations.
          </p>
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pr-20 pl-10"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          value={query}
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {query && (
            <Button
              className="h-6 w-6"
              onClick={clearSearch}
              size="icon"
              variant="ghost"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <Button
            className="h-7"
            disabled={query.trim().length < 3 || isLoading}
            onClick={handleSearch}
            size="sm"
          >
            {isLoading || isFetching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Ask"
            )}
          </Button>
        </div>
      </div>

      {/* Suggested Queries (when no results) */}
      {!(submittedQuery || embedded) && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedQueries.map((suggestion) => (
              <button
                className="rounded-full bg-muted px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted/80 hover:text-foreground"
                key={suggestion}
                onClick={() => handleSuggestedClick(suggestion)}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-red-600 text-sm">
          Failed to search decisions. Please try again.
        </div>
      )}

      {/* Results */}
      {searchResults && (
        <div className="space-y-4">
          {/* AI Answer */}
          {searchResults.answer && (
            <Card className="border-purple-500/30 bg-purple-500/5">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  <CardTitle className="font-medium text-sm">
                    AI Answer
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed">
                  {searchResults.answer}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Decision Results */}
          {searchResults.relevantDecisions &&
          searchResults.relevantDecisions.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Related Decisions
                </h3>
                <span className="text-muted-foreground text-xs">
                  {searchResults.relevantDecisions.length} found
                </span>
              </div>

              <ScrollArea className="max-h-[400px]">
                <div className="space-y-2">
                  {searchResults.relevantDecisions.map((decision) => (
                    <DecisionResultCard
                      decision={{
                        id: decision.id,
                        title: decision.title,
                        statement: decision.statement,
                        rationale: decision.rationale,
                        decidedAt: new Date(decision.decidedAt),
                        confidence: decision.relevanceScore ?? 0.5,
                        relevanceScore: decision.relevanceScore,
                      }}
                      key={decision.id}
                      onClick={() => onDecisionClick(decision.id)}
                      onShowEvidence={onShowEvidence}
                      onThreadClick={onThreadClick}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : (
            submittedQuery && (
              <div className="py-8 text-center text-muted-foreground">
                <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">No decisions found for your query.</p>
                <p className="mt-1 text-xs">
                  Try rephrasing or asking about a different topic.
                </p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// DECISION RESULT CARD
// =============================================================================

interface DecisionResultCardProps {
  decision: DecisionSearchResult;
  onClick: () => void;
  onThreadClick?: (threadId: string) => void;
  onShowEvidence?: (decisionId: string) => void;
}

function DecisionResultCard({
  decision,
  onClick,
  onThreadClick,
  onShowEvidence,
}: DecisionResultCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={cn(
        "relative cursor-pointer rounded-lg border p-4 transition-all",
        "hover:border-purple-500/50 hover:bg-accent/50",
        decision.isSuperseded && "opacity-60"
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Priority indicator */}
      <div className="absolute top-0 bottom-0 left-0 w-1 rounded-l-lg bg-purple-500" />

      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
            <h4
              className={cn(
                "truncate font-medium text-sm",
                decision.isSuperseded && "line-through"
              )}
            >
              {decision.title}
            </h4>
            {decision.isUserVerified && (
              <ThumbsUp className="h-3 w-3 shrink-0 text-green-500" />
            )}
            {decision.isSuperseded && (
              <Badge className="shrink-0 text-[10px]" variant="outline">
                <GitBranch className="mr-1 h-2.5 w-2.5" />
                Superseded
              </Badge>
            )}
          </div>
          <ConfidenceBadge
            confidence={decision.confidence}
            isUserVerified={decision.isUserVerified}
            showDetails={false}
            size="sm"
          />
        </div>

        {/* Statement */}
        <p className="line-clamp-2 text-muted-foreground text-sm leading-relaxed">
          {decision.statement}
        </p>

        {/* Meta */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {format(new Date(decision.decidedAt), "MMM d, yyyy")}
            </span>
            {decision.topics && decision.topics.length > 0 && (
              <div className="flex items-center gap-1">
                {decision.topics.slice(0, 2).map((topic) => (
                  <Badge
                    className="text-[10px]"
                    key={topic.id}
                    variant="secondary"
                  >
                    {topic.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Actions (on hover) */}
          {isHovered && (
            <div className="flex items-center gap-1">
              {onShowEvidence && (
                <Button
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowEvidence(decision.id);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <Eye className="h-3 w-3 text-purple-500" />
                </Button>
              )}
              {decision.sourceThread && onThreadClick && (
                <Button
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onThreadClick(decision.sourceThread!.id);
                  }}
                  size="icon"
                  variant="ghost"
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              )}
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DecisionMemorySearch;
