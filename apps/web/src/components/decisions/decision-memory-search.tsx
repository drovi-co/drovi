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
            <h2 className="text-lg font-semibold">Decision Memory</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Ask questions about past decisions. Get evidence-backed answers with
            citations.
          </p>
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="pl-10 pr-20"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={clearSearch}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSearch}
            disabled={query.trim().length < 3 || isLoading}
            className="h-7"
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
      {!submittedQuery && !embedded && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Try asking:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedQueries.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleSuggestedClick(suggestion)}
                className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600">
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
                  <CardTitle className="text-sm font-medium">
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
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Related Decisions
                </h3>
                <span className="text-xs text-muted-foreground">
                  {searchResults.relevantDecisions.length} found
                </span>
              </div>

              <ScrollArea className="max-h-[400px]">
                <div className="space-y-2">
                  {searchResults.relevantDecisions.map((decision) => (
                    <DecisionResultCard
                      key={decision.id}
                      decision={{
                        id: decision.id,
                        title: decision.title,
                        statement: decision.statement,
                        rationale: decision.rationale,
                        decidedAt: new Date(decision.decidedAt),
                        confidence: decision.relevanceScore ?? 0.5,
                        relevanceScore: decision.relevanceScore,
                      }}
                      onClick={() => onDecisionClick(decision.id)}
                      onThreadClick={onThreadClick}
                      onShowEvidence={onShowEvidence}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          ) : (
            submittedQuery && (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No decisions found for your query.</p>
                <p className="text-xs mt-1">
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
        "relative p-4 rounded-lg border transition-all cursor-pointer",
        "hover:border-purple-500/50 hover:bg-accent/50",
        decision.isSuperseded && "opacity-60"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {/* Priority indicator */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500 rounded-l-lg" />

      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
            <h4
              className={cn(
                "text-sm font-medium truncate",
                decision.isSuperseded && "line-through"
              )}
            >
              {decision.title}
            </h4>
            {decision.isUserVerified && (
              <ThumbsUp className="h-3 w-3 text-green-500 shrink-0" />
            )}
            {decision.isSuperseded && (
              <Badge variant="outline" className="text-[10px] shrink-0">
                <GitBranch className="h-2.5 w-2.5 mr-1" />
                Superseded
              </Badge>
            )}
          </div>
          <ConfidenceBadge
            confidence={decision.confidence}
            isUserVerified={decision.isUserVerified}
            size="sm"
            showDetails={false}
          />
        </div>

        {/* Statement */}
        <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
          {decision.statement}
        </p>

        {/* Meta */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {format(new Date(decision.decidedAt), "MMM d, yyyy")}
            </span>
            {decision.topics && decision.topics.length > 0 && (
              <div className="flex items-center gap-1">
                {decision.topics.slice(0, 2).map((topic) => (
                  <Badge
                    key={topic.id}
                    variant="secondary"
                    className="text-[10px]"
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
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowEvidence(decision.id);
                  }}
                >
                  <Eye className="h-3 w-3 text-purple-500" />
                </Button>
              )}
              {decision.sourceThread && onThreadClick && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onThreadClick(decision.sourceThread!.id);
                  }}
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
