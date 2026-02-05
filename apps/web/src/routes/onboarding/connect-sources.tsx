import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { authClient } from "@/lib/auth-client";
import {
  connectionsAPI,
  orgAPI,
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

type ConnectorCard = ConnectorMeta & { available: boolean };

function ConnectSourcesPage() {
  const navigate = useNavigate();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();

  const [connectingProvider, setConnectingProvider] = useState<string | null>(
    null
  );

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

  const { data: availableConnectors } = useQuery({
    queryKey: ["available-connectors"],
    queryFn: () => connectionsAPI.listConnectors(),
    enabled: !!activeOrg,
  });

  const { data: connections, isLoading: connectionsLoading } = useQuery({
    queryKey: ["org-connections"],
    queryFn: () => orgAPI.listConnections(),
    enabled: !!activeOrg,
  });

  const availableIds = useMemo(
    () => new Set((availableConnectors ?? []).map((connector) => connector.type)),
    [availableConnectors]
  );

  const connectors = useMemo<ConnectorCard[]>(() => {
    const catalog = CONNECTOR_CATALOG.map((meta) => ({
      ...meta,
      available: availableIds.has(meta.id),
    }));

    const extras = (availableConnectors ?? [])
      .filter((connector) => !CONNECTOR_META_BY_ID.has(connector.type))
      .map((connector) => ({
        id: connector.type,
        name: connector.type.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
        icon: PlugZap,
        color: "#64748B",
        description: "Custom connector",
        category: "knowledge" as const,
        available: true,
      }));

    return [...catalog, ...extras];
  }, [availableConnectors, availableIds]);

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

  if (orgLoading) {
    return (
      <OnboardingLayout step={2}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </OnboardingLayout>
    );
  }

  if (!activeOrg) {
    navigate({ to: "/onboarding/create-org" });
    return null;
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
            <div className="grid gap-4 md:grid-cols-2">
              {connectors.map((connector) => {
                const connection = connectionByProvider.get(connector.id);
                const isConnected = Boolean(connection);
                const isSyncing = connection?.status === "syncing" || connection?.progress;
                const Icon = connector.icon;

                return (
                  <div
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border bg-card p-4",
                      isConnected && "border-emerald-500/40 bg-emerald-500/5",
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
                        <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600">
                          Connected
                        </Badge>
                      ) : connector.available ? (
                        <Badge variant="outline">Available</Badge>
                      ) : (
                        <Badge variant="outline">Coming soon</Badge>
                      )}
                    </div>

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

                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {connection?.messages_synced
                          ? `${connection.messages_synced.toLocaleString()} records synced`
                          : "No records yet"}
                      </div>
                      <Button
                        disabled={!connector.available || isConnected || connectingProvider === connector.id}
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
