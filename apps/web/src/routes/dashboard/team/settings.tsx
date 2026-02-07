import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { orgAPI } from "@/lib/api";

export const Route = createFileRoute("/dashboard/team/settings")({
  component: TeamSettingsPage,
});

function TeamSettingsPage() {
  const navigate = useNavigate();
  const { data: orgInfo, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["org-info"],
    queryFn: () => orgAPI.getOrgInfo(),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (isError) {
    return <ApiErrorPanel error={error} onRetry={() => refetch()} />;
  }

  if (!orgInfo) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">No organization selected</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Team Settings</h1>
        <p className="text-muted-foreground">
          Organization identity and policy controls live in Settings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Organization profile
          </CardTitle>
          <CardDescription>
            Manage identity, domains, and routing policies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-xs uppercase">Name</p>
                <p className="mt-1 font-medium">{orgInfo.name}</p>
              </div>
              <Button
                onClick={() => navigate({ to: "/dashboard/settings" })}
                variant="outline"
                size="sm"
              >
                Open settings
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="text-muted-foreground text-xs">
            Use the main Settings page to update domains, notification emails,
            or data region.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
