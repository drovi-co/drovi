// =============================================================================
// CUSTOM ROLES PAGE - COMING SOON
// =============================================================================
//
// Enterprise feature for creating and managing custom roles with granular permissions.
// This feature is planned for a future release.
//

import { createFileRoute } from "@tanstack/react-router";
import { Shield, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/dashboard/settings/roles")({
  component: CustomRolesPage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function CustomRolesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Custom Roles</h1>
        <p className="text-muted-foreground">
          Create custom roles with granular permissions for your organization
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Coming Soon</CardTitle>
            <Badge variant="secondary">Enterprise</Badge>
          </div>
          <CardDescription>
            We're building something powerful for your team
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <Shield className="h-10 w-10 text-primary" />
            </div>
            <h3 className="mb-2 font-semibold text-xl">
              Custom Roles & Permissions
            </h3>
            <p className="mb-6 max-w-md text-muted-foreground">
              Soon you'll be able to create custom roles with fine-grained
              permissions tailored to your organization's workflow. Define
              exactly what each team member can see and do.
            </p>
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>Available on Enterprise plan</span>
              </div>
              <Button asChild variant="outline">
                <a href="/dashboard/billing">View Plans</a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Built-in Roles Preview */}
      <Card>
        <CardHeader>
          <CardTitle>Built-in Roles</CardTitle>
          <CardDescription>
            Standard roles available in all plans
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {[
              {
                name: "Owner",
                description: "Full access to everything",
                badge: "All permissions",
              },
              {
                name: "Admin",
                description: "Manage members and settings",
                badge: "Admin access",
              },
              {
                name: "Member",
                description: "Standard team member access",
                badge: "Standard",
              },
            ].map((role) => (
              <div
                className="flex items-center justify-between rounded-lg border p-3"
                key={role.name}
              >
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{role.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {role.description}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">{role.badge}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
