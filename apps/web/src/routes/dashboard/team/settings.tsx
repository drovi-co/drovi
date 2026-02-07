import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, ExternalLink, ShieldCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { connectionsAPI, orgAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/team/settings")({
  component: TeamSettingsPage,
});

function TeamSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === "pilot_owner" || user?.role === "pilot_admin";
  const { data: orgInfo, isLoading, isError, error, refetch } = useQuery({
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
  const [allowedConnectors, setAllowedConnectors] = useState<Set<string>>(new Set());
  const [defaultVisibility, setDefaultVisibility] = useState<"org_shared" | "private">("org_shared");

  useEffect(() => {
    if (!orgInfo) return;
    setAllowAllConnectors(orgInfo.allowed_connectors == null);
    setAllowedConnectors(new Set(orgInfo.allowed_connectors ?? []));
    setDefaultVisibility(orgInfo.default_connection_visibility ?? "org_shared");
  }, [orgInfo]);

  const updatePolicyMutation = useMutation({
    mutationFn: async () => {
      return orgAPI.updateOrgInfo({
        allowedConnectors: allowAllConnectors ? null : Array.from(allowedConnectors),
        defaultConnectionVisibility: defaultVisibility,
      });
    },
    onSuccess: () => {
      toast.success("Org policies updated");
      queryClient.invalidateQueries({ queryKey: ["org-info"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update org policies");
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Org policies
          </CardTitle>
          <CardDescription>
            Control which sources can be connected and the default visibility for new connections.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isAdmin ? (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              Admin access is required to edit org policies. You can still view the current policy state below.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm">Default visibility for new sources</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={!isAdmin || updatePolicyMutation.isPending}
                  onClick={() => setDefaultVisibility("org_shared")}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition",
                    defaultVisibility === "org_shared"
                      ? "border-border bg-background shadow-sm"
                      : "border-border/60 bg-muted/30 hover:bg-muted/40"
                  )}
                >
                  <div className="font-medium">Shared</div>
                  <div className="text-xs text-muted-foreground">
                    Visible to the org by default
                  </div>
                </button>
                <button
                  type="button"
                  disabled={!isAdmin || updatePolicyMutation.isPending}
                  onClick={() => setDefaultVisibility("private")}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition",
                    defaultVisibility === "private"
                      ? "border-border bg-background shadow-sm"
                      : "border-border/60 bg-muted/30 hover:bg-muted/40"
                  )}
                >
                  <div className="font-medium">Private</div>
                  <div className="text-xs text-muted-foreground">
                    Only visible to the connector owner
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Allowed connectors</Label>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Allow all</Label>
                  <Switch
                    checked={allowAllConnectors}
                    disabled={!isAdmin || updatePolicyMutation.isPending}
                    onCheckedChange={(v) => setAllowAllConnectors(v)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                When disabled, only selected connectors can be added. Existing connections remain unaffected.
              </p>
            </div>
          </div>

          <Separator />

          <div className={cn("grid gap-2", allowAllConnectors ? "opacity-60" : "")}>
            <div className="text-sm font-medium">Connector catalog</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {connectorTypes.map((c) => {
                const enabled = allowAllConnectors || allowedConnectors.has(c.type);
                const selected = allowedConnectors.has(c.type);
                return (
                  <button
                    key={c.type}
                    type="button"
                    disabled={!isAdmin || updatePolicyMutation.isPending || allowAllConnectors}
                    onClick={() => {
                      setAllowedConnectors((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.type)) next.delete(c.type);
                        else next.add(c.type);
                        return next;
                      });
                    }}
                    className={cn(
                      "group rounded-xl border px-3 py-3 text-left text-sm transition",
                      enabled
                        ? "border-border bg-background hover:bg-muted/20"
                        : "border-border/60 bg-muted/20"
                    )}
                    title={allowAllConnectors ? "Disable Allow all to edit" : undefined}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{c.type}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant={c.configured ? "secondary" : "outline"}>
                          {c.configured ? "configured" : "needs env"}
                        </Badge>
                        {!allowAllConnectors ? (
                          <Badge variant={selected ? "default" : "outline"}>
                            {selected ? "allowed" : "blocked"}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {!c.configured && c.missing_env?.length ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Missing: {c.missing_env.slice(0, 3).join(", ")}
                        {c.missing_env.length > 3 ? "…" : ""}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {c.capabilities?.supports_real_time ? "Real-time capable" : "Batch sync"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              disabled={updatePolicyMutation.isPending}
              onClick={() => refetch()}
            >
              Reset
            </Button>
            <Button
              disabled={!isAdmin || updatePolicyMutation.isPending}
              onClick={() => updatePolicyMutation.mutate()}
            >
              {updatePolicyMutation.isPending ? "Saving…" : "Save policies"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
