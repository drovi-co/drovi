// =============================================================================
// DASHBOARD HOME - Overview with Stats, Activity, and AI Chat
// =============================================================================

"use client";

import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ArrowRight, Calendar, FileText, Inbox, Sparkles } from "lucide-react";

import { BusinessAIChat } from "@/components/dashboard/business-ai-chat";
import { OverviewStatCards } from "@/components/dashboard/overview-stat-cards";
import { RecentActivityFeed } from "@/components/dashboard/recent-activity-feed";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/")({
  component: DashboardIndex,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function DashboardIndex() {
  const { data: session } = authClient.useSession();
  const today = new Date();
  const greeting = getGreeting();
  const firstName = session?.user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {format(today, "EEEE, MMMM d")} &mdash; Here's your overview for today
          </p>
        </div>

        {/* Stat Cards */}
        <div className="mb-8">
          <OverviewStatCards />
        </div>

        {/* Main Grid */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card className="border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                <Link to="/dashboard/inbox">
                  <Button
                    className="w-full justify-start gap-2"
                    variant="outline"
                  >
                    <Inbox className="h-4 w-4" />
                    Go to Inbox
                    <ArrowRight className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </Link>
                <Link to="/dashboard/today">
                  <Button
                    className="w-full justify-start gap-2"
                    variant="outline"
                  >
                    <Sparkles className="h-4 w-4" />
                    Today View
                    <ArrowRight className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </Link>
                <Link to="/dashboard/calendar">
                  <Button
                    className="w-full justify-start gap-2"
                    variant="outline"
                  >
                    <Calendar className="h-4 w-4" />
                    Calendar
                    <ArrowRight className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </Link>
                <Link to="/dashboard/tasks">
                  <Button
                    className="w-full justify-start gap-2"
                    variant="outline"
                  >
                    <FileText className="h-4 w-4" />
                    Tasks
                    <ArrowRight className="ml-auto h-4 w-4 opacity-50" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <RecentActivityFeed />
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* AI Chat */}
            <BusinessAIChat />

            {/* Monthly Summary Card */}
            <Card className="border-border/50 bg-gradient-to-br from-indigo-50 via-purple-50/50 to-pink-50/30 dark:from-indigo-950/30 dark:via-purple-950/20 dark:to-pink-950/10">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/10">
                    <FileText className="h-5 w-5 text-indigo-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold">
                      {format(today, "MMMM")} Summary
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Your monthly intelligence report is ready
                    </p>
                  </div>
                </div>
                <Button className="mt-4 w-full" variant="outline">
                  View Monthly Report
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
