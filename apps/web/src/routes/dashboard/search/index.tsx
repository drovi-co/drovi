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
import { searchAPI, type SearchResult } from "@/lib/api";

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
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  // Search query
  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ["search", submittedQuery],
    queryFn: () => searchAPI.search({
      query: submittedQuery,
      limit: 20,
      include_graph_context: true,
    }),
    enabled: submittedQuery.length > 2,
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
      <div className="flex h-full items-center justify-center">
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
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          Select an organization to search
        </p>
      </div>
    );
  }

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* Search */}
            <div className="flex max-w-xl flex-1 items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pr-8 pl-8 text-sm"
                  id="search-input"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search your email intelligence..."
                  value={query}
                />
                {query && (
                  <Button
                    className="absolute top-1/2 right-0.5 h-7 w-7 -translate-y-1/2"
                    onClick={clearSearch}
                    size="icon"
                    variant="ghost"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Button
                className="h-8"
                disabled={query.length < 3}
                onClick={() => handleSearch(query)}
                size="sm"
              >
                Search
              </Button>
            </div>

            {/* Keyboard hints */}
            <div className="hidden items-center gap-2 text-muted-foreground text-xs lg:flex">
              <kbd className="rounded bg-muted px-1.5 py-0.5">/</kbd>
              <span>focus</span>
              <kbd className="rounded bg-muted px-1.5 py-0.5">Enter</kbd>
              <span>search</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {submittedQuery ? (
            isSearching ? (
              /* Loading State */
              <div>
                <div className="flex items-center gap-2 border-border/40 border-b px-4 py-3">
                  <Sparkles className="h-4 w-4 animate-pulse text-purple-500" />
                  <span className="text-muted-foreground text-sm">
                    Searching your email intelligence...
                  </span>
                </div>
                {[...new Array(5)].map((_, i) => (
                  <div
                    className="flex items-center gap-4 border-border/40 border-b px-4 py-3"
                    key={i}
                  >
                    <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
                    <div className="h-4 w-12 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : searchResults ? (
              /* Search Results */
              <div>
                {/* Results count */}
                <div className="flex items-center gap-2 border-border/40 border-b px-4 py-2 text-muted-foreground text-xs">
                  Found {searchResults.total} results for "{submittedQuery}"
                </div>

                {/* Results */}
                {searchResults.results.length > 0 ? (
                  <div>
                    {/* Group results by type */}
                    {(() => {
                      const resultsByType = searchResults.results.reduce((acc, result) => {
                        const type = result.type || "other";
                        if (!acc[type]) acc[type] = [];
                        acc[type].push(result);
                        return acc;
                      }, {} as Record<string, SearchResult[]>);

                      const typeIcons: Record<string, React.ReactNode> = {
                        commitment: <FileText className="h-3 w-3" />,
                        decision: <Lightbulb className="h-3 w-3" />,
                        task: <MessageSquare className="h-3 w-3" />,
                        contact: <FileText className="h-3 w-3" />,
                        thread: <MessageSquare className="h-3 w-3" />,
                        message: <FileText className="h-3 w-3" />,
                      };

                      const typeLabels: Record<string, string> = {
                        commitment: "Commitments",
                        decision: "Decisions",
                        task: "Tasks",
                        contact: "Contacts",
                        thread: "Threads",
                        message: "Messages",
                      };

                      return Object.entries(resultsByType).map(([type, results]) => (
                        <div key={type}>
                          <div className="border-border/40 border-b bg-muted/30 px-4 py-1.5">
                            <span className="flex items-center gap-1 font-medium text-muted-foreground text-xs">
                              {typeIcons[type] || <FileText className="h-3 w-3" />}
                              {typeLabels[type] || type} ({results.length})
                            </span>
                          </div>
                          {results.map((result) => (
                            <div
                              className="flex cursor-pointer items-center gap-4 border-border/40 border-b px-4 py-3 hover:bg-accent/50"
                              key={result.id || Math.random().toString()}
                            >
                              <Badge
                                className="shrink-0 text-[10px] capitalize"
                                variant="secondary"
                              >
                                {type}
                              </Badge>
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-sm">
                                  {result.title || (result.properties?.title as string) || type}
                                </p>
                                <p className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
                                  {(result.properties?.description as string) ||
                                   (result.properties?.content as string) ||
                                   (result.properties?.summary as string) ||
                                   ""}
                                </p>
                              </div>
                              <span className="shrink-0 text-muted-foreground text-xs">
                                {Math.round(result.score * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                ) : (
                  /* No results */
                  <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <Search className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="font-medium text-lg">No results found</h3>
                    <p className="mt-1 text-muted-foreground text-sm">
                      Try a different query or connect more email accounts
                    </p>
                  </div>
                )}
              </div>
            ) : null
          ) : (
            /* Suggested Queries */
            <div className="p-4">
              <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                Suggested searches
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                {suggestedQueries.map((suggestion, index) => (
                  <button
                    className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/50"
                    key={index}
                    onClick={() => handleSuggestedQuery(suggestion.text)}
                    type="button"
                  >
                    <suggestion.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-sm">{suggestion.text}</span>
                    <Badge className="shrink-0 text-[10px]" variant="secondary">
                      {suggestion.category}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
