// =============================================================================
// SHARED INBOX PAGE - COMING SOON
// =============================================================================
//
// Team collaboration feature for shared inboxes with automatic assignment.
// This feature is planned for a future release.
//

import { createFileRoute } from "@tanstack/react-router";
import { Inbox, Sparkles, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/settings/shared-inbox")({
  component: SharedInboxConfigPage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function SharedInboxConfigPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Shared Inboxes</h1>
        <p className="text-muted-foreground">
          Create shared inboxes for team collaboration with automatic assignment
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Coming Soon</CardTitle>
            <Badge variant="secondary">Pro</Badge>
          </div>
          <CardDescription>
            We're building powerful team collaboration features
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <Inbox className="h-10 w-10 text-primary" />
            </div>
            <h3 className="mb-2 font-semibold text-xl">Shared Inboxes</h3>
            <p className="mb-6 max-w-md text-muted-foreground">
              Soon you'll be able to create shared team inboxes with automatic
              round-robin assignment, SLA tracking, and collaborative workflows.
              Perfect for support teams, sales, and any group handling shared
              communications.
            </p>

            <div className="mb-6 grid max-w-lg grid-cols-2 gap-4 text-left">
              <div className="rounded-lg border p-4">
                <Users className="mb-2 h-5 w-5 text-primary" />
                <p className="font-medium text-sm">Round-Robin Assignment</p>
                <p className="text-muted-foreground text-xs">
                  Automatically distribute conversations equally
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <Sparkles className="mb-2 h-5 w-5 text-primary" />
                <p className="font-medium text-sm">SLA Tracking</p>
                <p className="text-muted-foreground text-xs">
                  Set response and resolution time targets
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Available on Pro and Enterprise plans</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
