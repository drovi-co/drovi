// =============================================================================
// SOURCES PAGE - Multi-Source Connection Management
// =============================================================================

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  Hash,
  Loader2,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import { useState } from "react";
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
import { authClient } from "@/lib/auth-client";
import {
  getSourceColor,
  getSourceConfig,
  getSourceLabel,
  type SourceType,
} from "@/lib/source-config";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard/sources/")({
  component: SourcesPage,
});

// =============================================================================
// TYPES
// =============================================================================

interface ConnectedSource {
  id: string;
  type: SourceType;
  provider: string;
  identifier: string;
  displayName: string;
  status: string;
  lastSyncAt: string | null;
  isLegacy: boolean;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function SourcesPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<ConnectedSource | null>(
    null
  );

  // Check URL params for success/error messages
  const searchParams = new URLSearchParams(window.location.search);
  const success = searchParams.get("success");
  const error = searchParams.get("error");
  const sourceType = searchParams.get("source");

  // Show toast based on URL params
  if (success === "true" && sourceType) {
    toast.success(`${getSourceLabel(sourceType as SourceType)} connected successfully!`);
    window.history.replaceState({}, "", window.location.pathname);
  } else if (error) {
    toast.error(`Failed to connect: ${error}`);
    window.history.replaceState({}, "", window.location.pathname);
  }

  // Fetch connected sources
  const {
    data: sourcesData,
    isLoading: sourcesLoading,
    refetch: refetchSources,
  } = useQuery({
    ...trpc.unifiedInbox.getSources.queryOptions(),
    enabled: !!activeOrg?.id,
  });

  // Fetch inbox stats
  const { data: stats } = useQuery({
    ...trpc.unifiedInbox.getStats.queryOptions(),
    enabled: !!activeOrg?.id,
  });

  // Email connect mutation (existing)
  const connectEmailMutation = useMutation({
    ...trpc.emailAccounts.connect.mutationOptions(),
    onSuccess: (data) => {
      window.location.href = data.authorizationUrl;
    },
    onError: (error) => {
      toast.error(`Failed to connect: ${error.message}`);
    },
  });

  // Source disconnect mutation
  const disconnectMutation = useMutation({
    ...trpc.sources.disconnect.mutationOptions(),
    onSuccess: () => {
      toast.success("Source disconnected successfully");
      setDisconnectDialogOpen(false);
      setSelectedSource(null);
      refetchSources();
    },
    onError: (error) => {
      toast.error(`Failed to disconnect: ${error.message}`);
    },
  });

  const handleConnectEmail = (provider: "gmail" | "outlook") => {
    if (!activeOrg?.id) return;
    connectEmailMutation.mutate({
      organizationId: activeOrg.id,
      provider,
    });
  };

  // Get current user ID from auth client
  const { data: session } = authClient.useSession();

  const handleConnectSlack = () => {
    // Redirect to Slack OAuth endpoint
    const params = new URLSearchParams({
      organizationId: activeOrg?.id ?? "",
      userId: session?.user?.id ?? "",
      redirect: window.location.href,
    });
    window.location.href = `/api/oauth/slack/authorize?${params.toString()}`;
  };

  const handleConnectWhatsApp = () => {
    // Redirect to WhatsApp OAuth endpoint
    const params = new URLSearchParams({
      organizationId: activeOrg?.id ?? "",
      userId: session?.user?.id ?? "",
      redirect: window.location.href,
    });
    window.location.href = `/api/oauth/whatsapp/authorize?${params.toString()}`;
  };

  const handleDisconnect = () => {
    if (!(activeOrg?.id && selectedSource)) return;
    disconnectMutation.mutate({
      organizationId: activeOrg.id,
      sourceAccountId: selectedSource.id,
    });
  };

  // Loading state
  if (orgLoading) {
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

  // No org selected
  if (!activeOrg) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Mail className="h-12 w-12 text-muted-foreground" />
        <h2 className="mt-4 font-semibold text-xl">No Organization Selected</h2>
        <p className="mt-2 text-muted-foreground">
          Create or select an organization to manage sources
        </p>
        <Link to="/onboarding/create-org">
          <Button className="mt-4">Create Organization</Button>
        </Link>
      </div>
    );
  }

  const sources = sourcesData?.sources ?? [];
  const emailSources = sources.filter((s) => s.type === "email");
  const slackSources = sources.filter((s) => s.type === "slack");
  const calendarSources = sources.filter((s) => s.type === "calendar");
  const whatsappSources = sources.filter((s) => s.type === "whatsapp");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">Connected Sources</h1>
          <p className="text-muted-foreground">
            Manage data sources for your multi-source intelligence platform
          </p>
        </div>
        <Button onClick={() => setConnectDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Connect Source
        </Button>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Conversations</CardDescription>
              <CardTitle className="text-2xl">{stats.total.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Unread</CardDescription>
              <CardTitle className="text-2xl">{stats.unread.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Connected Sources</CardDescription>
              <CardTitle className="text-2xl">{sources.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Source Types</CardDescription>
              <CardTitle className="text-2xl">
                {Object.keys(stats.bySource).length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Sources by Type */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Sources ({sources.length})</TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="mr-2 h-4 w-4" />
            Email ({emailSources.length})
          </TabsTrigger>
          <TabsTrigger value="slack">
            <Hash className="mr-2 h-4 w-4" />
            Slack ({slackSources.length})
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <Calendar className="mr-2 h-4 w-4" />
            Calendar ({calendarSources.length})
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <MessageCircle className="mr-2 h-4 w-4" />
            WhatsApp ({whatsappSources.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {sourcesLoading ? (
            <SourcesSkeleton />
          ) : sources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source as ConnectedSource}
                  stats={stats?.bySource[source.type]}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptySourcesCard onConnect={() => setConnectDialogOpen(true)} />
          )}
        </TabsContent>

        <TabsContent value="email" className="space-y-4">
          {emailSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {emailSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source as ConnectedSource}
                  stats={stats?.bySource.email}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              type="email"
              onConnect={() => setConnectDialogOpen(true)}
            />
          )}
        </TabsContent>

        <TabsContent value="slack" className="space-y-4">
          {slackSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {slackSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source as ConnectedSource}
                  stats={stats?.bySource.slack}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              type="slack"
              onConnect={() => setConnectDialogOpen(true)}
            />
          )}
        </TabsContent>

        <TabsContent value="calendar" className="space-y-4">
          {calendarSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {calendarSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source as ConnectedSource}
                  stats={stats?.bySource.calendar}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              type="calendar"
              onConnect={() => setConnectDialogOpen(true)}
            />
          )}
        </TabsContent>

        <TabsContent value="whatsapp" className="space-y-4">
          {whatsappSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {whatsappSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source as ConnectedSource}
                  stats={stats?.bySource.whatsapp}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              type="whatsapp"
              onConnect={() => setConnectDialogOpen(true)}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Connect Source Dialog */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect a Source</DialogTitle>
            <DialogDescription>
              Choose a data source to connect to your intelligence platform
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Email */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Email</h4>
              <div className="grid gap-2">
                <Button
                  variant="outline"
                  className="h-auto justify-start gap-4 p-4"
                  onClick={() => handleConnectEmail("gmail")}
                  disabled={connectEmailMutation.isPending}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900">
                    <Mail className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Gmail</div>
                    <div className="text-muted-foreground text-sm">
                      Connect your Google account
                    </div>
                  </div>
                  {connectEmailMutation.isPending && (
                    <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="h-auto justify-start gap-4 p-4"
                  onClick={() => handleConnectEmail("outlook")}
                  disabled={connectEmailMutation.isPending}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900">
                    <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Outlook</div>
                    <div className="text-muted-foreground text-sm">
                      Connect your Microsoft account
                    </div>
                  </div>
                </Button>
              </div>
            </div>

            {/* Slack */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Team Chat</h4>
              <Button
                variant="outline"
                className="h-auto w-full justify-start gap-4 p-4"
                onClick={handleConnectSlack}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: "#4A154B20" }}
                >
                  <Hash className="h-6 w-6" style={{ color: "#4A154B" }} />
                </div>
                <div className="text-left">
                  <div className="font-medium">Slack</div>
                  <div className="text-muted-foreground text-sm">
                    Connect your Slack workspace
                  </div>
                </div>
              </Button>
            </div>

            {/* WhatsApp */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Messaging</h4>
              <Button
                variant="outline"
                className="h-auto w-full justify-start gap-4 p-4"
                onClick={handleConnectWhatsApp}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900">
                  <MessageCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <div className="text-left">
                  <div className="font-medium">WhatsApp Business</div>
                  <div className="text-muted-foreground text-sm">
                    Connect your WhatsApp Business account
                  </div>
                </div>
              </Button>
            </div>

            {/* Coming Soon */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Coming Soon</h4>
              <div className="grid gap-2 opacity-50">
                <Button
                  variant="outline"
                  className="h-auto justify-start gap-4 p-4"
                  disabled
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-900">
                    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4zm2 0v16h12V4H6zm2 2h8v2H8V6zm0 4h8v2H8v-2zm0 4h5v2H8v-2z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Notion</div>
                    <div className="text-muted-foreground text-sm">Coming soon</div>
                  </div>
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Disconnect Confirmation Dialog */}
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Source</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect {selectedSource?.displayName}? This
              will stop syncing data from this source. Existing data will be preserved.
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

function SourceCard({
  source,
  stats,
  onDisconnect,
}: {
  source: ConnectedSource;
  stats?: { total: number; unread: number };
  onDisconnect: () => void;
}) {
  const config = getSourceConfig(source.type);
  const Icon = config.icon;
  const color = getSourceColor(source.type);

  const statusConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
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
    disconnected: {
      icon: <AlertCircle className="h-4 w-4" />,
      color: "text-gray-500",
      label: "Disconnected",
    },
    error: {
      icon: <AlertCircle className="h-4 w-4" />,
      color: "text-red-600 dark:text-red-400",
      label: "Error",
    },
  };

  const status = statusConfig[source.status] ?? statusConfig.disconnected;

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
            <CardTitle className="text-base">{source.displayName}</CardTitle>
            <CardDescription className="text-xs">
              {config.label} • {source.identifier}
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
            <DropdownMenuItem>
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync Now
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDisconnect}>
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
            {source.isLegacy && (
              <Badge variant="outline" className="text-xs">
                Legacy
              </Badge>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-muted-foreground text-sm">
            {stats && (
              <div className="flex items-center gap-1">
                <span>{stats.total.toLocaleString()} items</span>
                {stats.unread > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {stats.unread} unread
                  </Badge>
                )}
              </div>
            )}
            {source.lastSyncAt && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{new Date(source.lastSyncAt).toLocaleDateString()}</span>
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
        <p className="mt-2 text-center text-muted-foreground max-w-md">
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
  type,
  onConnect,
}: {
  type: SourceType;
  onConnect: () => void;
}) {
  const config = getSourceConfig(type);
  const Icon = config.icon;
  const color = getSourceColor(type);

  return (
    <Card className="py-8">
      <CardContent className="flex flex-col items-center justify-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}20` }}
        >
          <Icon className="h-6 w-6" style={{ color }} />
        </div>
        <h3 className="mt-4 font-semibold text-lg">No {config.label} connected</h3>
        <p className="mt-2 text-center text-muted-foreground">
          {config.description}
        </p>
        <Button className="mt-4" variant="outline" onClick={onConnect}>
          <Plus className="mr-2 h-4 w-4" />
          Connect {config.label}
        </Button>
      </CardContent>
    </Card>
  );
}
