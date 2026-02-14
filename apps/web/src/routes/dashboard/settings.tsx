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
import { authAPI, type OrgInfo, orgAPI } from "@/lib/api";
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
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
                {t("settings.security.note")}
              </div>
              <Button className="w-full" disabled variant="outline">
                {t("settings.security.manageSoon")}
              </Button>
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
