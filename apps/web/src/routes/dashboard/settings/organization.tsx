// =============================================================================
// ORGANIZATION SETTINGS PAGE
// =============================================================================
//
// Enterprise settings for organization including:
// - Privacy & Security (default visibility, SSO, SCIM)
// - Feature Configuration
// - Compliance Settings
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  Eye,
  Globe,
  Key,
  Lock,
  Shield,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/settings/organization")({
  component: OrganizationSettingsPage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function OrganizationSettingsPage() {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // Fetch organization settings
  const {
    data: settingsData,
    isLoading,
    refetch,
  } = useQuery({
    ...trpc.organizationSettings.get.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Update mutation
  const updateMutation = useMutation(
    trpc.organizationSettings.update.mutationOptions({
      onSuccess: () => {
        toast.success("Settings updated successfully");
        refetch();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update settings");
      },
    })
  );

  // Privacy settings state
  const [defaultVisibility, setDefaultVisibility] = useState<
    "private" | "team" | "organization"
  >("private");
  const [allowPersonalAccounts, setAllowPersonalAccounts] = useState(true);
  const [allowedEmailDomains, setAllowedEmailDomains] = useState("");

  // Security settings state
  const [ssoRequired, setSsoRequired] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(0);

  // Feature settings state
  const [aiDraftingEnabled, setAiDraftingEnabled] = useState(true);
  const [aiTriageEnabled, setAiTriageEnabled] = useState(true);
  const [aiExtractionEnabled, setAiExtractionEnabled] = useState(true);

  // Compliance settings state
  const [dataRetentionDays, setDataRetentionDays] = useState(365);
  const [allowDataExport, setAllowDataExport] = useState(true);
  const [auditLogRetentionDays, setAuditLogRetentionDays] = useState(365);

  // Initialize from settings data
  const settings = settingsData?.settings;
  useEffect(() => {
    if (settings) {
      // Map the defaultPrivacyPolicy enum to visibility
      const policyToVisibility: Record<string, "private" | "team" | "organization"> = {
        private: "private",
        team_visible: "team",
        org_visible: "organization",
      };
      setDefaultVisibility(
        policyToVisibility[settings.defaultPrivacyPolicy ?? "private"] ?? "private"
      );
      setAllowPersonalAccounts(settings.allowPersonalAccounts ?? true);
      setAllowedEmailDomains(
        (settings.allowedEmailDomains ?? []).join(", ")
      );
      setSsoRequired(settings.ssoRequired ?? false);
      setMfaRequired(settings.mfaRequired ?? false);
      setSessionTimeoutMinutes(settings.sessionTimeoutMinutes ?? 0);
      // AI features are stored in a JSONB column
      const aiFeatures = settings.aiFeatures as { drafting?: boolean; triage?: boolean; extraction?: boolean } | null;
      setAiDraftingEnabled(aiFeatures?.drafting ?? true);
      setAiTriageEnabled(aiFeatures?.triage ?? true);
      setAiExtractionEnabled(aiFeatures?.extraction ?? true);
      setDataRetentionDays(settings.dataRetentionDays ?? 365);
      setAllowDataExport(settings.allowDataExport ?? true);
      setAuditLogRetentionDays(settings.auditLogRetentionDays ?? 365);
    }
  }, [settings]);

  // Handle save
  const handleSavePrivacy = () => {
    // Map visibility to privacy policy enum
    const visibilityToPolicy: Record<string, "private" | "team_visible" | "org_visible"> = {
      private: "private",
      team: "team_visible",
      organization: "org_visible",
    };
    updateMutation.mutate({
      organizationId,
      defaultPrivacyPolicy: visibilityToPolicy[defaultVisibility],
      allowPersonalAccounts,
      allowedEmailDomains: allowedEmailDomains
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
    });
  };

  const handleSaveSecurity = () => {
    updateMutation.mutate({
      organizationId,
      ssoRequired,
      mfaRequired,
      sessionTimeoutMinutes: sessionTimeoutMinutes || undefined,
    });
  };

  const handleSaveFeatures = () => {
    updateMutation.mutate({
      organizationId,
      aiFeatures: {
        drafting: aiDraftingEnabled,
        triage: aiTriageEnabled,
        extraction: aiExtractionEnabled,
      },
    });
  };

  const handleSaveCompliance = () => {
    updateMutation.mutate({
      organizationId,
      dataRetentionDays,
      allowDataExport,
      auditLogRetentionDays,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">
            Organization Settings
          </h1>
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">
          Organization Settings
        </h1>
        <p className="text-muted-foreground">
          Configure organization-wide settings, security, and compliance
        </p>
      </div>

      <Tabs defaultValue="privacy">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="privacy" className="gap-2">
            <Eye className="h-4 w-4" />
            Privacy
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="features" className="gap-2">
            <Building2 className="h-4 w-4" />
            Features
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-2">
            <Lock className="h-4 w-4" />
            Compliance
          </TabsTrigger>
        </TabsList>

        {/* Privacy Tab */}
        <TabsContent value="privacy" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Default Visibility</CardTitle>
              <CardDescription>
                Set the default visibility for new source accounts and data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Default Source Account Visibility</Label>
                <Select
                  value={defaultVisibility}
                  onValueChange={(v) =>
                    setDefaultVisibility(v as typeof defaultVisibility)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4" />
                        Private - Only owner sees data
                      </div>
                    </SelectItem>
                    <SelectItem value="team">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Team - Visible to assigned teams
                      </div>
                    </SelectItem>
                    <SelectItem value="organization">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        Organization - Visible to all members
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Users can override this setting for their individual accounts
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Allow Personal Accounts</Label>
                  <p className="text-muted-foreground text-sm">
                    Let members connect personal email accounts
                  </p>
                </div>
                <Switch
                  checked={allowPersonalAccounts}
                  onCheckedChange={setAllowPersonalAccounts}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Allowed Email Domains</Label>
                <Input
                  value={allowedEmailDomains}
                  onChange={(e) => setAllowedEmailDomains(e.target.value)}
                  placeholder="company.com, subsidiary.com"
                />
                <p className="text-muted-foreground text-xs">
                  Comma-separated list of allowed domains. Leave empty for no
                  restrictions.
                </p>
              </div>

              <Button
                onClick={handleSavePrivacy}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save Privacy Settings"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Authentication</CardTitle>
              <CardDescription>
                Configure authentication requirements for your organization
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Label>Require SSO</Label>
                    <Badge variant="secondary">Enterprise</Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Users must authenticate via SSO to access the organization
                  </p>
                </div>
                <Switch checked={ssoRequired} onCheckedChange={setSsoRequired} />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Require Two-Factor Authentication</Label>
                  <p className="text-muted-foreground text-sm">
                    All members must enable 2FA
                  </p>
                </div>
                <Switch checked={mfaRequired} onCheckedChange={setMfaRequired} />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Session Timeout (minutes)</Label>
                <Input
                  type="number"
                  value={sessionTimeoutMinutes || ""}
                  onChange={(e) =>
                    setSessionTimeoutMinutes(Number(e.target.value))
                  }
                  placeholder="0 (no timeout)"
                />
                <p className="text-muted-foreground text-xs">
                  Automatically log out inactive users. Set to 0 to disable.
                </p>
              </div>

              <Button
                onClick={handleSaveSecurity}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save Security Settings"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Single Sign-On (SSO)</CardTitle>
              <CardDescription>
                Configure SAML 2.0 or OIDC authentication
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings?.ssoEnabled ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Key className="h-4 w-4 text-green-500" />
                    <span className="font-medium">
                      SSO Configured ({settings.ssoProvider ?? "Custom"})
                    </span>
                  </div>
                  <Button variant="outline">Configure SSO</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    SSO is not configured. Enable enterprise SSO to require
                    authentication via your identity provider.
                  </p>
                  <Button variant="outline">Set Up SSO</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SCIM Provisioning</CardTitle>
              <CardDescription>
                Automatically sync users and groups from your identity provider
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings?.scimEnabled ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-green-500" />
                    <span className="font-medium">SCIM Enabled</span>
                  </div>
                  <div className="rounded-lg border bg-muted/50 p-3">
                    <p className="mb-1 text-muted-foreground text-xs">
                      SCIM Endpoint
                    </p>
                    <code className="text-sm">
                      {window.location.origin}/api/scim/v2
                    </code>
                  </div>
                  <Button variant="outline">Manage SCIM</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    SCIM is not enabled. Enable SCIM to automatically provision
                    and deprovision users.
                  </p>
                  <Button variant="outline">Enable SCIM</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Features</CardTitle>
              <CardDescription>
                Control which AI features are available to members
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>AI Drafting</Label>
                  <p className="text-muted-foreground text-sm">
                    Generate email drafts and replies using AI
                  </p>
                </div>
                <Switch
                  checked={aiDraftingEnabled}
                  onCheckedChange={setAiDraftingEnabled}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>AI Triage</Label>
                  <p className="text-muted-foreground text-sm">
                    Automatically categorize and prioritize messages
                  </p>
                </div>
                <Switch
                  checked={aiTriageEnabled}
                  onCheckedChange={setAiTriageEnabled}
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>AI Extraction</Label>
                  <p className="text-muted-foreground text-sm">
                    Extract commitments, decisions, and intelligence
                  </p>
                </div>
                <Switch
                  checked={aiExtractionEnabled}
                  onCheckedChange={setAiExtractionEnabled}
                />
              </div>

              <Button
                onClick={handleSaveFeatures}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save Feature Settings"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Compliance Tab */}
        <TabsContent value="compliance" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Data Retention</CardTitle>
              <CardDescription>
                Configure how long data is retained
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Data Retention Period (days)</Label>
                <Input
                  type="number"
                  value={dataRetentionDays}
                  onChange={(e) => setDataRetentionDays(Number(e.target.value))}
                  min={30}
                />
                <p className="text-muted-foreground text-xs">
                  Messages and extracted data older than this will be
                  automatically deleted. Minimum 30 days.
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Audit Log Retention (days)</Label>
                <Input
                  type="number"
                  value={auditLogRetentionDays}
                  onChange={(e) =>
                    setAuditLogRetentionDays(Number(e.target.value))
                  }
                  min={90}
                />
                <p className="text-muted-foreground text-xs">
                  Audit logs older than this will be archived. Minimum 90 days.
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Allow Data Export</Label>
                  <p className="text-muted-foreground text-sm">
                    Let members export their data (GDPR compliance)
                  </p>
                </div>
                <Switch
                  checked={allowDataExport}
                  onCheckedChange={setAllowDataExport}
                />
              </div>

              <Button
                onClick={handleSaveCompliance}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving..." : "Save Compliance Settings"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Legal Hold</CardTitle>
              <CardDescription>
                Preserve data for legal and compliance requirements
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  No active legal holds. Legal holds prevent data from being
                  deleted during the retention period.
                </p>
                <Button variant="outline">Create Legal Hold</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
