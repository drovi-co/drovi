import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { OnboardingLayout } from "@/components/onboarding/onboarding-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuthStore } from "@/lib/auth";
import {
  connectionsAPI,
  orgAPI,
  orgSSE,
  type SyncEvent,
  type AvailableConnector,
  type OrgConnection,
} from "@/lib/api";
import {
  CONNECTOR_CATALOG,
  CONNECTOR_META_BY_ID,
  type ConnectorMeta,
} from "@/lib/connectors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding/connect-sources")({
  component: ConnectSourcesPage,
});

type ConnectorCard = ConnectorMeta & {
  available: boolean;
  configured: boolean;
  missingEnv: string[];
};

function ConnectSourcesPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuthStore();
  const organizationId = user?.org_id ?? "";

  const [connectingProvider, setConnectingProvider] = useState<string | null>(
    null
  );
  const [liveSync, setLiveSync] = useState<Record<string, SyncEvent>>({});

  // Handle OAuth callback result
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const connectionSuccess = searchParams.get("connection");
    const error = searchParams.get("error");

    if (connectionSuccess === "success") {
      toast.success("Source connected! Initial sync queued.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (error) {
      toast.error(`Failed to connect: ${error}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const {
    data: availableConnectors,
    isError: availableConnectorsError,
    error: availableConnectorsErrorObj,
    refetch: refetchAvailableConnectors,
  } = useQuery({
    queryKey: ["available-connectors"],
    queryFn: () => connectionsAPI.listConnectors(),
    enabled: !!organizationId,
  });

  const {
    data: connections,
    isLoading: connectionsLoading,
    isError: connectionsError,
    error: connectionsErrorObj,
    refetch: refetchConnections,
  } = useQuery({
    queryKey: ["org-connections"],
    queryFn: () => orgAPI.listConnections(),
    enabled: !!organizationId,
  });

  const availableById = useMemo(() => {
    return new Map(
      (availableConnectors ?? []).map((connector) => [connector.type, connector])
    );
  }, [availableConnectors]);

  const connectors = useMemo<ConnectorCard[]>(() => {
    const catalog = CONNECTOR_CATALOG.map((meta) => ({
      ...meta,
      available: availableById.has(meta.id),
      configured: availableById.get(meta.id)?.configured ?? false,
      missingEnv: availableById.get(meta.id)?.missing_env ?? [],
    }));

    const extras = Array.from(availableById.values())
      .filter((connector) => !CONNECTOR_META_BY_ID.has(connector.type))
      .map((connector) => ({
        id: connector.type,
        name: connector.type.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
        icon: PlugZap,
        color: "#64748B",
        description: "Custom connector",
        category: "knowledge" as const,
        available: true,
        configured: connector.configured ?? true,
        missingEnv: connector.missing_env ?? [],
      }));

    return [...catalog, ...extras];
  }, [availableById]);

  const connectionByProvider = useMemo(() => {
    const map = new Map<string, OrgConnection>();
    (connections ?? []).forEach((connection) => {
      map.set(connection.provider, connection);
    });
    return map;
  }, [connections]);

  const connectMutation = useMutation({
    mutationFn: async (provider: string) =>
      orgAPI.initiateConnect(provider, {
        returnTo: "/onboarding/connect-sources",
      }),
    onSuccess: (data) => {
      window.location.href = data.auth_url;
    },
    onError: (error: Error) => {
      toast.error(`Failed to connect: ${error.message}`);
      setConnectingProvider(null);
    },
  });

  const handleConnect = (provider: string) => {
    setConnectingProvider(provider);
    connectMutation.mutate(provider);
  };

  const handleSkip = () => {
    navigate({ to: "/onboarding/invite-team" });
  };

  const handleContinue = () => {
    navigate({ to: "/onboarding/invite-team" });
  };

  const hasConnectedAccount = (connections ?? []).length > 0;

  // Subscribe to sync events so the onboarding cards show progress without refresh.
  useEffect(() => {
    if (!organizationId) return;

    const unsubscribe = orgSSE.subscribeSyncEvents((event) => {
      setLiveSync((prev) => ({
        ...prev,
        [event.connection_id]: {
          ...prev[event.connection_id],
          ...event,
        },
      }));
      if (event.event_type === "completed" || event.event_type === "failed") {
        void refetchConnections();
      }
    });

    return unsubscribe;
  }, [organizationId, refetchConnections]);

  if (authLoading) {
    return (
      <OnboardingLayout step={2}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </OnboardingLayout>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <OnboardingLayout step={2}>
      <div className="space-y-6">
        <Card className="border-0 shadow-none lg:border lg:shadow-sm">
          <CardHeader className="pb-2 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              {hasConnectedAccount ? (
                <CheckCircle2 className="h-7 w-7 text-green-600" />
              ) : (
                <PlugZap className="h-7 w-7 text-primary" />
              )}
            </div>
            <CardTitle className="text-2xl">
              {hasConnectedAccount
                ? "Sources connected"
                : "Connect your sources"}
            </CardTitle>
            <CardDescription className="text-base">
              {hasConnectedAccount
                ? "Keep adding sources to deepen the memory graph and accelerate briefs."
                : "Pick the sources that matter most. We will backfill history and keep everything in sync."}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {availableConnectorsError && (
              <div className="mb-4">
                <ApiErrorPanel
                  error={availableConnectorsErrorObj}
                  onRetry={() => refetchAvailableConnectors()}
                  retryLabel="Reload connectors"
                />
              </div>
            )}
            {connectionsError && (
              <div className="mb-4">
                <ApiErrorPanel
                  error={connectionsErrorObj}
                  onRetry={() => refetchConnections()}
                  retryLabel="Reload connections"
                />
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {connectors.map((connector) => {
                const connection = connectionByProvider.get(connector.id);
                const isConnected = Boolean(connection);
                const live = connection ? liveSync[connection.id] : undefined;
                const liveProgress = live?.progress ?? null;
                const backfillWindow = (() => {
                  const params = live?.sync_params;
                  if (!params || typeof params !== "object") return null;
                  const idx = (params as Record<string, unknown>)[
                    "backfill_window_index"
                  ];
                  const total = (params as Record<string, unknown>)[
                    "backfill_window_total"
                  ];
                  if (typeof idx === "number" && typeof total === "number") {
                    return { idx, total };
                  }
                  return null;
                })();

                const overallBackfillProgress = (() => {
                  if (!backfillWindow) return null;
                  const { idx, total } = backfillWindow;
                  const perWindowProgress =
                    typeof liveProgress === "number" ? liveProgress : null;
                  const eventType = live?.event_type;

                  const base =
                    eventType === "completed"
                      ? idx
                      : eventType === "started" || eventType === "failed"
                        ? Math.max(0, idx - 1)
                        : idx - 1;

                  const raw =
                    perWindowProgress !== null
                      ? (base + perWindowProgress) / total
                      : base / total;

                  if (!Number.isFinite(raw)) return null;
                  return Math.max(0, Math.min(1, raw));
                })();
                const isSyncing =
                  live?.event_type === "started" ||
                  live?.event_type === "progress" ||
                  connection?.status === "syncing" ||
                  Boolean(connection?.progress);
                const Icon = connector.icon;

                return (
                  <div
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border bg-card p-4",
                      isConnected && "border-emerald-500/40 bg-emerald-500/5",
                      connector.available && !connector.configured && "border-amber-500/30 bg-amber-500/5",
                      !connector.available && "opacity-60"
                    )}
                    key={connector.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-lg"
                          style={{ backgroundColor: `${connector.color}1A` }}
                        >
                          <Icon className="h-5 w-5" style={{ color: connector.color }} />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{connector.name}</p>
                          <p className="text-muted-foreground text-xs">
                            {connector.description}
                          </p>
                        </div>
                      </div>
                      {isConnected ? (
                        <div className="flex flex-col items-end gap-1">
                          <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600">
                            Connected
                          </Badge>
                          <Badge
                            className={cn(
                              "text-[10px]",
                              (connection?.visibility ?? "org_shared") === "private" &&
                                "border-slate-500/30 bg-slate-500/10 text-slate-600",
                              (connection?.visibility ?? "org_shared") === "org_shared" &&
                                "border-emerald-500/20 bg-emerald-500/5 text-emerald-700/80"
                            )}
                            variant="outline"
                          >
                            {(connection?.visibility ?? "org_shared") === "private"
                              ? "Private"
                              : "Org-shared"}
                          </Badge>
                        </div>
                      ) : !connector.available ? (
                        <Badge variant="outline">Coming soon</Badge>
                      ) : !connector.configured ? (
                        <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-600">
                          Not configured
                        </Badge>
                      ) : (
                        <Badge variant="outline">Ready</Badge>
                      )}
                    </div>

                    {connector.available && !connector.configured && connector.missingEnv.length ? (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-700/80">
                        <p className="font-medium text-amber-600">
                          Missing connector configuration
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-amber-700/70">
                          {connector.missingEnv.join(", ")}
                        </p>
                      </div>
                    ) : null}

                    {isConnected && (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {connection?.last_sync
                            ? `Last sync ${new Date(connection.last_sync).toLocaleDateString()}`
                            : "Initial sync queued"}
                        </span>
                        {isSyncing && (
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            Syncing
                          </span>
                        )}
                      </div>
                    )}

                    {isConnected && isSyncing && backfillWindow ? (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          Backfill window{" "}
                          <span className="font-mono text-foreground">
                            {backfillWindow.idx}/{backfillWindow.total}
                          </span>
                        </span>
                        {overallBackfillProgress !== null ? (
                          <span className="font-mono text-foreground">
                            {Math.round(overallBackfillProgress * 100)}%
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {isConnected &&
                    isSyncing &&
                    typeof liveProgress === "number" ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Progress</span>
                          <span className="font-mono text-foreground">
                            {Math.round(liveProgress * 100)}%
                          </span>
                        </div>
                        <Progress value={Math.round(liveProgress * 100)} />
                      </div>
                    ) : null}

                    {isConnected &&
                    isSyncing &&
                    typeof liveProgress !== "number" &&
                    overallBackfillProgress !== null ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Backfill</span>
                          <span className="font-mono text-foreground">
                            {Math.round(overallBackfillProgress * 100)}%
                          </span>
                        </div>
                        <Progress value={Math.round(overallBackfillProgress * 100)} />
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {connection?.messages_synced
                          ? `${connection.messages_synced.toLocaleString()} records synced`
                          : "No records yet"}
                      </div>
                      <Button
                        disabled={
                          !connector.available ||
                          !connector.configured ||
                          isConnected ||
                          connectingProvider === connector.id
                        }
                        onClick={() => handleConnect(connector.id)}
                        size="sm"
                        variant={isConnected ? "secondary" : "default"}
                      >
                        {connectingProvider === connector.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : isConnected ? (
                          "Connected"
                        ) : (
                          "Connect"
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button onClick={handleSkip} variant="ghost">
            Skip for now
          </Button>
          <Button onClick={handleContinue}>
            Continue
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
}
