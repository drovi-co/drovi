import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Mail, Settings, Users } from "lucide-react";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { useT } from "@/i18n";
import { orgAPI } from "@/lib/api";

export function TeamPage() {
  const t = useT();
  const {
    data: orgInfo,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
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

  if (isError) {
    return <ApiErrorPanel error={error} onRetry={() => refetch()} />;
  }

  if (!orgInfo) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="font-semibold text-xl">
          {t("pages.dashboard.team.noOrg.title")}
        </h2>
        <p className="mt-2 text-muted-foreground">
          {t("pages.dashboard.team.noOrg.description")}
        </p>
        <Link to="/onboarding/create-org">
          <Button className="mt-4">
            {t("pages.dashboard.team.noOrg.cta")}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">
          {t("nav.items.team")}
        </h1>
        <p className="text-muted-foreground">
          {t("pages.dashboard.team.subtitle")}
        </p>
      </div>

      {/* Organization info */}
      <Card>
        <CardHeader>
          <CardTitle>{orgInfo.name}</CardTitle>
          <CardDescription>
            {t("pages.dashboard.team.org.region", {
              region:
                orgInfo.region ?? t("pages.dashboard.team.org.defaultRegion"),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div>
              <p className="text-muted-foreground text-sm">
                {t("pages.dashboard.team.org.created", {
                  date: orgInfo.created_at
                    ? new Date(orgInfo.created_at).toLocaleDateString()
                    : "—",
                })}
              </p>
              <p className="text-muted-foreground text-sm">
                {t("pages.dashboard.team.org.stats", {
                  members: orgInfo.member_count,
                  connections: orgInfo.connection_count,
                })}
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
                <CardTitle className="text-lg">
                  {t("nav.items.members")}
                </CardTitle>
                <CardDescription>
                  {t("pages.dashboard.team.quickActions.members")}
                </CardDescription>
              </div>
            </CardHeader>
          </Link>
        </Card>

        <Card className="cursor-pointer transition-colors hover:bg-muted/50">
          <Link className="block" to="/dashboard/team/invitations">
            <CardHeader className="flex flex-row items-center gap-4">
              <Mail className="h-8 w-8 text-primary" />
              <div>
                <CardTitle className="text-lg">
                  {t("nav.items.invitations")}
                </CardTitle>
                <CardDescription>
                  {t("pages.dashboard.team.quickActions.invitations")}
                </CardDescription>
              </div>
            </CardHeader>
          </Link>
        </Card>

        <Card className="cursor-pointer transition-colors hover:bg-muted/50">
          <Link className="block" to="/dashboard/team/settings">
            <CardHeader className="flex flex-row items-center gap-4">
              <Settings className="h-8 w-8 text-primary" />
              <div>
                <CardTitle className="text-lg">
                  {t("nav.items.settings")}
                </CardTitle>
                <CardDescription>
                  {t("pages.dashboard.team.quickActions.settings")}
                </CardDescription>
              </div>
            </CardHeader>
          </Link>
        </Card>
      </div>
    </div>
  );
}
