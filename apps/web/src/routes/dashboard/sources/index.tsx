// =============================================================================
// SOURCES PAGE - Multi-Source Connection Management
// =============================================================================

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  FileText,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  Target,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useAuthStore } from "@/lib/auth";
import {
  connectionsAPI,
  orgAPI,
  orgSSE,
  type OrgConnection,
  type SyncEvent,
} from "@/lib/api";
import {
  CONNECTOR_CATALOG,
  CONNECTOR_META_BY_ID,
  type ConnectorMeta,
} from "@/lib/connectors";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

export const Route = createFileRoute("/dashboard/sources/")({
  component: SourcesPage,
});

// =============================================================================
// CONNECTOR DEFINITIONS
// =============================================================================

type ConnectorCard = ConnectorMeta & {
  available: boolean;
  configured: boolean;
  missingEnv: string[];
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function SourcesPage() {
  const { user, isLoading: authLoading } = useAuthStore();
  const t = useT();
  const queryClient = useQueryClient();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [backfillDialogOpen, setBackfillDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] =
    useState<OrgConnection | null>(null);
  const [backfillConnection, setBackfillConnection] =
    useState<OrgConnection | null>(null);
  const [backfillStart, setBackfillStart] = useState("");
  const [backfillEnd, setBackfillEnd] = useState("");
  const [backfillWindowDays, setBackfillWindowDays] = useState(7);
  const [backfillThrottleSeconds, setBackfillThrottleSeconds] = useState(1);
  const [liveSync, setLiveSync] = useState<Record<string, SyncEvent>>({});

  const {
    data: availableConnectors,
    isError: connectorsError,
    error: connectorsErrorObj,
    refetch: refetchConnectors,
  } = useQuery({
    queryKey: ["available-connectors"],
    queryFn: () => connectionsAPI.listConnectors(),
    enabled: !!user,
  });

  const availableById = useMemo(() => {
    return new Map((availableConnectors ?? []).map((connector) => [connector.type, connector]));
  }, [availableConnectors]);

  const connectors = useMemo<ConnectorCard[]>(() => {
    const catalog = CONNECTOR_CATALOG.map((meta) => {
      const server = availableById.get(meta.id);
      return {
        ...meta,
        available: Boolean(server),
        configured: server?.configured ?? false,
        missingEnv: server?.missing_env ?? [],
      };
    });

    const extras = Array.from(availableById.values())
      .filter((connector) => !CONNECTOR_META_BY_ID.has(connector.type))
      .map((connector) => ({
        id: connector.type,
        name: connector.type
          .replace(/_/g, " ")
          .replace(/\b\w/g, (m) => m.toUpperCase()),
        icon: FileText,
        color: "#64748B",
        descriptionKey: "pages.dashboard.sources.customConnector",
        category: "knowledge" as const,
        available: true,
        configured: connector.configured ?? true,
        missingEnv: connector.missing_env ?? [],
      }));

    return [...catalog, ...extras];
  }, [availableById]);

  const connectorMap = useMemo(
    () => new Map(connectors.map((connector) => [connector.id, connector])),
    [connectors]
  );

  const openBackfillDialog = (connection: OrgConnection) => {
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - 90);
    setBackfillStart(start.toISOString().slice(0, 10));
    setBackfillEnd(now.toISOString().slice(0, 10));
    setBackfillWindowDays(7);
    setBackfillThrottleSeconds(1);
    setBackfillConnection(connection);
    setBackfillDialogOpen(true);
  };

  // Check URL params for success/error messages
  const searchParams = new URLSearchParams(window.location.search);
  const connectionSuccess = searchParams.get("connection");
  const error = searchParams.get("error");

  // Show toast based on URL params
  useEffect(() => {
    if (connectionSuccess === "success") {
      toast.success(t("pages.dashboard.sources.toasts.connected"));
      window.history.replaceState({}, "", window.location.pathname);
      // Refetch connections
      queryClient.invalidateQueries({ queryKey: ["org-connections"] });
    } else if (error) {
      toast.error(t("pages.dashboard.sources.toasts.failedToConnect", { error }));
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [connectionSuccess, error, queryClient, t]);

  // Subscribe to SSE for real-time sync updates
  useEffect(() => {
    if (!user) return;

    const unsubscribe = orgSSE.subscribeSyncEvents(
      (event: SyncEvent) => {
        setLiveSync((prev) => ({
          ...prev,
          [event.connection_id]: {
            ...prev[event.connection_id],
            ...event,
          },
        }));

        if (event.event_type === "completed") {
          toast.success(t("pages.dashboard.sources.toasts.syncCompleted"));
          queryClient.invalidateQueries({ queryKey: ["org-connections"] });
        } else if (event.event_type === "failed") {
          const err = event.error || t("common.messages.unknownError");
          toast.error(t("pages.dashboard.sources.toasts.syncFailed", { error: err }));
          queryClient.invalidateQueries({ queryKey: ["org-connections"] });
        }
      },
      (error) => {
        console.error("SSE error:", error);
      }
    );

    return unsubscribe;
  }, [user, queryClient, t]);

  // Fetch connected sources
  const {
    data: connections,
    isLoading: connectionsLoading,
    isError: connectionsError,
    error: connectionsErrorObj,
    refetch: refetchConnections,
  } = useQuery({
    queryKey: ["org-connections"],
    queryFn: () => orgAPI.listConnections(),
    enabled: !!user,
  });

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: async (provider: string) => {
      const response = await orgAPI.initiateConnect(provider, {
        returnTo: window.location.pathname,
      });
      return response;
    },
    onSuccess: (data) => {
      // Redirect to OAuth
      window.location.href = data.auth_url;
    },
    onError: (error: Error) => {
      toast.error(t("pages.dashboard.sources.toasts.failedToConnect", { error: error.message }));
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      return orgAPI.triggerSync(connectionId);
    },
    onSuccess: () => {
      toast.success(t("pages.dashboard.sources.toasts.syncStarted"));
      refetchConnections();
    },
    onError: (error: Error) => {
      toast.error(t("pages.dashboard.sources.toasts.syncTriggerFailed", { error: error.message }));
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async (payload: {
      connectionId: string;
      startDate: string;
      endDate?: string;
      windowDays?: number;
      throttleSeconds?: number;
    }) =>
      orgAPI.triggerBackfill({
        connectionId: payload.connectionId,
        startDate: payload.startDate,
        endDate: payload.endDate,
        windowDays: payload.windowDays,
        throttleSeconds: payload.throttleSeconds,
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.sources.toasts.backfillQueued"));
      setBackfillDialogOpen(false);
      setBackfillConnection(null);
      queryClient.invalidateQueries({ queryKey: ["org-connections"] });
    },
    onError: (error: Error) => {
      toast.error(t("pages.dashboard.sources.toasts.backfillFailed", { error: error.message }));
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      return orgAPI.deleteConnection(connectionId);
    },
    onSuccess: () => {
      toast.success(t("pages.dashboard.sources.toasts.disconnected"));
      setDisconnectDialogOpen(false);
      setSelectedConnection(null);
      refetchConnections();
    },
    onError: (error: Error) => {
      toast.error(t("pages.dashboard.sources.toasts.disconnectFailed", { error: error.message }));
    },
  });

  const visibilityMutation = useMutation({
    mutationFn: async (payload: {
      connectionId: string;
      visibility: "org_shared" | "private";
    }) =>
      orgAPI.updateConnectionVisibility({
        connectionId: payload.connectionId,
        visibility: payload.visibility,
      }),
    onSuccess: (result) => {
      toast.success(
        result.visibility === "private"
          ? t("pages.dashboard.sources.toasts.visibilityPrivate")
          : t("pages.dashboard.sources.toasts.visibilityShared")
      );
      queryClient.invalidateQueries({ queryKey: ["org-connections"] });
    },
    onError: (error: Error) => {
      toast.error(t("pages.dashboard.sources.toasts.visibilityFailed", { error: error.message }));
    },
  });

  const handleConnect = (provider: string) => {
    connectMutation.mutate(provider);
  };

  const handleSync = (connectionId: string) => {
    syncMutation.mutate(connectionId);
  };

  const handleBackfill = () => {
    if (!backfillConnection || !backfillStart) return;
    const startDate = new Date(backfillStart).toISOString();
    const endDate = backfillEnd ? new Date(backfillEnd).toISOString() : undefined;
    backfillMutation.mutate({
      connectionId: backfillConnection.id,
      startDate,
      endDate,
      windowDays: backfillWindowDays,
      throttleSeconds: backfillThrottleSeconds,
    });
  };

  const handleDisconnect = () => {
    if (!selectedConnection) return;
    disconnectMutation.mutate(selectedConnection.id);
  };

  const handleSetVisibility = (
    connection: OrgConnection,
    visibility: "org_shared" | "private"
  ) => {
    visibilityMutation.mutate({
      connectionId: connection.id,
      visibility,
    });
  };

  // Loading state
  if (authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton className="h-48" key={i} />
          ))}
        </div>
      </div>
    );
  }

  // No user
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Mail className="h-12 w-12 text-muted-foreground" />
        <h2 className="mt-4 font-semibold text-xl">
          {t("pages.dashboard.sources.authRequired.title")}
        </h2>
        <p className="mt-2 text-muted-foreground">
          {t("pages.dashboard.sources.authRequired.description")}
        </p>
        <Link to="/login">
          <Button className="mt-4">{t("common.actions.signIn")}</Button>
        </Link>
      </div>
    );
  }

  const connectionsList = connections || [];
  const activeSyncCount = connectionsList.filter((connection) => {
    const live = liveSync[connection.id];
    return (
      live?.event_type === "started" ||
      live?.event_type === "progress" ||
      connection.status === "syncing" ||
      connection.progress !== null
    );
  }).length;

  // Group connections by category
  const emailConnections = connectionsList.filter((c) =>
    ["gmail", "outlook"].includes(c.provider)
  );
  const messagingConnections = connectionsList.filter((c) =>
    ["slack", "teams", "whatsapp"].includes(c.provider)
  );
  const calendarConnections = connectionsList.filter((c) =>
    ["google_calendar"].includes(c.provider)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">
            {t("nav.items.connectedSources")}
          </h1>
          <p className="text-muted-foreground">
            {t("pages.dashboard.sources.subtitle")}
          </p>
        </div>
        <Button
          disabled={user.role === "pilot_viewer"}
          onClick={() => {
            if (user.role === "pilot_viewer") {
              toast.error(t("pages.dashboard.sources.viewerNoConnect"));
              return;
            }
            setConnectDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("pages.dashboard.sources.connectSource")}
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("pages.dashboard.sources.stats.totalSources")}</CardDescription>
            <CardTitle className="text-2xl">{connectionsList.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("pages.dashboard.sources.stats.messagesSynced")}</CardDescription>
            <CardTitle className="text-2xl">
              {connectionsList
                .reduce((sum, c) => sum + c.messages_synced, 0)
                .toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("pages.dashboard.sources.stats.activeSyncs")}</CardDescription>
            <CardTitle className="text-2xl">
              {activeSyncCount}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Sources by Type */}
      <Tabs className="space-y-4" defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">
            {t("pages.dashboard.sources.tabs.all")} ({connectionsList.length})
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="mr-2 h-4 w-4" />
            {t("pages.dashboard.sources.tabs.email")} ({emailConnections.length})
          </TabsTrigger>
          <TabsTrigger value="messaging">
            <MessageCircle className="mr-2 h-4 w-4" />
            {t("pages.dashboard.sources.tabs.messaging")} ({messagingConnections.length})
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <Calendar className="mr-2 h-4 w-4" />
            {t("pages.dashboard.sources.tabs.calendar")} ({calendarConnections.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-4" value="all">
          {connectionsLoading ? (
            <SourcesSkeleton />
          ) : connectionsError ? (
            <ApiErrorPanel error={connectionsErrorObj} onRetry={() => refetchConnections()} />
          ) : connectionsList.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {connectionsList.map((connection) => (
                <SourceCard
                  connection={connection}
                  connector={connectorMap.get(connection.provider)}
                  key={connection.id}
                  liveState={liveSync[connection.id]}
                  readOnly={user.role === "pilot_viewer"}
                  onBackfill={() => openBackfillDialog(connection)}
                  onDisconnect={() => {
                    setSelectedConnection(connection);
                    setDisconnectDialogOpen(true);
                  }}
                  onSetVisibility={(visibility) =>
                    handleSetVisibility(connection, visibility)
                  }
                  onSync={() => handleSync(connection.id)}
                />
              ))}
            </div>
          ) : (
            <EmptySourcesCard onConnect={() => setConnectDialogOpen(true)} />
          )}
        </TabsContent>

        <TabsContent className="space-y-4" value="email">
          {connectionsError ? (
            <ApiErrorPanel error={connectionsErrorObj} onRetry={() => refetchConnections()} />
          ) : emailConnections.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {emailConnections.map((connection) => (
                <SourceCard
                  connection={connection}
                  connector={connectorMap.get(connection.provider)}
                  key={connection.id}
                  liveState={liveSync[connection.id]}
                  readOnly={user.role === "pilot_viewer"}
                  onBackfill={() => openBackfillDialog(connection)}
                  onDisconnect={() => {
                    setSelectedConnection(connection);
                    setDisconnectDialogOpen(true);
                  }}
                  onSetVisibility={(visibility) =>
                    handleSetVisibility(connection, visibility)
                  }
                  onSync={() => handleSync(connection.id)}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              category="email"
              onConnect={() => setConnectDialogOpen(true)}
            />
          )}
        </TabsContent>

        <TabsContent className="space-y-4" value="messaging">
          {connectionsError ? (
            <ApiErrorPanel error={connectionsErrorObj} onRetry={() => refetchConnections()} />
          ) : messagingConnections.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {messagingConnections.map((connection) => (
                <SourceCard
                  connection={connection}
                  connector={connectorMap.get(connection.provider)}
                  key={connection.id}
                  liveState={liveSync[connection.id]}
                  readOnly={user.role === "pilot_viewer"}
                  onBackfill={() => openBackfillDialog(connection)}
                  onDisconnect={() => {
                    setSelectedConnection(connection);
                    setDisconnectDialogOpen(true);
                  }}
                  onSetVisibility={(visibility) =>
                    handleSetVisibility(connection, visibility)
                  }
                  onSync={() => handleSync(connection.id)}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              category="messaging"
              onConnect={() => setConnectDialogOpen(true)}
            />
          )}
        </TabsContent>

        <TabsContent className="space-y-4" value="calendar">
          {connectionsError ? (
            <ApiErrorPanel error={connectionsErrorObj} onRetry={() => refetchConnections()} />
          ) : calendarConnections.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {calendarConnections.map((connection) => (
                <SourceCard
                  connection={connection}
                  connector={connectorMap.get(connection.provider)}
                  key={connection.id}
                  liveState={liveSync[connection.id]}
                  readOnly={user.role === "pilot_viewer"}
                  onBackfill={() => openBackfillDialog(connection)}
                  onDisconnect={() => {
                    setSelectedConnection(connection);
                    setDisconnectDialogOpen(true);
                  }}
                  onSetVisibility={(visibility) =>
                    handleSetVisibility(connection, visibility)
                  }
                  onSync={() => handleSync(connection.id)}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              category="calendar"
              onConnect={() => setConnectDialogOpen(true)}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Connect Source Dialog */}
      <Dialog onOpenChange={setConnectDialogOpen} open={connectDialogOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("pages.dashboard.sources.connectDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("pages.dashboard.sources.connectDialog.description")}
            </DialogDescription>
          </DialogHeader>
          {connectorsError && (
            <ApiErrorPanel
              error={connectorsErrorObj}
              onRetry={() => refetchConnectors()}
              retryLabel={t("pages.dashboard.sources.connectDialog.reloadConnectors")}
            />
          )}
          <div className="grid gap-4 overflow-y-auto py-4 pr-2">
            {/* Email */}
            <ConnectorCategory
              connectors={connectors.filter((c) => c.category === "email")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title={t("pages.dashboard.sources.categories.email")}
            />

            {/* Messaging */}
            <ConnectorCategory
              connectors={connectors.filter((c) => c.category === "messaging")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title={t("pages.dashboard.sources.categories.messaging")}
            />

            {/* Calendar */}
            <ConnectorCategory
              connectors={connectors.filter((c) => c.category === "calendar")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title={t("pages.dashboard.sources.categories.calendar")}
            />

            {/* Knowledge Base */}
            <ConnectorCategory
              connectors={connectors.filter((c) => c.category === "knowledge")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title={t("pages.dashboard.sources.categories.knowledge")}
            />

            {/* CRM */}
            <ConnectorCategory
              connectors={connectors.filter((c) => c.category === "crm")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title={t("pages.dashboard.sources.categories.crm")}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Backfill Dialog */}
      <Dialog
        onOpenChange={(open) => {
          setBackfillDialogOpen(open);
          if (!open) {
            setBackfillConnection(null);
          }
        }}
        open={backfillDialogOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("pages.dashboard.sources.backfillDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("pages.dashboard.sources.backfillDialog.descriptionPrefix")}{" "}
              <span className="font-medium text-foreground">
                {backfillConnection?.email ||
                  backfillConnection?.workspace ||
                  backfillConnection?.provider ||
                  t("pages.dashboard.sources.backfillDialog.thisSource")}
              </span>
              . {t("pages.dashboard.sources.backfillDialog.descriptionSuffix")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="backfill-start">{t("pages.dashboard.sources.backfillDialog.startDate")}</Label>
                <Input
                  id="backfill-start"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setBackfillStart(e.target.value)
                  }
                  type="date"
                  value={backfillStart}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="backfill-end">{t("pages.dashboard.sources.backfillDialog.endDate")}</Label>
                <Input
                  id="backfill-end"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setBackfillEnd(e.target.value)
                  }
                  type="date"
                  value={backfillEnd}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="backfill-window">{t("pages.dashboard.sources.backfillDialog.windowDays")}</Label>
                <Input
                  id="backfill-window"
                  min={1}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setBackfillWindowDays(Number(e.target.value))
                  }
                  type="number"
                  value={backfillWindowDays}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="backfill-throttle">{t("pages.dashboard.sources.backfillDialog.throttleSeconds")}</Label>
                <Input
                  id="backfill-throttle"
                  min={0}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setBackfillThrottleSeconds(Number(e.target.value))
                  }
                  step={0.5}
                  type="number"
                  value={backfillThrottleSeconds}
                />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              {t("pages.dashboard.sources.backfillDialog.note")}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => setBackfillDialogOpen(false)} variant="ghost">
              {t("common.actions.cancel")}
            </Button>
            <Button
              disabled={
                backfillMutation.isPending ||
                !backfillConnection ||
                !backfillStart
              }
              onClick={handleBackfill}
            >
              {backfillMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("pages.dashboard.sources.backfillDialog.starting")}
                </>
              ) : (
                t("pages.dashboard.sources.backfillDialog.startBackfill")
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog
        onOpenChange={setDisconnectDialogOpen}
        open={disconnectDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.dashboard.sources.disconnectDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.dashboard.sources.disconnectDialog.description", {
                source: selectedConnection?.email || selectedConnection?.workspace || "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={disconnectMutation.isPending}
              onClick={handleDisconnect}
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t("pages.dashboard.sources.disconnectDialog.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function ConnectorCategory({
  title,
  connectors,
  onConnect,
  isLoading,
}: {
  title: string;
  connectors: ConnectorCard[];
  onConnect: (provider: string) => void;
  isLoading: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <h4 className="font-medium text-muted-foreground text-sm">{title}</h4>
      <div className="grid gap-2">
        {connectors.map((connector) => (
          <Button
            className="h-auto justify-start gap-4 p-4"
            disabled={isLoading || !connector.available || !connector.configured}
            key={connector.id}
            onClick={() => onConnect(connector.id)}
            variant="outline"
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${connector.color}20` }}
            >
              <connector.icon
                className="h-6 w-6"
                style={{ color: connector.color }}
              />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-2 font-medium">
                {connector.name}
                {!connector.available ? (
                  <Badge variant="secondary">
                    {t("pages.dashboard.sources.badges.unavailable")}
                  </Badge>
                ) : !connector.configured ? (
                  <Badge variant="warning">
                    {t("pages.dashboard.sources.badges.notConfigured")}
                  </Badge>
                ) : (
                  <Badge variant="success">
                    {t("pages.dashboard.sources.badges.ready")}
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground text-sm">
                {t(connector.descriptionKey)}
              </div>
              {!connector.configured && connector.missingEnv.length ? (
                <div className="mt-1 text-muted-foreground text-xs">
                  {t("pages.dashboard.sources.missingEnv")}{" "}
                  <span className="font-mono">
                    {connector.missingEnv.join(", ")}
                  </span>
                </div>
              ) : null}
            </div>
            {isLoading && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SourceCard({
  connection,
  connector,
  liveState,
  onSync,
  onBackfill,
  onDisconnect,
  onSetVisibility,
  readOnly = false,
}: {
  connection: OrgConnection;
  connector?: ConnectorCard;
  liveState?: SyncEvent;
  onSync: () => void;
  onBackfill: () => void;
  onDisconnect: () => void;
  onSetVisibility?: (visibility: "org_shared" | "private") => void;
  readOnly?: boolean;
}) {
  const t = useT();
  const currentUser = useAuthStore((state) => state.user);
  const Icon = connector?.icon || Mail;
  const color = connector?.color || "#888";
  const visibility = connection.visibility ?? "org_shared";
  const isPrivate = visibility === "private";
  const isAdmin =
    currentUser?.role === "pilot_owner" || currentUser?.role === "pilot_admin";
  const isConnectionOwner =
    Boolean(connection.created_by_user_id) &&
    currentUser !== null &&
    connection.created_by_user_id === currentUser.user_id;
  const canToggleVisibility =
    !readOnly && Boolean(onSetVisibility) && (isAdmin || isConnectionOwner);

  const statusConfig: Record<
    string,
    { icon: React.ReactNode; color: string; label: string }
  > = {
    connected: {
      icon: <CheckCircle className="h-4 w-4" />,
      color: "text-green-600 dark:text-green-400",
      label: t("pages.dashboard.sources.status.connected"),
    },
    active: {
      icon: <CheckCircle className="h-4 w-4" />,
      color: "text-green-600 dark:text-green-400",
      label: t("pages.dashboard.sources.status.active"),
    },
    syncing: {
      icon: <RefreshCw className="h-4 w-4 animate-spin" />,
      color: "text-blue-600 dark:text-blue-400",
      label: t("pages.dashboard.sources.status.syncing"),
    },
    pending_auth: {
      icon: <AlertCircle className="h-4 w-4" />,
      color: "text-amber-600 dark:text-amber-400",
      label: t("pages.dashboard.sources.status.pendingAuth"),
    },
    error: {
      icon: <AlertCircle className="h-4 w-4" />,
      color: "text-red-600 dark:text-red-400",
      label: t("pages.dashboard.sources.status.error"),
    },
  };

  const connectionStatus =
    liveState?.event_type === "progress" || liveState?.event_type === "started"
      ? "syncing"
      : liveState?.event_type === "failed"
        ? "error"
        : liveState?.event_type === "completed"
          ? "connected"
          : connection.status;
  const status = statusConfig[connectionStatus] || statusConfig.connected;
  const progress =
    liveState?.progress ??
    (typeof connection.progress === "number" ? connection.progress : null);
  const backfillWindow = (() => {
    const params = liveState?.sync_params;
    if (!params || typeof params !== "object") return null;
    const idx = (params as Record<string, unknown>)["backfill_window_index"];
    const total = (params as Record<string, unknown>)["backfill_window_total"];
    if (typeof idx === "number" && typeof total === "number") {
      return { idx, total };
    }
    return null;
  })();
  const overallBackfillProgress = (() => {
    if (!backfillWindow) return null;
    const { idx, total } = backfillWindow;
    const perWindowProgress =
      typeof liveState?.progress === "number" ? liveState.progress : null;
    const eventType = liveState?.event_type;

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
  const effectiveProgress = progress ?? overallBackfillProgress;
  const liveIngestionStatus = connection.live_status ?? null;
  const backfillStatus = connection.backfill_status ?? null;
  const liveStatusLabel =
    liveIngestionStatus === "running"
      ? t("pages.dashboard.sources.liveStatus.running")
      : liveIngestionStatus === "paused"
        ? t("pages.dashboard.sources.liveStatus.paused")
        : liveIngestionStatus === "error"
          ? t("pages.dashboard.sources.liveStatus.error")
          : liveIngestionStatus;
  const backfillStatusLabel =
    backfillStatus === "not_started"
      ? t("pages.dashboard.sources.backfillStatus.notStarted")
      : backfillStatus === "running"
        ? t("pages.dashboard.sources.backfillStatus.running")
        : backfillStatus === "paused"
          ? t("pages.dashboard.sources.backfillStatus.paused")
          : backfillStatus === "done"
            ? t("pages.dashboard.sources.backfillStatus.done")
            : backfillStatus === "error"
              ? t("pages.dashboard.sources.backfillStatus.error")
              : backfillStatus;
  const displayName =
    connection.email ||
    connection.workspace ||
    connector?.name ||
    t("common.messages.unknown");
  const connectedBy = (() => {
    if (!connection.created_by_user_id) return null;
    if (currentUser && connection.created_by_user_id === currentUser.user_id) {
      return t("pages.dashboard.sources.connectedBy.you");
    }
    if (connection.created_by_name) {
      return t("pages.dashboard.sources.connectedBy.name", {
        name: connection.created_by_name,
      });
    }
    if (connection.created_by_email) {
      return t("pages.dashboard.sources.connectedBy.email", {
        email: connection.created_by_email,
      });
    }
    return t("pages.dashboard.sources.connectedBy.teammate");
  })();
  const recordsSynced =
    typeof liveState?.records_synced === "number"
      ? liveState.records_synced
      : connection.messages_synced;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${color}20` }}
          >
            <Icon className="h-5 w-5" style={{ color }} />
          </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{displayName}</CardTitle>
                <Badge
                  className={cn(
                    "h-5 px-2 text-[10px]",
                    isPrivate
                      ? "border-slate-500/30 bg-slate-500/10 text-slate-600"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                  )}
                  variant="outline"
                >
                  {isPrivate ? (
                    <span className="flex items-center gap-1">
                      <Lock className="h-3 w-3" />
                      {t("pages.dashboard.sources.visibility.private")}
                    </span>
                  ) : (
                    t("pages.dashboard.sources.visibility.orgShared")
                  )}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                {connector?.name || connection.provider}
                {connectedBy ? (
                  <span className="ml-2 text-muted-foreground/80">
                    · {connectedBy}
                  </span>
                ) : null}
              </CardDescription>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="h-8 w-8 p-0" variant="ghost">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              {t("pages.dashboard.sources.menu.settings")}
            </DropdownMenuItem>
            {canToggleVisibility ? (
              <DropdownMenuItem
                onClick={() =>
                  onSetVisibility?.(isPrivate ? "org_shared" : "private")
                }
              >
                <Lock className="mr-2 h-4 w-4" />
                {isPrivate
                  ? t("pages.dashboard.sources.menu.shareWithOrg")
                  : t("pages.dashboard.sources.menu.makePrivate")}
              </DropdownMenuItem>
            ) : null}
            {!readOnly ? (
              <>
                <DropdownMenuItem onClick={onBackfill}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("pages.dashboard.sources.menu.backfillHistory")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onSync}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("pages.dashboard.sources.menu.syncNow")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={onDisconnect}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("pages.dashboard.sources.menu.disconnect")}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Status */}
          <div className="flex items-center gap-2">
            <div className={cn("flex items-center gap-1", status.color)}>
              {status.icon}
              <span className="text-sm">{status.label}</span>
            </div>
            {effectiveProgress !== null && (
              <Badge className="text-xs" variant="secondary">
                {Math.round(effectiveProgress * 100)}%
              </Badge>
            )}
          </div>

          {backfillWindow ? (
            <div className="text-muted-foreground text-xs">
              {t("pages.dashboard.sources.backfillWindow")}{" "}
              <span className="font-mono text-foreground">
                {backfillWindow.idx}/{backfillWindow.total}
              </span>
            </div>
          ) : null}

          {(liveIngestionStatus || backfillStatus) && (
            <div className="flex flex-wrap items-center gap-2">
              {liveIngestionStatus && (
                <Badge
                  className={cn(
                    "text-xs",
                    liveIngestionStatus === "running" &&
                      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
                    liveIngestionStatus === "paused" &&
                      "border-slate-500/30 bg-slate-500/10 text-slate-600",
                    liveIngestionStatus === "error" &&
                      "border-red-500/30 bg-red-500/10 text-red-600"
                  )}
                >
                  {t("pages.dashboard.sources.badges.live", {
                    status: String(liveStatusLabel || liveIngestionStatus),
                  })}
                </Badge>
              )}
              {backfillStatus && (
                <Badge
                  className={cn(
                    "text-xs",
                    backfillStatus === "running" &&
                      "border-blue-500/30 bg-blue-500/10 text-blue-600",
                    backfillStatus === "done" &&
                      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
                    (backfillStatus === "not_started" ||
                      backfillStatus === "paused") &&
                      "border-slate-500/30 bg-slate-500/10 text-slate-600",
                    backfillStatus === "error" &&
                      "border-red-500/30 bg-red-500/10 text-red-600"
                  )}
                >
                  {t("pages.dashboard.sources.badges.backfill", {
                    status: String(backfillStatusLabel || backfillStatus),
                  })}
                </Badge>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <div className="flex items-center gap-1">
              <span>
                {t("pages.dashboard.sources.syncedCount", {
                  count: recordsSynced.toLocaleString(),
                })}
              </span>
            </div>
            {connection.last_sync && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>
                  {new Date(connection.last_sync).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>

          {effectiveProgress !== null && (
            <Progress
              className="h-1.5"
              value={Math.round(effectiveProgress * 100)}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SourcesSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Skeleton className="h-48" key={i} />
      ))}
    </div>
  );
}

function EmptySourcesCard({ onConnect }: { onConnect: () => void }) {
  const t = useT();
  return (
    <Card className="py-12">
      <CardContent className="flex flex-col items-center justify-center">
        <Mail className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 font-semibold text-lg">
          {t("pages.dashboard.sources.empty.all.title")}
        </h3>
        <p className="mt-2 max-w-md text-center text-muted-foreground">
          {t("pages.dashboard.sources.empty.all.description")}
        </p>
        <Button className="mt-4" onClick={onConnect}>
          <Plus className="mr-2 h-4 w-4" />
          {t("pages.dashboard.sources.empty.all.cta")}
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptySourceTypeCard({
  category,
  onConnect,
}: {
  category: string;
  onConnect: () => void;
}) {
  const t = useT();

  const categoryIcons: Record<
    string,
    React.ComponentType<{ className?: string }>
  > = {
    email: Mail,
    messaging: MessageCircle,
    calendar: Calendar,
    knowledge: FileText,
    crm: Target,
  };

  const Icon = categoryIcons[category] || Mail;
  const emptyCopy =
    category === "email"
      ? {
          title: t("pages.dashboard.sources.empty.email.title"),
          description: t("pages.dashboard.sources.empty.email.description"),
          cta: t("pages.dashboard.sources.empty.email.cta"),
        }
      : category === "messaging"
        ? {
            title: t("pages.dashboard.sources.empty.messaging.title"),
            description: t("pages.dashboard.sources.empty.messaging.description"),
            cta: t("pages.dashboard.sources.empty.messaging.cta"),
          }
        : category === "calendar"
          ? {
              title: t("pages.dashboard.sources.empty.calendar.title"),
              description: t("pages.dashboard.sources.empty.calendar.description"),
              cta: t("pages.dashboard.sources.empty.calendar.cta"),
            }
          : category === "knowledge"
            ? {
                title: t("pages.dashboard.sources.empty.knowledge.title"),
                description: t("pages.dashboard.sources.empty.knowledge.description"),
                cta: t("pages.dashboard.sources.empty.knowledge.cta"),
              }
            : category === "crm"
              ? {
                  title: t("pages.dashboard.sources.empty.crm.title"),
                  description: t("pages.dashboard.sources.empty.crm.description"),
                  cta: t("pages.dashboard.sources.empty.crm.cta"),
                }
              : {
                  title: t("pages.dashboard.sources.empty.all.title"),
                  description: t("pages.dashboard.sources.empty.all.description"),
                  cta: t("pages.dashboard.sources.empty.all.cta"),
                };

  return (
    <Card className="py-8">
      <CardContent className="flex flex-col items-center justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold text-lg">{emptyCopy.title}</h3>
        <p className="mt-2 text-center text-muted-foreground">
          {emptyCopy.description}
        </p>
        <Button className="mt-4" onClick={onConnect} variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          {emptyCopy.cta}
        </Button>
      </CardContent>
    </Card>
  );
}
