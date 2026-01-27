// =============================================================================
// ANALYTICS PAGE
// =============================================================================
//
// Phase 4: Intelligence Analytics Dashboard - your personal and organizational
// intelligence health metrics, trends, and weekly summaries.
//

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BarChart3, LineChart, ListTodo, Sparkles } from "lucide-react";
import { useState } from "react";
import {
  ComplianceExport,
  OpenLoopsDashboard,
} from "@/components/accountability";
import { IntelligenceDashboard, WeeklyDigest } from "@/components/analytics";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/analytics")({
  component: AnalyticsPage,
});

// =============================================================================
// TYPES
// =============================================================================

type TabValue = "dashboard" | "open-loops" | "digest";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function AnalyticsPage() {
  const navigate = useNavigate();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const [activeTab, setActiveTab] = useState<TabValue>("dashboard");

  const handleCommitmentClick = (_commitmentId: string) => {
    navigate({ to: "/dashboard/commitments" });
  };

  const handleDecisionClick = (_decisionId: string) => {
    navigate({ to: "/dashboard/decisions" });
  };

  const handleThreadClick = (threadId: string) => {
    navigate({ to: "/dashboard/email/thread/$threadId", params: { threadId } });
  };

  const handleContactClick = (email: string) => {
    navigate({ to: "/dashboard/contacts", search: { email } });
  };

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="inline-flex rounded-full bg-muted p-4">
            <BarChart3 className="h-12 w-12 text-muted-foreground" />
          </div>
          <h2 className="font-semibold text-xl">No Organization Selected</h2>
          <p className="max-w-sm text-muted-foreground">
            Select an organization from the sidebar to view your intelligence
            analytics
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* Tabs */}
            <Tabs
              onValueChange={(v) => setActiveTab(v as TabValue)}
              value={activeTab}
            >
              <TabsList className="h-8 gap-1 bg-transparent">
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="dashboard"
                >
                  <LineChart className="h-4 w-4" />
                  Analytics
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="open-loops"
                >
                  <ListTodo className="h-4 w-4" />
                  Open Loops
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="digest"
                >
                  <Sparkles className="h-4 w-4" />
                  Weekly Digest
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <ComplianceExport organizationId={organizationId} />
            </div>
          </div>
        </div>

        {/* Main Content - Full Width */}
        <div className="flex-1 overflow-auto">
          {activeTab === "dashboard" && (
            <div className="p-6">
              <IntelligenceDashboard organizationId={organizationId} />
            </div>
          )}
          {activeTab === "open-loops" && (
            <div className="p-6">
              <OpenLoopsDashboard
                onCommitmentClick={handleCommitmentClick}
                onContactClick={handleContactClick}
                onThreadClick={handleThreadClick}
                organizationId={organizationId}
              />
            </div>
          )}
          {activeTab === "digest" && (
            <div className="p-6">
              <WeeklyDigest
                onCommitmentClick={handleCommitmentClick}
                onContactClick={handleContactClick}
                onDecisionClick={handleDecisionClick}
                onThreadClick={handleThreadClick}
                organizationId={organizationId}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
