import { env } from "@memorystack/env/web";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Hash,
  Loader2,
  MailPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OnboardingLayout } from "@/components/onboarding/onboarding-layout";
import { SyncProgressOverlay } from "@/components/onboarding/sync-progress-overlay";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/onboarding/connect-sources")({
  component: ConnectSourcesPage,
});

// Provider icons
const GmailIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24">
    <path
      d="M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0l-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z"
      fill="currentColor"
    />
  </svg>
);

const OutlookIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24">
    <path
      d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.31.77.1.43.1.88zM24 12v9.38q0 .46-.33.8-.33.32-.8.32H7.13q-.46 0-.8-.33-.32-.33-.32-.8V18H1q-.41 0-.7-.3-.3-.29-.3-.7V7q0-.41.3-.7Q.58 6 1 6h6.5V2.55q0-.44.3-.75.3-.3.75-.3h12.9q.44 0 .75.3.3.3.3.75V12zm-6-8.25v3h3v-3zm0 4.5v3h3v-3zm0 4.5v1.83l3.05-1.83zm-5.25-9v3h3.75v-3zm0 4.5v3h3.75v-3zm0 4.5v2.03l2.41 1.5 1.34-.8v-2.73zM9 3.75V6h2l.13.01.12.04v-2.3zM5.98 15.98q.9 0 1.6-.3.7-.32 1.19-.86.48-.55.73-1.28.25-.74.25-1.61 0-.83-.25-1.55-.24-.71-.71-1.24t-1.15-.83q-.68-.3-1.55-.3-.92 0-1.64.3-.71.3-1.2.85-.5.54-.75 1.3-.25.74-.25 1.63 0 .85.26 1.56.26.72.74 1.23.48.52 1.17.81.69.3 1.56.3zM7.5 21h12.39L12 16.08V17q0 .41-.3.7-.29.3-.7.3H7.5zm15-.13v-7.24l-5.9 3.54Z"
      fill="currentColor"
    />
  </svg>
);

function ConnectSourcesPage() {
  const navigate = useNavigate();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const [isConnecting, setIsConnecting] = useState<
    "gmail" | "outlook" | "slack" | "notion" | null
  >(null);
  const [showSyncProgress, setShowSyncProgress] = useState(false);

  // Check URL params for success/error messages from OAuth callback
  const searchParams = new URLSearchParams(window.location.search);
  const success = searchParams.get("success");
  const error = searchParams.get("error");

  // Handle OAuth callback result
  useEffect(() => {
    if (success === "true") {
      toast.success("Source connected! Setting up intelligence...");
      // Clear params and show sync progress
      window.history.replaceState({}, "", window.location.pathname);
      // Show the sync progress overlay
      setShowSyncProgress(true);
    } else if (error) {
      toast.error(`Failed to connect: ${error}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [success, error]);

  // Handler for when sync progress completes
  const handleSyncComplete = () => {
    setShowSyncProgress(false);
    navigate({ to: "/onboarding/invite-team" });
  };

  // Fetch connected accounts
  const { data: accounts, isLoading: accountsLoading } = useQuery({
    ...trpc.emailAccounts.list.queryOptions({
      organizationId: activeOrg?.id ?? "",
    }),
    enabled: !!activeOrg?.id,
  });

  // Fetch available providers
  const { data: providers } = useQuery({
    ...trpc.emailAccounts.getAvailableProviders.queryOptions(),
    enabled: !!activeOrg?.id,
  });

  // Connect mutation
  const connectMutation = useMutation({
    ...trpc.emailAccounts.connect.mutationOptions(),
    onSuccess: (data) => {
      // Redirect to OAuth - the callback will redirect back here
      window.location.href = data.authorizationUrl;
    },
    onError: (error) => {
      toast.error(`Failed to connect: ${error.message}`);
      setIsConnecting(null);
    },
  });

  const handleConnect = (provider: "gmail" | "outlook") => {
    if (!activeOrg?.id) {
      toast.error("Please create an organization first");
      return;
    }
    setIsConnecting(provider);
    connectMutation.mutate({
      organizationId: activeOrg.id,
      provider,
      redirectTo: "/onboarding/connect-sources",
    });
  };

  const handleConnectSlack = () => {
    if (!(activeOrg?.id && session?.user?.id)) {
      toast.error("Please create an organization first");
      return;
    }
    setIsConnecting("slack");
    const params = new URLSearchParams({
      organizationId: activeOrg.id,
      userId: session.user.id,
      redirect: "/onboarding/connect-sources?success=true&source=slack",
    });
    window.location.href = `${env.VITE_SERVER_URL}/api/oauth/slack/authorize?${params.toString()}`;
  };

  const handleConnectNotion = () => {
    if (!(activeOrg?.id && session?.user?.id)) {
      toast.error("Please create an organization first");
      return;
    }
    setIsConnecting("notion");
    const params = new URLSearchParams({
      organizationId: activeOrg.id,
      userId: session.user.id,
      redirect: "/onboarding/connect-sources?success=true&source=notion",
    });
    window.location.href = `${env.VITE_SERVER_URL}/api/oauth/notion/authorize?${params.toString()}`;
  };

  const handleSkip = () => {
    navigate({ to: "/onboarding/invite-team" });
  };

  const handleContinue = () => {
    navigate({ to: "/onboarding/invite-team" });
  };

  const hasConnectedAccount = accounts && accounts.length > 0;

  if (orgLoading) {
    return (
      <OnboardingLayout step={2}>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </OnboardingLayout>
    );
  }

  // If no organization, redirect to create-org
  if (!activeOrg) {
    navigate({ to: "/onboarding/create-org" });
    return null;
  }

  return (
    <OnboardingLayout step={2}>
      <Card className="border-0 shadow-none lg:border lg:shadow-sm">
        <CardHeader className="pb-2 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            {hasConnectedAccount ? (
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            ) : (
              <MailPlus className="h-7 w-7 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl">
            {hasConnectedAccount ? "Source Connected!" : "Connect Your Sources"}
          </CardTitle>
          <CardDescription className="text-base">
            {hasConnectedAccount
              ? "Your source is connected. You can add more sources from settings."
              : "Connect your email, Slack, or Notion to start extracting insights."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {hasConnectedAccount ? (
            <div className="space-y-4">
              {/* Show connected accounts */}
              <div className="space-y-2">
                {accounts.map((account) => (
                  <div
                    className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
                    key={account.id}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      {account.provider === "gmail" ? (
                        <GmailIcon />
                      ) : (
                        <OutlookIcon />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{account.email}</p>
                      <p className="text-muted-foreground text-xs capitalize">
                        {account.provider}
                      </p>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                ))}
              </div>

              <Button className="h-11 w-full" onClick={handleContinue}>
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Email Providers */}
              <div className="space-y-2">
                <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Email
                </h4>
                <div className="space-y-2">
                  <Button
                    className="h-12 w-full justify-start gap-3"
                    disabled={
                      isConnecting !== null || !providers?.gmail?.available
                    }
                    onClick={() => handleConnect("gmail")}
                    variant="outline"
                  >
                    {isConnecting === "gmail" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-100">
                        <GmailIcon />
                      </div>
                    )}
                    <div className="text-left">
                      <p className="font-medium text-sm">Gmail</p>
                      <p className="text-muted-foreground text-xs">
                        Google Workspace or personal
                      </p>
                    </div>
                  </Button>

                  <Button
                    className="h-12 w-full justify-start gap-3"
                    disabled={
                      isConnecting !== null || !providers?.outlook?.available
                    }
                    onClick={() => handleConnect("outlook")}
                    variant="outline"
                  >
                    {isConnecting === "outlook" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
                        <OutlookIcon />
                      </div>
                    )}
                    <div className="text-left">
                      <p className="font-medium text-sm">Outlook</p>
                      <p className="text-muted-foreground text-xs">
                        Microsoft 365 or Outlook.com
                      </p>
                    </div>
                    {!providers?.outlook?.available && (
                      <span className="ml-auto text-muted-foreground text-xs">
                        Coming soon
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {/* Team Chat */}
              <div className="space-y-2">
                <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Team Chat
                </h4>
                <Button
                  className="h-12 w-full justify-start gap-3"
                  disabled={isConnecting !== null}
                  onClick={handleConnectSlack}
                  variant="outline"
                >
                  {isConnecting === "slack" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg"
                      style={{ backgroundColor: "#4A154B20" }}
                    >
                      <Hash className="h-5 w-5" style={{ color: "#4A154B" }} />
                    </div>
                  )}
                  <div className="text-left">
                    <p className="font-medium text-sm">Slack</p>
                    <p className="text-muted-foreground text-xs">
                      Channels, DMs, and threads
                    </p>
                  </div>
                </Button>
              </div>

              {/* Knowledge Base */}
              <div className="space-y-2">
                <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Knowledge Base
                </h4>
                <Button
                  className="h-12 w-full justify-start gap-3"
                  disabled={isConnecting !== null}
                  onClick={handleConnectNotion}
                  variant="outline"
                >
                  {isConnecting === "notion" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                      <FileText className="h-5 w-5" />
                    </div>
                  )}
                  <div className="text-left">
                    <p className="font-medium text-sm">Notion</p>
                    <p className="text-muted-foreground text-xs">
                      Pages, databases, and comments
                    </p>
                  </div>
                </Button>
              </div>

              {/* Calendar & Messaging - Coming Soon */}
              <div className="space-y-2">
                <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Calendar & Messaging
                </h4>
                <div className="space-y-2">
                  <Button
                    className="h-12 w-full justify-start gap-3"
                    disabled
                    variant="outline"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                      <svg className="h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zm-7 5h5v5h-5v-5z"/>
                      </svg>
                    </div>
                    <div className="text-left flex-1">
                      <p className="font-medium text-sm">Google Calendar</p>
                      <p className="text-muted-foreground text-xs">
                        Meetings and commitments
                      </p>
                    </div>
                    <span className="text-muted-foreground text-xs">Coming soon</span>
                  </Button>

                  <Button
                    className="h-12 w-full justify-start gap-3"
                    disabled
                    variant="outline"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                      <svg className="h-5 w-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                    </div>
                    <div className="text-left flex-1">
                      <p className="font-medium text-sm">WhatsApp</p>
                      <p className="text-muted-foreground text-xs">
                        Business messages
                      </p>
                    </div>
                    <span className="text-muted-foreground text-xs">Coming soon</span>
                  </Button>
                </div>
              </div>

              {/* Info */}
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Drovi will analyze your connected sources to extract
                  commitments, decisions, and insights. We never share your data
                  with third parties. You can manage connections at any time.
                </p>
              </div>

              {/* Skip option */}
              <Button className="w-full" onClick={handleSkip} variant="ghost">
                Skip for now
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Progress Overlay */}
      <AnimatePresence>
        {showSyncProgress && activeOrg?.id && (
          <SyncProgressOverlay
            minDisplayTime={8000}
            onComplete={handleSyncComplete}
            organizationId={activeOrg.id}
          />
        )}
      </AnimatePresence>
    </OnboardingLayout>
  );
}
