import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, Settings, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { orgAPI } from "@/lib/api";

export const Route = createFileRoute("/dashboard/team/")({
  component: TeamPage,
});

function TeamPage() {
  const { data: orgInfo, isLoading } = useQuery({
    queryKey: ["org-info"],
    queryFn: () => orgAPI.getOrgInfo(),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div className="h-32 animate-pulse rounded-lg bg-muted" key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!orgInfo) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="font-semibold text-xl">No Organization Selected</h2>
        <p className="mt-2 text-muted-foreground">
          Create or select an organization to manage your team
        </p>
        <Link to="/onboarding/create-org">
          <Button className="mt-4">Create Organization</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Team</h1>
        <p className="text-muted-foreground">
          Manage your organization and team members
        </p>
      </div>

      {/* Organization info */}
      <Card>
        <CardHeader>
          <CardTitle>{orgInfo.name}</CardTitle>
          <CardDescription>
            Region: {orgInfo.region ?? "Default"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div>
              <p className="text-muted-foreground text-sm">
                Created:{" "}
                {orgInfo.created_at
                  ? new Date(orgInfo.created_at).toLocaleDateString()
                  : "—"}
              </p>
              <p className="text-muted-foreground text-sm">
                {orgInfo.member_count} members · {orgInfo.connection_count} connections
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="cursor-pointer transition-colors hover:bg-muted/50">
          <Link className="block" to="/dashboard/team/members">
            <CardHeader className="flex flex-row items-center gap-4">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <CardTitle className="text-lg">Members</CardTitle>
                <CardDescription>Manage team members</CardDescription>
              </div>
            </CardHeader>
          </Link>
        </Card>

        <Card className="cursor-pointer transition-colors hover:bg-muted/50">
          <Link className="block" to="/dashboard/team/invitations">
            <CardHeader className="flex flex-row items-center gap-4">
              <Mail className="h-8 w-8 text-primary" />
              <div>
                <CardTitle className="text-lg">Invitations</CardTitle>
                <CardDescription>Invite new members</CardDescription>
              </div>
            </CardHeader>
          </Link>
        </Card>

        <Card className="cursor-pointer transition-colors hover:bg-muted/50">
          <Link className="block" to="/dashboard/team/settings">
            <CardHeader className="flex flex-row items-center gap-4">
              <Settings className="h-8 w-8 text-primary" />
              <div>
                <CardTitle className="text-lg">Settings</CardTitle>
                <CardDescription>Organization settings</CardDescription>
              </div>
            </CardHeader>
          </Link>
        </Card>
      </div>
    </div>
  );
}
