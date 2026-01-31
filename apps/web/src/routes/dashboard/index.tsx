/**
 * Dashboard Root - Redirects to Console
 *
 * The Console is the primary intelligence view (Datadog-like).
 */

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard/")({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/console",
    });
  },
  component: () => null,
});

function DashboardPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Intelligence Dashboard</h1>
          <p className="text-muted-foreground">
            Your AI-powered memory and decision support system
          </p>
        </div>
        <Link to="/dashboard/sources">
          <Button variant="outline">
            <Target className="mr-2 h-4 w-4" />
            Manage Sources
          </Button>
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content - 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          <DailyBriefCard />
          <AskCard />
          <RecentIntelligenceCard />
        </div>

        {/* Sidebar - 1 column */}
        <div className="space-y-6">
          <OpenLoopsCard />
          <QuickStatsCard />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// DAILY BRIEF CARD
// =============================================================================

function DailyBriefCard() {
  const { data: brief, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["brief"],
    queryFn: () => briefAPI.getDailyBrief(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-60" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !brief) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Daily Brief
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No brief available yet.</p>
            <p className="text-sm mt-1">Connect your data sources to generate insights.</p>
            <Link to="/dashboard/sources">
              <Button variant="link" className="mt-2">
                Connect Sources →
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Daily Brief
          </CardTitle>
          <CardDescription>
            Generated {new Date(brief.generated_at).toLocaleTimeString()}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refetch()}
          disabled={isRefetching}
        >
          <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">{brief.summary}</p>

        {brief.highlights.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Highlights</h4>
            <div className="space-y-2">
              {brief.highlights.slice(0, 3).map((highlight, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2 rounded-md bg-muted/50"
                >
                  <Lightbulb className="h-4 w-4 mt-0.5 text-yellow-500" />
                  <div>
                    <p className="text-sm font-medium">{highlight.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {highlight.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// ASK CARD
// =============================================================================

function AskCard() {
  const [query, setQuery] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; confidence: number } | null>(null);

  const handleAsk = async () => {
    if (!query.trim()) return;

    setIsAsking(true);
    setAnswer(null);

    try {
      const response = await askAPI.ask(query);
      setAnswer({ answer: response.answer, confidence: response.confidence });
    } catch (error) {
      console.error("Ask failed:", error);
      setAnswer({ answer: "Sorry, I couldn't process that question. Please try again.", confidence: 0 });
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          Ask Your Memory
        </CardTitle>
        <CardDescription>
          Query your connected data sources using natural language
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="What commitments are due this week?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            disabled={isAsking}
          />
          <Button onClick={handleAsk} disabled={isAsking || !query.trim()}>
            {isAsking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {answer && (
          <div className="p-4 rounded-lg bg-muted/50 space-y-2">
            <p className="text-sm">{answer.answer}</p>
            {answer.confidence > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {Math.round(answer.confidence * 100)}% confidence
                </Badge>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setQuery("What decisions were made this week?")}
          >
            Recent decisions
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setQuery("What am I committed to?")}
          >
            My commitments
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setQuery("What tasks are pending?")}
          >
            Pending tasks
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// RECENT INTELLIGENCE CARD
// =============================================================================

function RecentIntelligenceCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["uios", "recent"],
    queryFn: () => intelligenceAPI.listUIOs({ limit: 10 }),
    staleTime: 30 * 1000, // 30 seconds
    retry: 1,
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "commitment":
        return <Target className="h-4 w-4 text-blue-500" />;
      case "decision":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "task":
        return <Clock className="h-4 w-4 text-orange-500" />;
      case "risk":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <FileText className="h-4 w-4 text-gray-500" />;
    }
  };

  const getConfidenceBadge = (tier: string) => {
    const variants: Record<string, "default" | "secondary" | "outline"> = {
      high: "default",
      medium: "secondary",
      low: "outline",
    };
    return (
      <Badge variant={variants[tier] || "outline"} className="text-xs">
        {tier}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const items = data?.items || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Recent Intelligence
          </CardTitle>
          <CardDescription>
            {data?.total || 0} items extracted from your sources
          </CardDescription>
        </div>
        <Link to="/dashboard/commitments">
          <Button variant="ghost" size="sm">
            View All
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No intelligence extracted yet.</p>
            <p className="text-sm mt-1">Connect and sync your data sources.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((uio) => (
              <Link
                key={uio.id}
                to="/dashboard/uio/$uioId"
                params={{ uioId: uio.id }}
                className="block"
              >
                <div className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer">
                  {getTypeIcon(uio.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{uio.title}</p>
                      {getConfidenceBadge(uio.confidence_tier)}
                    </div>
                    {uio.description && (
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {uio.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs capitalize">
                        {uio.type}
                      </Badge>
                      {uio.due_date && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(uio.due_date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// OPEN LOOPS CARD
// =============================================================================

function OpenLoopsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["uios", "open-loops"],
    queryFn: () => intelligenceAPI.listUIOs({ status: "pending", limit: 5 }),
    staleTime: 60 * 1000, // 1 minute
    retry: 1,
  });

  const items = data?.items || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock className="h-5 w-5 text-orange-500" />
          Open Loops
        </CardTitle>
        <CardDescription>Items requiring your attention</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No open loops. You're all caught up!
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((uio) => (
              <Link
                key={uio.id}
                to="/dashboard/uio/$uioId"
                params={{ uioId: uio.id }}
                className="block"
              >
                <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      uio.type === "commitment" && "bg-blue-500",
                      uio.type === "task" && "bg-orange-500",
                      uio.type === "decision" && "bg-green-500"
                    )}
                  />
                  <span className="text-sm truncate flex-1">{uio.title}</span>
                  {uio.due_date && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(uio.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// QUICK STATS CARD
// =============================================================================

function QuickStatsCard() {
  const { data } = useQuery({
    queryKey: ["uios", "stats"],
    queryFn: () => intelligenceAPI.listUIOs({ limit: 1 }),
    staleTime: 60 * 1000,
    retry: 1,
  });

  const total = data?.total || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Quick Stats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total Intelligence</span>
          <span className="text-2xl font-bold">{total}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Link to="/dashboard/commitments" className="block">
            <div className="p-3 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors">
              <Target className="h-5 w-5 text-blue-500 mb-1" />
              <p className="text-xs text-muted-foreground">Commitments</p>
            </div>
          </Link>
          <Link to="/dashboard/decisions" className="block">
            <div className="p-3 rounded-lg bg-green-500/10 hover:bg-green-500/20 transition-colors">
              <CheckCircle2 className="h-5 w-5 text-green-500 mb-1" />
              <p className="text-xs text-muted-foreground">Decisions</p>
            </div>
          </Link>
          <Link to="/dashboard/tasks" className="block">
            <div className="p-3 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 transition-colors">
              <Clock className="h-5 w-5 text-orange-500 mb-1" />
              <p className="text-xs text-muted-foreground">Tasks</p>
            </div>
          </Link>
          <Link to="/dashboard/search" className="block">
            <div className="p-3 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-colors">
              <Search className="h-5 w-5 text-purple-500 mb-1" />
              <p className="text-xs text-muted-foreground">Search</p>
            </div>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
