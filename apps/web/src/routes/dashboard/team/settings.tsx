import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { connectionsAPI, orgAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/team/settings")({
  component: TeamSettingsPage,
});

function TeamSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const t = useT();
  const isAdmin = user?.role === "pilot_owner" || user?.role === "pilot_admin";
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

  const { data: connectors } = useQuery({
    queryKey: ["connectors"],
    queryFn: () => connectionsAPI.listConnectors(),
    staleTime: 60_000,
  });

  const connectorTypes = useMemo(() => {
    const list = connectors ?? [];
    return [...list].sort((a, b) => a.type.localeCompare(b.type));
  }, [connectors]);

  const [allowAllConnectors, setAllowAllConnectors] = useState(true);
  const [allowedConnectors, setAllowedConnectors] = useState<Set<string>>(
    new Set()
  );
  const [defaultVisibility, setDefaultVisibility] = useState<
    "org_shared" | "private"
  >("org_shared");

  useEffect(() => {
    if (!orgInfo) return;
    setAllowAllConnectors(orgInfo.allowed_connectors == null);
    setAllowedConnectors(new Set(orgInfo.allowed_connectors ?? []));
    setDefaultVisibility(orgInfo.default_connection_visibility ?? "org_shared");
  }, [orgInfo]);

  const updatePolicyMutation = useMutation({
    mutationFn: async () => {
      return orgAPI.updateOrgInfo({
        allowedConnectors: allowAllConnectors
          ? null
          : Array.from(allowedConnectors),
        defaultConnectionVisibility: defaultVisibility,
      });
    },
    onSuccess: () => {
      toast.success(t("pages.dashboard.team.settingsPage.toasts.updated"));
      queryClient.invalidateQueries({ queryKey: ["org-info"] });
    },
    onError: (err: Error) => {
      toast.error(
        err.message ||
          t("pages.dashboard.team.settingsPage.toasts.updateFailed")
      );
    },
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
        <p className="text-muted-foreground">
          {t("pages.dashboard.team.noOrg.title")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">
          {t("pages.dashboard.team.settingsPage.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("pages.dashboard.team.settingsPage.subtitle")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {t("pages.dashboard.team.settingsPage.profile.title")}
          </CardTitle>
          <CardDescription>
            {t("pages.dashboard.team.settingsPage.profile.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-xs uppercase">
                  {t("pages.dashboard.team.settingsPage.profile.nameLabel")}
                </p>
                <p className="mt-1 font-medium">{orgInfo.name}</p>
              </div>
              <Button
                onClick={() => navigate({ to: "/dashboard/settings" })}
                size="sm"
                variant="outline"
              >
                {t("pages.dashboard.team.settingsPage.profile.openSettings")}
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="text-muted-foreground text-xs">
            {t("pages.dashboard.team.settingsPage.profile.hint")}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {t("pages.dashboard.team.settingsPage.policies.title")}
          </CardTitle>
          <CardDescription>
            {t("pages.dashboard.team.settingsPage.policies.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isAdmin ? null : (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
              {t("pages.dashboard.team.settingsPage.policies.adminRequired")}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm">
                {t(
                  "pages.dashboard.team.settingsPage.policies.defaultVisibility.label"
                )}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition",
                    defaultVisibility === "org_shared"
                      ? "border-border bg-background shadow-sm"
                      : "border-border/60 bg-muted/30 hover:bg-muted/40"
                  )}
                  disabled={!isAdmin || updatePolicyMutation.isPending}
                  onClick={() => setDefaultVisibility("org_shared")}
                  type="button"
                >
                  <div className="font-medium">
                    {t(
                      "pages.dashboard.team.settingsPage.policies.defaultVisibility.shared.title"
                    )}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t(
                      "pages.dashboard.team.settingsPage.policies.defaultVisibility.shared.description"
                    )}
                  </div>
                </button>
                <button
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition",
                    defaultVisibility === "private"
                      ? "border-border bg-background shadow-sm"
                      : "border-border/60 bg-muted/30 hover:bg-muted/40"
                  )}
                  disabled={!isAdmin || updatePolicyMutation.isPending}
                  onClick={() => setDefaultVisibility("private")}
                  type="button"
                >
                  <div className="font-medium">
                    {t(
                      "pages.dashboard.team.settingsPage.policies.defaultVisibility.private.title"
                    )}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t(
                      "pages.dashboard.team.settingsPage.policies.defaultVisibility.private.description"
                    )}
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">
                  {t(
                    "pages.dashboard.team.settingsPage.policies.allowedConnectors.title"
                  )}
                </Label>
                <div className="flex items-center gap-2">
                  <Label className="text-muted-foreground text-xs">
                    {t(
                      "pages.dashboard.team.settingsPage.policies.allowedConnectors.allowAll"
                    )}
                  </Label>
                  <Switch
                    checked={allowAllConnectors}
                    disabled={!isAdmin || updatePolicyMutation.isPending}
                    onCheckedChange={(v) => setAllowAllConnectors(v)}
                  />
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                {t(
                  "pages.dashboard.team.settingsPage.policies.allowedConnectors.hint"
                )}
              </p>
            </div>
          </div>

          <Separator />

          <div
            className={cn("grid gap-2", allowAllConnectors ? "opacity-60" : "")}
          >
            <div className="font-medium text-sm">
              {t(
                "pages.dashboard.team.settingsPage.policies.connectorCatalog.title"
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {connectorTypes.map((c) => {
                const enabled =
                  allowAllConnectors || allowedConnectors.has(c.type);
                const selected = allowedConnectors.has(c.type);
                return (
                  <button
                    className={cn(
                      "group rounded-xl border px-3 py-3 text-left text-sm transition",
                      enabled
                        ? "border-border bg-background hover:bg-muted/20"
                        : "border-border/60 bg-muted/20"
                    )}
                    disabled={
                      !isAdmin ||
                      updatePolicyMutation.isPending ||
                      allowAllConnectors
                    }
                    key={c.type}
                    onClick={() => {
                      setAllowedConnectors((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.type)) next.delete(c.type);
                        else next.add(c.type);
                        return next;
                      });
                    }}
                    title={
                      allowAllConnectors
                        ? t(
                            "pages.dashboard.team.settingsPage.policies.connectorCatalog.disableAllowAllHint"
                          )
                        : undefined
                    }
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{c.type}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant={c.configured ? "secondary" : "outline"}>
                          {c.configured
                            ? t(
                                "pages.dashboard.team.settingsPage.policies.connectorCatalog.configured"
                              )
                            : t(
                                "pages.dashboard.team.settingsPage.policies.connectorCatalog.needsEnv"
                              )}
                        </Badge>
                        {allowAllConnectors ? null : (
                          <Badge variant={selected ? "default" : "outline"}>
                            {selected
                              ? t(
                                  "pages.dashboard.team.settingsPage.policies.connectorCatalog.allowed"
                                )
                              : t(
                                  "pages.dashboard.team.settingsPage.policies.connectorCatalog.blocked"
                                )}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {!c.configured && c.missing_env?.length ? (
                      <div className="mt-2 text-muted-foreground text-xs">
                        {t(
                          "pages.dashboard.team.settingsPage.policies.connectorCatalog.missingEnv"
                        )}{" "}
                        {c.missing_env.slice(0, 3).join(", ")}
                        {c.missing_env.length > 3 ? "…" : ""}
                      </div>
                    ) : (
                      <div className="mt-2 text-muted-foreground text-xs">
                        {c.capabilities?.supports_real_time
                          ? t(
                              "pages.dashboard.team.settingsPage.policies.connectorCatalog.realTime"
                            )
                          : t(
                              "pages.dashboard.team.settingsPage.policies.connectorCatalog.batch"
                            )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={updatePolicyMutation.isPending}
              onClick={() => refetch()}
              variant="outline"
            >
              {t("pages.dashboard.team.settingsPage.actions.reset")}
            </Button>
            <Button
              disabled={!isAdmin || updatePolicyMutation.isPending}
              onClick={() => updatePolicyMutation.mutate()}
            >
              {updatePolicyMutation.isPending
                ? t("pages.dashboard.team.settingsPage.actions.saving")
                : t("pages.dashboard.team.settingsPage.actions.savePolicies")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
