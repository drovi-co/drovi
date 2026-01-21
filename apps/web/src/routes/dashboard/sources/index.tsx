// =============================================================================
// SOURCES PAGE - Multi-Source Connection Management
// =============================================================================

import { env } from "@memorystack/env/web";
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
    toast.success(
      `${getSourceLabel(sourceType as SourceType)} connected successfully!`
    );
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
    window.location.href = `${env.VITE_SERVER_URL}/api/oauth/slack/authorize?${params.toString()}`;
  };

  const handleConnectWhatsApp = () => {
    // Redirect to WhatsApp OAuth endpoint
    const params = new URLSearchParams({
      organizationId: activeOrg?.id ?? "",
      userId: session?.user?.id ?? "",
      redirect: window.location.pathname,
    });
    window.location.href = `${env.VITE_SERVER_URL}/api/oauth/whatsapp/authorize?${params.toString()}`;
  };

  const handleConnectNotion = () => {
    // Redirect to Notion OAuth endpoint
    const params = new URLSearchParams({
      organizationId: activeOrg?.id ?? "",
      userId: session?.user?.id ?? "",
      redirect: window.location.pathname,
    });
    window.location.href = `${env.VITE_SERVER_URL}/api/oauth/notion/authorize?${params.toString()}`;
  };

  const handleConnectGoogleDocs = () => {
    // Redirect to Google Docs OAuth endpoint
    const params = new URLSearchParams({
      organizationId: activeOrg?.id ?? "",
      userId: session?.user?.id ?? "",
      redirect: window.location.pathname,
    });
    window.location.href = `${env.VITE_SERVER_URL}/api/oauth/google-docs/authorize?${params.toString()}`;
  };

  const handleConnectGoogleSheets = () => {
    // Google Sheets uses same OAuth as Google Docs
    const params = new URLSearchParams({
      organizationId: activeOrg?.id ?? "",
      userId: session?.user?.id ?? "",
      redirect: window.location.pathname,
    });
    window.location.href = `${env.VITE_SERVER_URL}/api/oauth/google-docs/authorize?${params.toString()}`;
  };

  const handleConnectCalendar = () => {
    // Calendar uses Gmail OAuth - connect via email first
    if (!activeOrg?.id) return;
    connectEmailMutation.mutate({
      organizationId: activeOrg.id,
      provider: "gmail",
    });
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
  const notionSources = sources.filter((s) => s.type === "notion");
  const googleDocsSources = sources.filter((s) => s.type === "google_docs");
  const googleSheetsSources = sources.filter((s) => s.type === "google_sheets");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">
            Connected Sources
          </h1>
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
              <CardTitle className="text-2xl">
                {stats.total.toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Unread</CardDescription>
              <CardTitle className="text-2xl">
                {stats.unread.toLocaleString()}
              </CardTitle>
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
      <Tabs className="space-y-4" defaultValue="all">
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

        <TabsContent className="space-y-4" value="all">
          {sourcesLoading ? (
            <SourcesSkeleton />
          ) : sources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sources.map((source) => (
                <SourceCard
                  key={source.id}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                  source={source as ConnectedSource}
                  stats={stats?.bySource[source.type]}
                />
              ))}
            </div>
          ) : (
            <EmptySourcesCard onConnect={() => setConnectDialogOpen(true)} />
          )}
        </TabsContent>

        <TabsContent className="space-y-4" value="email">
          {emailSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {emailSources.map((source) => (
                <SourceCard
                  key={source.id}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                  source={source as ConnectedSource}
                  stats={stats?.bySource.email}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              onConnect={() => setConnectDialogOpen(true)}
              type="email"
            />
          )}
        </TabsContent>

        <TabsContent className="space-y-4" value="slack">
          {slackSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {slackSources.map((source) => (
                <SourceCard
                  key={source.id}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                  source={source as ConnectedSource}
                  stats={stats?.bySource.slack}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              onConnect={() => setConnectDialogOpen(true)}
              type="slack"
            />
          )}
        </TabsContent>

        <TabsContent className="space-y-4" value="calendar">
          {calendarSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {calendarSources.map((source) => (
                <SourceCard
                  key={source.id}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                  source={source as ConnectedSource}
                  stats={stats?.bySource.calendar}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              onConnect={() => setConnectDialogOpen(true)}
              type="calendar"
            />
          )}
        </TabsContent>

        <TabsContent className="space-y-4" value="whatsapp">
          {whatsappSources.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {whatsappSources.map((source) => (
                <SourceCard
                  key={source.id}
                  onDisconnect={() => {
                    setSelectedSource(source as ConnectedSource);
                    setDisconnectDialogOpen(true);
                  }}
                  source={source as ConnectedSource}
                  stats={stats?.bySource.whatsapp}
                />
              ))}
            </div>
          ) : (
            <EmptySourceTypeCard
              onConnect={() => setConnectDialogOpen(true)}
              type="whatsapp"
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
            <div className="space-y-2">
              <h4 className="font-medium text-muted-foreground text-sm">
                Email
              </h4>
              <div className="grid gap-2">
                <Button
                  className="h-auto justify-start gap-4 p-4"
                  disabled={connectEmailMutation.isPending}
                  onClick={() => handleConnectEmail("gmail")}
                  variant="outline"
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
                  className="h-auto justify-start gap-4 p-4"
                  disabled={connectEmailMutation.isPending}
                  onClick={() => handleConnectEmail("outlook")}
                  variant="outline"
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
              <h4 className="font-medium text-muted-foreground text-sm">
                Team Chat
              </h4>
              <Button
                className="h-auto w-full justify-start gap-4 p-4"
                onClick={handleConnectSlack}
                variant="outline"
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
              <h4 className="font-medium text-muted-foreground text-sm">
                Messaging
              </h4>
              <Button
                className="h-auto w-full justify-start gap-4 p-4"
                onClick={handleConnectWhatsApp}
                variant="outline"
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

            {/* Calendar */}
            <div className="space-y-2">
              <h4 className="font-medium text-muted-foreground text-sm">
                Calendar
              </h4>
              <Button
                className="h-auto w-full justify-start gap-4 p-4"
                disabled={connectEmailMutation.isPending}
                onClick={handleConnectCalendar}
                variant="outline"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900">
                  <Calendar className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="text-left">
                  <div className="font-medium">Google Calendar</div>
                  <div className="text-muted-foreground text-sm">
                    Connect your calendar for event tracking
                  </div>
                </div>
                {connectEmailMutation.isPending && (
                  <Loader2 className="ml-auto h-4 w-4 animate-spin" />
                )}
              </Button>
            </div>

            {/* Knowledge Base */}
            <div className="space-y-2">
              <h4 className="font-medium text-muted-foreground text-sm">
                Knowledge Base
              </h4>
              <div className="grid gap-2">
                <Button
                  className="h-auto justify-start gap-4 p-4"
                  onClick={handleConnectNotion}
                  variant="outline"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                    <svg
                      className="h-6 w-6"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4zm2 0v16h12V4H6zm2 2h8v2H8V6zm0 4h8v2H8v-2zm0 4h5v2H8v-2z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Notion</div>
                    <div className="text-muted-foreground text-sm">
                      Pages, databases, and comments
                    </div>
                  </div>
                </Button>
                <Button
                  className="h-auto justify-start gap-4 p-4"
                  onClick={handleConnectGoogleDocs}
                  variant="outline"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900">
                    <svg
                      className="h-6 w-6 text-blue-600"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 12h8v2H8v-2zm0 4h8v2H8v-2z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Google Docs</div>
                    <div className="text-muted-foreground text-sm">
                      Documents and comments
                    </div>
                  </div>
                </Button>
                <Button
                  className="h-auto justify-start gap-4 p-4"
                  onClick={handleConnectGoogleSheets}
                  variant="outline"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900">
                    <svg
                      className="h-6 w-6 text-green-600"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 10h3v2H8v-2zm5 0h3v2h-3v-2zm-5 3h3v2H8v-2zm5 0h3v2h-3v-2z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Google Sheets</div>
                    <div className="text-muted-foreground text-sm">
                      Spreadsheets and comments
                    </div>
                  </div>
                </Button>
              </div>
            </div>

            {/* Coming Soon */}
            <div className="space-y-2">
              <h4 className="font-medium text-muted-foreground text-sm">
                Coming Soon
              </h4>
              <div className="grid gap-2 opacity-50">
                <Button
                  className="h-auto justify-start gap-4 p-4"
                  disabled
                  variant="outline"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900">
                    <svg
                      className="h-6 w-6 text-purple-600"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Microsoft Teams</div>
                    <div className="text-muted-foreground text-sm">
                      Coming soon
                    </div>
                  </div>
                </Button>
                <Button
                  className="h-auto justify-start gap-4 p-4"
                  disabled
                  variant="outline"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900">
                    <svg
                      className="h-6 w-6 text-indigo-600"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">Discord</div>
                    <div className="text-muted-foreground text-sm">
                      Coming soon
                    </div>
                  </div>
                </Button>
                <Button
                  className="h-auto justify-start gap-4 p-4"
                  disabled
                  variant="outline"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                    <svg
                      className="h-6 w-6"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">GitHub</div>
                    <div className="text-muted-foreground text-sm">
                      Coming soon
                    </div>
                  </div>
                </Button>
              </div>
            </div>
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
              Are you sure you want to disconnect {selectedSource?.displayName}?
              This will stop syncing data from this source. Existing data will
              be preserved.
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
            {source.isLegacy && (
              <Badge className="text-xs" variant="outline">
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
                  <Badge className="ml-1" variant="secondary">
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
        <h3 className="mt-4 font-semibold text-lg">
          No {config.label} connected
        </h3>
        <p className="mt-2 text-center text-muted-foreground">
          {config.description}
        </p>
        <Button className="mt-4" onClick={onConnect} variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Connect {config.label}
        </Button>
      </CardContent>
    </Card>
  );
}
