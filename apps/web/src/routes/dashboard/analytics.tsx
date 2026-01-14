// =============================================================================
// ANALYTICS PAGE
// =============================================================================
//
// Phase 4: Intelligence Analytics Dashboard - your personal and organizational
// intelligence health metrics, trends, and weekly summaries.
//

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  BarChart3,
  Download,
  LineChart,
  ListTodo,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { IntelligenceDashboard, WeeklyDigest } from "@/components/analytics";
import { OpenLoopsDashboard, ComplianceExport } from "@/components/accountability";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const { data: activeOrg, isPending: orgLoading } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const [activeTab, setActiveTab] = useState<TabValue>("dashboard");

  const handleCommitmentClick = (commitmentId: string) => {
    navigate({ to: "/dashboard/commitments" });
  };

  const handleDecisionClick = (decisionId: string) => {
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
      <div className="h-full flex items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="p-4 rounded-full bg-muted inline-flex">
            <BarChart3 className="h-12 w-12 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold">No Organization Selected</h2>
          <p className="text-muted-foreground max-w-sm">
            Select an organization from the sidebar to view your intelligence analytics
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-no-shell-padding className="h-full">
      <div className="flex flex-col h-[calc(100vh-var(--header-height))]">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
              <TabsList className="h-8 bg-transparent gap-1">
                <TabsTrigger
                  value="dashboard"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <LineChart className="h-4 w-4" />
                  Analytics
                </TabsTrigger>
                <TabsTrigger
                  value="open-loops"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
                >
                  <ListTodo className="h-4 w-4" />
                  Open Loops
                </TabsTrigger>
                <TabsTrigger
                  value="digest"
                  className="text-sm px-3 data-[state=active]:bg-accent gap-2"
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
                organizationId={organizationId}
                onCommitmentClick={handleCommitmentClick}
                onThreadClick={handleThreadClick}
                onContactClick={handleContactClick}
              />
            </div>
          )}
          {activeTab === "digest" && (
            <div className="p-6">
              <WeeklyDigest
                organizationId={organizationId}
                onCommitmentClick={handleCommitmentClick}
                onDecisionClick={handleDecisionClick}
                onThreadClick={handleThreadClick}
                onContactClick={handleContactClick}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
