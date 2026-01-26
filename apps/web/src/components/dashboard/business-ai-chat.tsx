"use client";

import { useState } from "react";
import {
  ArrowRight,
  Brain,
  CalendarCheck,
  HelpCircle,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SuggestedQuestion {
  icon: React.ReactNode;
  text: string;
  query: string;
}

const suggestedQuestions: SuggestedQuestion[] = [
  {
    icon: <CalendarCheck className="h-4 w-4" />,
    text: "What commitments are overdue?",
    query: "What commitments are overdue and need my attention?",
  },
  {
    icon: <MessageSquare className="h-4 w-4" />,
    text: "Summarize my meetings this week",
    query: "Summarize my meetings and calendar events this week",
  },
  {
    icon: <Users className="h-4 w-4" />,
    text: "Who needs follow-up?",
    query: "Which contacts need follow-up based on recent interactions?",
  },
  {
    icon: <Search className="h-4 w-4" />,
    text: "Find important decisions",
    query: "What are the most important decisions made recently?",
  },
];

export function BusinessAIChat() {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);

  const handleSubmit = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;

    setIsLoading(true);
    setResponse(null);

    // Simulate AI response - in production this would call the actual AI endpoint
    // For now we show a placeholder response
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setResponse(
      `I analyzed your data for: "${searchQuery}"\n\n` +
        "This feature is coming soon. The AI will search through your emails, commitments, decisions, and contacts to give you actionable insights."
    );
    setIsLoading(false);
  };

  const handleSuggestedClick = (question: SuggestedQuestion) => {
    setQuery(question.query);
    handleSubmit(question.query);
  };

  return (
    <Card className="border-border/50 bg-gradient-to-br from-slate-50 via-blue-50/30 to-purple-50/30 dark:from-slate-900 dark:via-blue-950/20 dark:to-purple-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
            <Brain className="h-4 w-4 text-white" />
          </div>
          Ask Drovi
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Suggested questions */}
        <div className="grid gap-2 sm:grid-cols-2">
          {suggestedQuestions.map((question) => (
            <button
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-left text-xs",
                "transition-colors hover:bg-muted",
                "disabled:opacity-50"
              )}
              disabled={isLoading}
              key={question.text}
              onClick={() => handleSuggestedClick(question)}
              type="button"
            >
              <span className="shrink-0 text-muted-foreground">
                {question.icon}
              </span>
              <span className="truncate">{question.text}</span>
            </button>
          ))}
        </div>

        {/* Custom query input */}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(query);
          }}
        >
          <div className="relative flex-1">
            <Input
              className="bg-background pr-10"
              disabled={isLoading}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask about your data..."
              value={query}
            />
            {isLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <Button disabled={isLoading || !query.trim()} size="icon" type="submit">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        {/* Response area */}
        {response && (
          <div className="rounded-lg border border-border/50 bg-background p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
              <p className="whitespace-pre-line text-sm text-foreground">
                {response}
              </p>
            </div>
          </div>
        )}

        {/* Empty state hint */}
        {!response && !isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <HelpCircle className="h-3 w-3" />
            <span>
              Ask questions about your emails, commitments, decisions, and more
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
