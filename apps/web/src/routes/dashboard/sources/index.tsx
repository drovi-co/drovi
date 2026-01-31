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
  Hash,
  Loader2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Plus,
  RefreshCw,
  Settings,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/lib/auth";
import { orgAPI, orgSSE, type OrgConnection, type SyncEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/sources/")({
  component: SourcesPage,
});

// =============================================================================
// CONNECTOR DEFINITIONS
// =============================================================================

interface ConnectorInfo {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
  description: string;
  category: "email" | "messaging" | "calendar" | "knowledge" | "crm";
  available: boolean;
}

const CONNECTORS: ConnectorInfo[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: Mail,
    color: "#EA4335",
    description: "Email messages and threads from Gmail",
    category: "email",
    available: true,
  },
  {
    id: "outlook",
    name: "Outlook",
    icon: Mail,
    color: "#0078D4",
    description: "Email messages from Microsoft Outlook",
    category: "email",
    available: true,
  },
  {
    id: "slack",
    name: "Slack",
    icon: Hash,
    color: "#4A154B",
    description: "Messages and channels from Slack workspaces",
    category: "messaging",
    available: true,
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    icon: Users,
    color: "#6264A7",
    description: "Chats and channel messages from Teams",
    category: "messaging",
    available: true,
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    icon: Phone,
    color: "#25D366",
    description: "Business messages from WhatsApp",
    category: "messaging",
    available: true,
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    icon: Calendar,
    color: "#4285F4",
    description: "Events and meetings from Google Calendar",
    category: "calendar",
    available: true,
  },
  {
    id: "notion",
    name: "Notion",
    icon: FileText,
    color: "#000000",
    description: "Pages and databases from Notion",
    category: "knowledge",
    available: true,
  },
  {
    id: "google_docs",
    name: "Google Docs",
    icon: FileText,
    color: "#4285F4",
    description: "Documents from Google Drive",
    category: "knowledge",
    available: true,
  },
  {
    id: "hubspot",
    name: "HubSpot",
    icon: Target,
    color: "#FF7A59",
    description: "Contacts, deals, and engagements from HubSpot CRM",
    category: "crm",
    available: true,
  },
];

function getConnectorInfo(providerId: string): ConnectorInfo | undefined {
  return CONNECTORS.find((c) => c.id === providerId);
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function SourcesPage() {
  const { user, isLoading: authLoading } = useAuthStore();
  const queryClient = useQueryClient();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] =
    useState<OrgConnection | null>(null);

  // Check URL params for success/error messages
  const searchParams = new URLSearchParams(window.location.search);
  const connectionSuccess = searchParams.get("connection");
  const error = searchParams.get("error");

  // Show toast based on URL params
  useEffect(() => {
    if (connectionSuccess === "success") {
      toast.success("Source connected successfully!");
      window.history.replaceState({}, "", window.location.pathname);
      // Refetch connections
      queryClient.invalidateQueries({ queryKey: ["org-connections"] });
    } else if (error) {
      toast.error(`Failed to connect: ${error}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [connectionSuccess, error, queryClient]);

  // Subscribe to SSE for real-time sync updates
  useEffect(() => {
    if (!user) return;

    const unsubscribe = orgSSE.subscribeSyncEvents(
      (event: SyncEvent) => {
        if (event.event_type === "completed") {
          toast.success("Sync completed!");
          queryClient.invalidateQueries({ queryKey: ["org-connections"] });
        } else if (event.event_type === "failed") {
          toast.error(`Sync failed: ${event.error || "Unknown error"}`);
          queryClient.invalidateQueries({ queryKey: ["org-connections"] });
        }
      },
      (error) => {
        console.error("SSE error:", error);
      }
    );

    return unsubscribe;
  }, [user, queryClient]);

  // Fetch connected sources
  const {
    data: connections,
    isLoading: connectionsLoading,
    refetch: refetchConnections,
  } = useQuery({
    queryKey: ["org-connections"],
    queryFn: () => orgAPI.listConnections(),
    enabled: !!user,
  });

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: async (provider: string) => {
      const response = await orgAPI.initiateConnect(provider);
      return response;
    },
    onSuccess: (data) => {
      // Redirect to OAuth
      window.location.href = data.auth_url;
    },
    onError: (error: Error) => {
      toast.error(`Failed to connect: ${error.message}`);
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      return orgAPI.triggerSync(connectionId);
    },
    onSuccess: () => {
      toast.success("Sync started!");
      refetchConnections();
    },
    onError: (error: Error) => {
      toast.error(`Failed to trigger sync: ${error.message}`);
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      return orgAPI.deleteConnection(connectionId);
    },
    onSuccess: () => {
      toast.success("Source disconnected successfully");
      setDisconnectDialogOpen(false);
      setSelectedConnection(null);
      refetchConnections();
    },
    onError: (error: Error) => {
      toast.error(`Failed to disconnect: ${error.message}`);
    },
  });

  const handleConnect = (provider: string) => {
    connectMutation.mutate(provider);
  };

  const handleSync = (connectionId: string) => {
    syncMutation.mutate(connectionId);
  };

  const handleDisconnect = () => {
    if (!selectedConnection) return;
    disconnectMutation.mutate(selectedConnection.id);
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
        <h2 className="mt-4 font-semibold text-xl">Not Authenticated</h2>
        <p className="mt-2 text-muted-foreground">
          Please log in to manage your data sources
        </p>
        <Link to="/login">
          <Button className="mt-4">Log In</Button>
        </Link>
      </div>
    );
  }

  const connectionsList = connections || [];

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
            Connected Sources
          </h1>
          <p className="text-muted-foreground">
            Manage data sources for your intelligence platform
          </p>
        </div>
        <Button onClick={() => setConnectDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Connect Source
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Sources</CardDescription>
            <CardTitle className="text-2xl">{connectionsList.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Messages Synced</CardDescription>
            <CardTitle className="text-2xl">
              {connectionsList
                .reduce((sum, c) => sum + c.messages_synced, 0)
                .toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Syncs</CardDescription>
            <CardTitle className="text-2xl">
              {connectionsList.filter((c) => c.progress !== null).length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Sources by Type */}
      <Tabs className="space-y-4" defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">
            All Sources ({connectionsList.length})
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="mr-2 h-4 w-4" />
            Email ({emailConnections.length})
          </TabsTrigger>
          <TabsTrigger value="messaging">
            <MessageCircle className="mr-2 h-4 w-4" />
            Messaging ({messagingConnections.length})
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <Calendar className="mr-2 h-4 w-4" />
            Calendar ({calendarConnections.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-4" value="all">
          {connectionsLoading ? (
            <SourcesSkeleton />
          ) : connectionsList.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {connectionsList.map((connection) => (
                <SourceCard
                  connection={connection}
                  key={connection.id}
                  onDisconnect={() => {
                    setSelectedConnection(connection);
                    setDisconnectDialogOpen(true);
                  }}
                  onSync={() => handleSync(connection.id)}
                />
              ))}
            </div>
          ) : (
            <EmptySourcesCard onConnect={() => setConnectDialogOpen(true)} />
          )}
        </TabsContent>

        <TabsContent className="space-y-4" value="email">
          {emailConnections.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {emailConnections.map((connection) => (
                <SourceCard
                  connection={connection}
                  key={connection.id}
                  onDisconnect={() => {
                    setSelectedConnection(connection);
                    setDisconnectDialogOpen(true);
                  }}
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
          {messagingConnections.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {messagingConnections.map((connection) => (
                <SourceCard
                  connection={connection}
                  key={connection.id}
                  onDisconnect={() => {
                    setSelectedConnection(connection);
                    setDisconnectDialogOpen(true);
                  }}
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
          {calendarConnections.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {calendarConnections.map((connection) => (
                <SourceCard
                  connection={connection}
                  key={connection.id}
                  onDisconnect={() => {
                    setSelectedConnection(connection);
                    setDisconnectDialogOpen(true);
                  }}
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
            <DialogTitle>Connect a Source</DialogTitle>
            <DialogDescription>
              Choose a data source to connect to your intelligence platform
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 overflow-y-auto py-4 pr-2">
            {/* Email */}
            <ConnectorCategory
              connectors={CONNECTORS.filter((c) => c.category === "email")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title="Email"
            />

            {/* Messaging */}
            <ConnectorCategory
              connectors={CONNECTORS.filter((c) => c.category === "messaging")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title="Messaging"
            />

            {/* Calendar */}
            <ConnectorCategory
              connectors={CONNECTORS.filter((c) => c.category === "calendar")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title="Calendar"
            />

            {/* Knowledge Base */}
            <ConnectorCategory
              connectors={CONNECTORS.filter((c) => c.category === "knowledge")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title="Knowledge Base"
            />

            {/* CRM */}
            <ConnectorCategory
              connectors={CONNECTORS.filter((c) => c.category === "crm")}
              isLoading={connectMutation.isPending}
              onConnect={handleConnect}
              title="CRM"
            />
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
            <AlertDialogTitle>Disconnect Source</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect{" "}
              {selectedConnection?.email || selectedConnection?.workspace}? This
              will stop syncing data from this source. Existing data will be
              preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
              Disconnect
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
  connectors: ConnectorInfo[];
  onConnect: (provider: string) => void;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-2">
      <h4 className="font-medium text-muted-foreground text-sm">{title}</h4>
      <div className="grid gap-2">
        {connectors.map((connector) => (
          <Button
            className="h-auto justify-start gap-4 p-4"
            disabled={isLoading || !connector.available}
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
              <div className="font-medium">{connector.name}</div>
              <div className="text-muted-foreground text-sm">
                {connector.description}
              </div>
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
  onSync,
  onDisconnect,
}: {
  connection: OrgConnection;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  const connectorInfo = getConnectorInfo(connection.provider);
  const Icon = connectorInfo?.icon || Mail;
  const color = connectorInfo?.color || "#888";

  const statusConfig: Record<
    string,
    { icon: React.ReactNode; color: string; label: string }
  > = {
    connected: {
      icon: <CheckCircle className="h-4 w-4" />,
      color: "text-green-600 dark:text-green-400",
      label: "Connected",
    },
    active: {
      icon: <CheckCircle className="h-4 w-4" />,
      color: "text-green-600 dark:text-green-400",
      label: "Active",
    },
    syncing: {
      icon: <RefreshCw className="h-4 w-4 animate-spin" />,
      color: "text-blue-600 dark:text-blue-400",
      label: "Syncing",
    },
    pending_auth: {
      icon: <AlertCircle className="h-4 w-4" />,
      color: "text-amber-600 dark:text-amber-400",
      label: "Pending Auth",
    },
    error: {
      icon: <AlertCircle className="h-4 w-4" />,
      color: "text-red-600 dark:text-red-400",
      label: "Error",
    },
  };

  const status = statusConfig[connection.status] || statusConfig.connected;
  const displayName =
    connection.email || connection.workspace || connectorInfo?.name || "Unknown";

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
          <div>
            <CardTitle className="text-base">{displayName}</CardTitle>
            <CardDescription className="text-xs">
              {connectorInfo?.name || connection.provider}
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
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSync}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync Now
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={onDisconnect}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Disconnect
            </DropdownMenuItem>
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
            {connection.progress !== null && (
              <Badge className="text-xs" variant="secondary">
                {Math.round(connection.progress * 100)}%
              </Badge>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            <div className="flex items-center gap-1">
              <span>{connection.messages_synced.toLocaleString()} synced</span>
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
  return (
    <Card className="py-12">
      <CardContent className="flex flex-col items-center justify-center">
        <Mail className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 font-semibold text-lg">No sources connected</h3>
        <p className="mt-2 max-w-md text-center text-muted-foreground">
          Connect your email, Slack, calendar, and other sources to build your
          unified intelligence platform
        </p>
        <Button className="mt-4" onClick={onConnect}>
          <Plus className="mr-2 h-4 w-4" />
          Connect Your First Source
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
  const categoryLabels: Record<string, string> = {
    email: "Email",
    messaging: "Messaging",
    calendar: "Calendar",
    knowledge: "Knowledge Base",
    crm: "CRM",
  };

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
  const label = categoryLabels[category] || category;

  return (
    <Card className="py-8">
      <CardContent className="flex flex-col items-center justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-semibold text-lg">No {label} connected</h3>
        <p className="mt-2 text-center text-muted-foreground">
          Connect a {label.toLowerCase()} source to get started
        </p>
        <Button className="mt-4" onClick={onConnect} variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Connect {label}
        </Button>
      </CardContent>
    </Card>
  );
}
