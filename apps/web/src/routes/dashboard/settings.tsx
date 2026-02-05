import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2, Download, Shield, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { orgAPI, type OrgInfo } from "@/lib/api";

export const Route = createFileRoute("/dashboard/settings")({
  component: SettingsPage,
});

const REGIONS = [
  { id: "us-west", label: "US West" },
  { id: "us-east", label: "US East" },
  { id: "eu-central", label: "EU Central" },
];

function SettingsPage() {
  const { data: session } = authClient.useSession();
  const user = session?.user;

  const { data: orgInfo, isLoading: orgLoading } = useQuery({
    queryKey: ["org-info"],
    queryFn: () => orgAPI.getOrgInfo(),
  });

  const [orgDraft, setOrgDraft] = useState<OrgInfo | null>(null);

  const activeOrg = orgDraft ?? orgInfo ?? null;
  const allowedDomains = useMemo(
    () => (activeOrg?.allowed_domains ?? []).join(", "),
    [activeOrg]
  );
  const notificationEmails = useMemo(
    () => (activeOrg?.notification_emails ?? []).join(", "),
    [activeOrg]
  );

  const updateOrgMutation = useMutation({
    mutationFn: (payload: {
      name?: string;
      allowedDomains?: string[];
      notificationEmails?: string[];
      region?: string;
    }) => orgAPI.updateOrgInfo(payload),
    onSuccess: (updated) => {
      setOrgDraft(updated);
      toast.success("Organization settings updated");
    },
    onError: () => toast.error("Failed to update organization"),
  });

  const handleOrgSave = () => {
    if (!activeOrg) return;
    updateOrgMutation.mutate({
      name: activeOrg.name,
      region: activeOrg.region ?? undefined,
      allowedDomains: activeOrg.allowed_domains,
      notificationEmails: activeOrg.notification_emails ?? undefined,
    });
  };

  const handleDomainChange = (value: string) => {
    if (!activeOrg) return;
    setOrgDraft({
      ...activeOrg,
      allowed_domains: value
        .split(",")
        .map((domain) => domain.trim())
        .filter(Boolean),
    });
  };

  const handleNotificationEmails = (value: string) => {
    if (!activeOrg) return;
    setOrgDraft({
      ...activeOrg,
      notification_emails: value
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your organization and security posture.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Organization profile
            </CardTitle>
            <CardDescription>
              Control identity, domains, and routing policies for your org.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {orgLoading ? (
              <div className="text-muted-foreground text-sm">
                Loading organization…
              </div>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="org-name">Organization name</Label>
                  <Input
                    id="org-name"
                    value={activeOrg?.name ?? ""}
                    onChange={(event) =>
                      setOrgDraft((prev) =>
                        prev
                          ? { ...prev, name: event.target.value }
                          : activeOrg
                            ? { ...activeOrg, name: event.target.value }
                            : null
                      )
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="org-region">Data region</Label>
                  <Select
                    value={activeOrg?.region ?? "us-west"}
                    onValueChange={(value) =>
                      setOrgDraft((prev) =>
                        prev
                          ? { ...prev, region: value }
                          : activeOrg
                            ? { ...activeOrg, region: value }
                            : null
                      )
                    }
                  >
                    <SelectTrigger id="org-region">
                      <SelectValue placeholder="Select region" />
                    </SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((region) => (
                        <SelectItem key={region.id} value={region.id}>
                          {region.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="allowed-domains">Allowed domains</Label>
                  <Input
                    id="allowed-domains"
                    placeholder="example.com, partner.org"
                    value={allowedDomains}
                    onChange={(event) => handleDomainChange(event.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Leave empty to allow any domain for invites.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notification-emails">Notification emails</Label>
                  <Input
                    id="notification-emails"
                    placeholder="ops@company.com, security@company.com"
                    value={notificationEmails}
                    onChange={(event) =>
                      handleNotificationEmails(event.target.value)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-muted-foreground text-xs">
                    {activeOrg?.member_count ?? 0} members · {activeOrg?.connection_count ?? 0} connections
                  </div>
                  <Button onClick={handleOrgSave} disabled={updateOrgMutation.isPending}>
                    {updateOrgMutation.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Account summary
              </CardTitle>
              <CardDescription>
                Your identity and access level inside Drovi.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-xs uppercase text-muted-foreground">Email</p>
                <p className="mt-1 font-medium text-sm">
                  {user?.email ?? "—"}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-xs uppercase text-muted-foreground">Role</p>
                <p className="mt-1 font-medium text-sm">
                  {user?.role ?? "Member"}
                </p>
              </div>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => authClient.signOut()}
              >
                Sign out
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Security posture
              </CardTitle>
              <CardDescription>
                Credentials and audit readiness for your org.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                Password resets, MFA, and device policies are available in the
                enterprise security console.
              </div>
              <Button variant="outline" disabled className="w-full">
                Manage security (coming soon)
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                Data export
              </CardTitle>
              <CardDescription>
                Export your intelligence graph for compliance or migrations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="secondary"
                onClick={async () => {
                  try {
                    const result = await orgAPI.exportData({ format: "json" });
                    toast.success("Export started", {
                      description: `Job ${result.export_job_id} is processing.`,
                    });
                  } catch (error) {
                    toast.error("Failed to start export");
                  }
                }}
              >
                Start export
              </Button>
              <Separator className="my-4" />
              <p className="text-muted-foreground text-xs">
                Exports are processed asynchronously and expire after 24 hours.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
