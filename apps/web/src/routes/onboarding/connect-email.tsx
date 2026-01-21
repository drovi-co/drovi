import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
import { env } from "@memorystack/env/web";

export const Route = createFileRoute("/onboarding/connect-email")({
  component: ConnectEmailPage,
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

function ConnectEmailPage() {
  const navigate = useNavigate();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const [isConnecting, setIsConnecting] = useState<
    "gmail" | "outlook" | "slack" | "notion" | null
  >(null);

  // Check URL params for success/error messages from OAuth callback
  const searchParams = new URLSearchParams(window.location.search);
  const success = searchParams.get("success");
  const error = searchParams.get("error");

  // Handle OAuth callback result
  useEffect(() => {
    if (success === "true") {
      toast.success("Email account connected successfully!");
      // Clear params and navigate to next step
      window.history.replaceState({}, "", window.location.pathname);
      // Small delay to let the toast show
      setTimeout(() => {
        navigate({ to: "/onboarding/invite-team" });
      }, 1000);
    } else if (error) {
      toast.error(`Failed to connect: ${error}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [success, error, navigate]);

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
      redirectTo: "/onboarding/connect-email",
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
      redirect: "/onboarding/connect-email?success=true&source=slack",
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
      redirect: "/onboarding/connect-email?success=true&source=notion",
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
    </OnboardingLayout>
  );
}
