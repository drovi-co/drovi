import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Input } from "@memorystack/ui-core/input";
import { Label } from "@memorystack/ui-core/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@memorystack/ui-core/select";
import { Separator } from "@memorystack/ui-core/separator";
import { Switch } from "@memorystack/ui-core/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  Download,
  Languages,
  LifeBuoy,
  Shield,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { useI18n, useT } from "@/i18n";
import {
  authAPI,
  type OrgInfo,
  type OrgSecurityPolicy,
  orgAPI,
  orgSecurityAPI,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useSupportModalStore } from "@/lib/support-modal";

export const Route = createFileRoute("/dashboard/settings")({
  component: SettingsPage,
});

const REGIONS = [
  { id: "us-west", labelKey: "settings.regions.usWest" },
  { id: "us-east", labelKey: "settings.regions.usEast" },
  { id: "eu-central", labelKey: "settings.regions.euCentral" },
];

const SSO_FALLBACK_ENV_OPTIONS = ["development", "test", "production"] as const;

function SettingsPage() {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const openSupport = useSupportModalStore((s) => s.openWith);
  const { locale, setLocale } = useI18n();
  const t = useT();
  const isOrgAdmin =
    user?.role === "pilot_owner" || user?.role === "pilot_admin";

  const {
    data: orgInfo,
    isLoading: orgLoading,
    isError: orgError,
    error: orgErrorObj,
    refetch: refetchOrg,
  } = useQuery({
    queryKey: ["org-info"],
    queryFn: () => orgAPI.getOrgInfo(),
  });

  const {
    data: securityPolicy,
    isLoading: securityLoading,
    isError: securityError,
    error: securityErrorObj,
    refetch: refetchSecurity,
  } = useQuery({
    queryKey: ["org-security-policy"],
    queryFn: () => orgSecurityAPI.getPolicy(),
    enabled: Boolean(user),
  });

  const [orgDraft, setOrgDraft] = useState<OrgInfo | null>(null);
  const [securityDraft, setSecurityDraft] = useState<OrgSecurityPolicy | null>(
    null
  );

  const activeOrg = orgDraft ?? orgInfo ?? null;
  const activeSecurity = securityDraft ?? securityPolicy ?? null;
  const allowedDomains = useMemo(
    () => (activeOrg?.allowed_domains ?? []).join(", "),
    [activeOrg]
  );
  const notificationEmails = useMemo(
    () => (activeOrg?.notification_emails ?? []).join(", "),
    [activeOrg]
  );
  const securityFallbackEnvironments = useMemo(
    () => (activeSecurity?.password_fallback_environments ?? []).join(", "),
    [activeSecurity]
  );
  const securityIpAllowlist = useMemo(
    () => (activeSecurity?.ip_allowlist ?? []).join(", "),
    [activeSecurity]
  );
  const securityBreakGlassActions = useMemo(
    () => (activeSecurity?.break_glass_required_actions ?? []).join(", "),
    [activeSecurity]
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
      toast.success(t("settings.orgProfile.toastSaved"));
    },
    onError: () => toast.error(t("settings.orgProfile.toastSaveFailed")),
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

  const updateLocaleMutation = useMutation({
    mutationFn: (next: "en" | "fr") => authAPI.updateMyLocale(next),
    onError: () => toast.error(t("settings.languageSaveError")),
  });

  const updateOrgLocaleMutation = useMutation({
    mutationFn: (next: "en" | "fr") =>
      orgAPI.updateOrgInfo({ defaultLocale: next }),
    onSuccess: (updated) => {
      setOrgDraft(updated);
      toast.success(t("settings.orgLanguageSaved"));
    },
    onError: () => toast.error(t("settings.orgLanguageSaveError")),
  });

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

  const updateSecurityMutation = useMutation({
    mutationFn: (payload: {
      sso_enforced?: boolean;
      password_fallback_enabled?: boolean;
      password_fallback_environments?: string[];
      ip_allowlist?: string[];
      evidence_masking_enabled?: boolean;
      break_glass_enabled?: boolean;
      break_glass_required_actions?: string[];
    }) => orgSecurityAPI.updatePolicy(payload),
    onSuccess: (updated) => {
      setSecurityDraft(updated);
      toast.success("Security policy saved.");
    },
    onError: () => {
      toast.error("Failed to save security policy.");
    },
  });

  const updateSecurityDraft = (updater: (base: OrgSecurityPolicy) => OrgSecurityPolicy) => {
    setSecurityDraft((prev) => {
      const base = prev ?? securityPolicy;
      if (!base) return prev;
      return updater(base);
    });
  };

  const parseCsvValues = (value: string, lowerCase = false): string[] =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (lowerCase ? item.toLowerCase() : item));

  const handleSecuritySave = () => {
    if (!activeSecurity) return;
    updateSecurityMutation.mutate({
      sso_enforced: activeSecurity.sso_enforced,
      password_fallback_enabled: activeSecurity.password_fallback_enabled,
      password_fallback_environments:
        activeSecurity.password_fallback_environments,
      ip_allowlist: activeSecurity.ip_allowlist,
      evidence_masking_enabled: activeSecurity.evidence_masking_enabled,
      break_glass_enabled: activeSecurity.break_glass_enabled,
      break_glass_required_actions: activeSecurity.break_glass_required_actions,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-3xl tracking-tight">
          {t("settings.pageTitle")}
        </h1>
        <p className="text-muted-foreground">{t("settings.pageDescription")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              {t("settings.orgProfile.title")}
            </CardTitle>
            <CardDescription>
              {t("settings.orgProfile.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {orgLoading ? (
              <div className="text-muted-foreground text-sm">
                {t("settings.orgProfile.loading")}
              </div>
            ) : orgError ? (
              <ApiErrorPanel error={orgErrorObj} onRetry={() => refetchOrg()} />
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="org-name">
                    {t("settings.orgProfile.fields.name")}
                  </Label>
                  <Input
                    disabled={!activeOrg}
                    id="org-name"
                    onChange={(event) =>
                      setOrgDraft((prev) =>
                        prev
                          ? { ...prev, name: event.target.value }
                          : activeOrg
                            ? { ...activeOrg, name: event.target.value }
                            : null
                      )
                    }
                    value={activeOrg?.name ?? ""}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="org-region">
                    {t("settings.orgProfile.fields.region")}
                  </Label>
                  <Select
                    onValueChange={(value) =>
                      setOrgDraft((prev) =>
                        prev
                          ? { ...prev, region: value }
                          : activeOrg
                            ? { ...activeOrg, region: value }
                            : null
                      )
                    }
                    value={activeOrg?.region ?? "us-west"}
                  >
                    <SelectTrigger id="org-region">
                      <SelectValue
                        placeholder={t("settings.orgProfile.regionPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((region) => (
                        <SelectItem key={region.id} value={region.id}>
                          {t(region.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="allowed-domains">
                    {t("settings.orgProfile.fields.allowedDomains")}
                  </Label>
                  <Input
                    id="allowed-domains"
                    onChange={(event) => handleDomainChange(event.target.value)}
                    placeholder={t(
                      "settings.orgProfile.allowedDomainsPlaceholder"
                    )}
                    value={allowedDomains}
                  />
                  <p className="text-muted-foreground text-xs">
                    {t("settings.orgProfile.allowedDomainsHint")}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notification-emails">
                    {t("settings.orgProfile.fields.notificationEmails")}
                  </Label>
                  <Input
                    id="notification-emails"
                    onChange={(event) =>
                      handleNotificationEmails(event.target.value)
                    }
                    placeholder={t(
                      "settings.orgProfile.notificationEmailsPlaceholder"
                    )}
                    value={notificationEmails}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-muted-foreground text-xs">
                    {t("settings.orgProfile.stats", {
                      members: activeOrg?.member_count ?? 0,
                      connections: activeOrg?.connection_count ?? 0,
                    })}
                  </div>
                  <Button
                    disabled={updateOrgMutation.isPending}
                    onClick={handleOrgSave}
                  >
                    {updateOrgMutation.isPending
                      ? t("settings.orgProfile.saving")
                      : t("settings.orgProfile.save")}
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
                <Languages className="h-5 w-5 text-primary" />
                {t("settings.language")}
              </CardTitle>
              <CardDescription>
                {t("settings.languageDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label>{t("settings.yourLanguage")}</Label>
                  <Select
                    onValueChange={(value) => {
                      const next = value === "fr" ? "fr" : "en";
                      setLocale(next);
                      updateLocaleMutation.mutate(next);
                    }}
                    value={locale}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">
                        {t("settings.english")}
                      </SelectItem>
                      <SelectItem value="fr">{t("settings.french")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {isOrgAdmin ? (
                  <div className="grid gap-2">
                    <Label>{t("settings.orgDefaultLanguage")}</Label>
                    <Select
                      disabled={!activeOrg}
                      onValueChange={(value) => {
                        const next = value === "fr" ? "fr" : "en";
                        updateOrgLocaleMutation.mutate(next);
                      }}
                      value={activeOrg?.default_locale ?? "en"}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">
                          {t("settings.english")}
                        </SelectItem>
                        <SelectItem value="fr">
                          {t("settings.french")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-muted-foreground text-xs">
                      {t("settings.orgDefaultLanguageHint")}
                    </p>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                {t("settings.account.title")}
              </CardTitle>
              <CardDescription>
                {t("settings.account.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-muted-foreground text-xs uppercase">
                  {t("settings.account.emailLabel")}
                </p>
                <p className="mt-1 font-medium text-sm">{user?.email ?? "—"}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 p-4">
                <p className="text-muted-foreground text-xs uppercase">
                  {t("settings.account.roleLabel")}
                </p>
                <p className="mt-1 font-medium text-sm">
                  {user?.role ?? t("settings.account.roleFallback")}
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => authClient.signOut()}
                variant="outline"
              >
                {t("common.actions.signOut")}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                {t("settings.security.title")}
              </CardTitle>
              <CardDescription>
                {t("settings.security.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {securityLoading ? (
                <div className="text-muted-foreground text-sm">
                  Loading security policy...
                </div>
              ) : securityError ? (
                <ApiErrorPanel
                  error={securityErrorObj}
                  onRetry={() => refetchSecurity()}
                />
              ) : activeSecurity ? (
                <>
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-1">
                        <p className="font-medium text-sm">SSO management</p>
                        <p className="text-muted-foreground text-xs">
                          Control organization sign-in mode and safe fallbacks.
                        </p>
                      </div>
                      <Badge
                        variant={
                          activeSecurity.sso_enforced ? "default" : "secondary"
                        }
                      >
                        {activeSecurity.sso_enforced
                          ? "SSO enforced"
                          : "Mixed authentication"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        disabled={!isOrgAdmin}
                        onClick={() =>
                          updateSecurityDraft((base) => ({
                            ...base,
                            sso_enforced: true,
                            password_fallback_enabled: false,
                            password_fallback_environments: [],
                          }))
                        }
                        size="sm"
                        variant="outline"
                      >
                        Enforce SSO only
                      </Button>
                      <Button
                        disabled={!isOrgAdmin}
                        onClick={() =>
                          updateSecurityDraft((base) => ({
                            ...base,
                            sso_enforced: true,
                            password_fallback_enabled: true,
                            password_fallback_environments: ["development"],
                          }))
                        }
                        size="sm"
                        variant="outline"
                      >
                        SSO + dev fallback
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                    <div>
                      <p className="font-medium text-sm">Enforce SSO</p>
                      <p className="text-muted-foreground text-xs">
                        Require SSO sign-in for organization members.
                      </p>
                    </div>
                    <Switch
                      checked={activeSecurity.sso_enforced}
                      disabled={!isOrgAdmin}
                      onCheckedChange={(checked) =>
                        updateSecurityDraft((base) => ({
                          ...base,
                          sso_enforced: checked === true,
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                    <div>
                      <p className="font-medium text-sm">
                        Allow password fallback
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Allow password sessions in selected environments.
                      </p>
                    </div>
                    <Switch
                      checked={activeSecurity.password_fallback_enabled}
                      disabled={!isOrgAdmin}
                      onCheckedChange={(checked) =>
                        updateSecurityDraft((base) => ({
                          ...base,
                          password_fallback_enabled: checked === true,
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Password fallback environments</Label>
                    <div className="flex flex-wrap gap-2">
                      {SSO_FALLBACK_ENV_OPTIONS.map((env) => {
                        const enabled =
                          activeSecurity.password_fallback_environments.includes(
                            env
                          );
                        return (
                          <Button
                            disabled={
                              !isOrgAdmin ||
                              !activeSecurity.password_fallback_enabled
                            }
                            key={env}
                            onClick={() =>
                              updateSecurityDraft((base) => ({
                                ...base,
                                password_fallback_environments: enabled
                                  ? base.password_fallback_environments.filter(
                                      (item) => item !== env
                                    )
                                  : Array.from(
                                      new Set([
                                        ...base.password_fallback_environments,
                                        env,
                                      ])
                                    ),
                              }))
                            }
                            size="sm"
                            variant={enabled ? "default" : "outline"}
                          >
                            {env}
                          </Button>
                        );
                      })}
                    </div>
                    <Input
                      disabled={
                        !isOrgAdmin || !activeSecurity.password_fallback_enabled
                      }
                      onChange={(event) =>
                        updateSecurityDraft((base) => ({
                          ...base,
                          password_fallback_environments: parseCsvValues(
                            event.target.value,
                            true
                          ),
                        }))
                      }
                      placeholder="development,test"
                      value={securityFallbackEnvironments}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>IP allowlist (comma-separated)</Label>
                    <Input
                      disabled={!isOrgAdmin}
                      onChange={(event) =>
                        updateSecurityDraft((base) => ({
                          ...base,
                          ip_allowlist: parseCsvValues(event.target.value),
                        }))
                      }
                      placeholder="203.0.113.10,198.51.100.0/24"
                      value={securityIpAllowlist}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                    <div>
                      <p className="font-medium text-sm">
                        Evidence masking enabled
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Mask sensitive evidence content by default.
                      </p>
                    </div>
                    <Switch
                      checked={activeSecurity.evidence_masking_enabled}
                      disabled={!isOrgAdmin}
                      onCheckedChange={(checked) =>
                        updateSecurityDraft((base) => ({
                          ...base,
                          evidence_masking_enabled: checked === true,
                        }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                    <div>
                      <p className="font-medium text-sm">Break-glass enabled</p>
                      <p className="text-muted-foreground text-xs">
                        Allow temporary audited access grants.
                      </p>
                    </div>
                    <Switch
                      checked={activeSecurity.break_glass_enabled}
                      disabled={!isOrgAdmin}
                      onCheckedChange={(checked) =>
                        updateSecurityDraft((base) => ({
                          ...base,
                          break_glass_enabled: checked === true,
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Break-glass required actions</Label>
                    <Input
                      disabled={!isOrgAdmin}
                      onChange={(event) =>
                        updateSecurityDraft((base) => ({
                          ...base,
                          break_glass_required_actions: parseCsvValues(
                            event.target.value,
                            true
                          ),
                        }))
                      }
                      placeholder="evidence.full,connections.manage"
                      value={securityBreakGlassActions}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs">
                      {isOrgAdmin
                        ? "Security settings apply organization-wide."
                        : "You can view this policy, but only admins can edit it."}
                    </p>
                    <Button
                      disabled={!isOrgAdmin || updateSecurityMutation.isPending}
                      onClick={handleSecuritySave}
                      variant="outline"
                    >
                      {updateSecurityMutation.isPending
                        ? "Saving..."
                        : "Save policy"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
                  {t("settings.security.note")}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5 text-primary" />
                {t("settings.export.title")}
              </CardTitle>
              <CardDescription>
                {t("settings.export.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                onClick={async () => {
                  try {
                    const result = await orgAPI.exportData({ format: "json" });
                    toast.success(t("settings.export.toastStarted"), {
                      description: t(
                        "settings.export.toastStartedDescription",
                        { jobId: result.export_job_id }
                      ),
                    });
                  } catch (error) {
                    toast.error(t("settings.export.toastFailed"));
                  }
                }}
                variant="secondary"
              >
                {t("settings.export.start")}
              </Button>
              <Separator className="my-4" />
              <p className="text-muted-foreground text-xs">
                {t("settings.export.hint")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LifeBuoy className="h-5 w-5 text-primary" />
                {t("settings.support.title")}
              </CardTitle>
              <CardDescription>
                {t("settings.support.description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
                {t("settings.support.diagnosticsNote")}
              </div>
              <Button
                className="w-full"
                onClick={() =>
                  openSupport({
                    subject: "",
                    message: "",
                    route:
                      typeof window !== "undefined"
                        ? window.location.pathname
                        : undefined,
                  })
                }
              >
                {t("settings.support.contact")}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
