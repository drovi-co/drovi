// =============================================================================
// SEARCH PAGE
// =============================================================================
//
// Global search across email intelligence - "Ask My Email" interface.
// Semantic search with natural language queries.
//

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  FileText,
  Lightbulb,
  MessageSquare,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/search/")({
  component: SearchPage,
});

// =============================================================================
// SUGGESTED QUERIES
// =============================================================================

const suggestedQueries = [
  {
    icon: Lightbulb,
    text: "What decisions did we make about pricing?",
    category: "Decisions",
  },
  {
    icon: FileText,
    text: "What did Sarah promise to deliver?",
    category: "Commitments",
  },
  {
    icon: MessageSquare,
    text: "What are the outstanding questions from the board?",
    category: "Open Loops",
  },
  {
    icon: Sparkles,
    text: "Summarize my last conversation with John",
    category: "Context",
  },
];

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function SearchPage() {
  const { data: activeOrg, isPending: orgLoading } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  // Search query
  const { data: searchResults, isLoading: isSearching } = useQuery({
    ...trpc.search.search.queryOptions({
      organizationId,
      query: submittedQuery,
      limit: 20,
    }),
    enabled: !!organizationId && submittedQuery.length > 2,
  });

  // Handlers
  const handleSearch = useCallback((searchQuery: string) => {
    if (searchQuery.length > 2) {
      setSubmittedQuery(searchQuery);
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && query.length > 2) {
        handleSearch(query);
      }
    },
    [query, handleSearch]
  );

  const handleSuggestedQuery = useCallback((suggestedQuery: string) => {
    setQuery(suggestedQuery);
    setSubmittedQuery(suggestedQuery);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setSubmittedQuery("");
  }, []);

  if (orgLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  // Focus search on / key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!organizationId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select an organization to search</p>
      </div>
    );
  }

  return (
    <div data-no-shell-padding className="h-full">
      <div className="flex flex-col h-[calc(100vh-var(--header-height))]">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
          {/* Search */}
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="search-input"
                placeholder="Search your email intelligence..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 pl-8 pr-8 text-sm"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={clearSearch}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            <Button
              size="sm"
              className="h-8"
              onClick={() => handleSearch(query)}
              disabled={query.length < 3}
            >
              Search
            </Button>
          </div>

          {/* Keyboard hints */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 rounded bg-muted">/</kbd>
            <span>focus</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted">Enter</kbd>
            <span>search</span>
          </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {!submittedQuery ? (
            /* Suggested Queries */
            <div className="p-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                Suggested searches
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                {suggestedQueries.map((suggestion, index) => (
                  <button
                    key={index}
                    type="button"
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer text-left transition-colors"
                    onClick={() => handleSuggestedQuery(suggestion.text)}
                  >
                    <suggestion.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm flex-1">{suggestion.text}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {suggestion.category}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          ) : isSearching ? (
            /* Loading State */
            <div>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
                <Sparkles className="h-4 w-4 text-purple-500 animate-pulse" />
                <span className="text-sm text-muted-foreground">
                  Searching your email intelligence...
                </span>
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/40">
                  <div className="flex-1 h-4 bg-muted rounded animate-pulse" />
                  <div className="w-12 h-4 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : searchResults ? (
            /* Search Results */
            <div>
              {/* Results count */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-4 py-2 border-b border-border/40">
                Found {searchResults.total} results for "{submittedQuery}"
              </div>

              {/* Results */}
              {searchResults.results.length > 0 ? (
                <div>
                  {/* Threads */}
                  {searchResults.results.filter(r => r.type === "thread").length > 0 && (
                    <>
                      <div className="px-4 py-1.5 bg-muted/30 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          Threads ({searchResults.results.filter(r => r.type === "thread").length})
                        </span>
                      </div>
                      {searchResults.results.filter(r => r.type === "thread").map((result) => (
                        <div key={result.id} className="flex items-center gap-4 px-4 py-3 border-b border-border/40 hover:bg-accent/50 cursor-pointer">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {(result.metadata as { subject?: string })?.subject || "Thread"}
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {result.content}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {Math.round(result.score * 100)}%
                          </span>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Messages */}
                  {searchResults.results.filter(r => r.type === "message").length > 0 && (
                    <>
                      <div className="px-4 py-1.5 bg-muted/30 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          Messages ({searchResults.results.filter(r => r.type === "message").length})
                        </span>
                      </div>
                      {searchResults.results.filter(r => r.type === "message").map((result) => (
                        <div key={result.id} className="flex items-center gap-4 px-4 py-3 border-b border-border/40 hover:bg-accent/50 cursor-pointer">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {(result.metadata as { threadSubject?: string })?.threadSubject || "Email"}
                            </p>
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {result.content}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {(result.metadata as { fromAddress?: string })?.fromAddress}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {Math.round(result.score * 100)}%
                          </span>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Claims */}
                  {searchResults.results.filter(r => r.type === "claim").length > 0 && (
                    <>
                      <div className="px-4 py-1.5 bg-muted/30 border-b border-border/40">
                        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Lightbulb className="h-3 w-3" />
                          Intelligence ({searchResults.results.filter(r => r.type === "claim").length})
                        </span>
                      </div>
                      {searchResults.results.filter(r => r.type === "claim").map((result) => (
                        <div key={result.id} className="flex items-center gap-4 px-4 py-3 border-b border-border/40 hover:bg-accent/50 cursor-pointer">
                          <Badge variant="secondary" className="text-[10px] capitalize shrink-0">
                            {(result.metadata as { claimType?: string })?.claimType || "claim"}
                          </Badge>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">
                              {result.content}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {Math.round(result.score * 100)}%
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ) : (
                /* No results */
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                    <Search className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium">No results found</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Try a different query or connect more email accounts
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
