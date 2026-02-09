// =============================================================================
// CONTINUUM BUILDER
// =============================================================================
//
// Design & author Continuums using intent + DSL. Ships with templates and
// JSON validation before publishing to runtime.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Braces,
  CheckCircle2,
  FileText,
  LayoutPanelLeft,
  Loader2,
  Rocket,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { continuumsAPI, type ContinuumSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

export const Route = createFileRoute("/dashboard/builder")({
  component: ContinuumBuilderPage,
});

const DEFAULT_TEMPLATE = {
  name: "Executive Commitments Sentinel",
  goal: "Maintain a live register of high-risk commitments and trigger follow-ups before SLA breaches.",
  schedule: {
    type: "interval",
    interval_minutes: 60,
  },
  constraints: [
    {
      type: "evidence",
      expression: "commitments.overdue == 0",
      required: true,
    },
  ],
  steps: [
    {
      id: "scan_commitments",
      name: "Scan commitments and risks",
      action: "memory.scan_commitments",
      inputs: {
        focus: ["commitments", "risks"],
        urgency: "high",
      },
      proof: {
        type: "evidence",
        criteria: "At least two supporting sources",
        min_confidence: 0.7,
      },
    },
    {
      id: "notify_owner",
      name: "Notify owner if escalation risk",
      action: "actuation.notify",
      inputs: {
        channel: "email",
        template: "continuum/escalation",
      },
    },
  ],
  proofs: [
    {
      type: "audit",
      criteria: "Store evidence hashes for each decision",
      min_confidence: 0.8,
    },
  ],
  escalation: {
    on_failure: true,
    max_retries: 2,
    notify_on_failure: true,
    notify_on_escalation: true,
    require_manual_override: true,
    policy_checks: true,
    channels: ["email", "slack"],
  },
  metadata: {
    owner_team: "reliability",
    intent: "",
  },
};

function stringifyTemplate(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

function ContinuumBuilderPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const t = useT();
  const organizationId = activeOrg?.id ?? "";

  const [mode, setMode] = useState<"create" | "update">("create");
  const [selectedContinuumId, setSelectedContinuumId] = useState<string>("");
  const [intentDraft, setIntentDraft] = useState("");
  const [definitionText, setDefinitionText] = useState(
    stringifyTemplate(DEFAULT_TEMPLATE)
  );
  const [activateOnSave, setActivateOnSave] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const {
    data: continuums,
    isError: continuumsError,
    error: continuumsErrorObj,
    refetch: refetchContinuums,
  } = useQuery({
    queryKey: ["continuums", organizationId],
    queryFn: () => continuumsAPI.list(organizationId),
    enabled: !!organizationId,
  });

  const selectedContinuum = useMemo(() => {
    return (continuums ?? []).find((c) => c.id === selectedContinuumId) ?? null;
  }, [continuums, selectedContinuumId]);

  const createMutation = useMutation({
    mutationFn: (definition: Record<string, unknown>) =>
      continuumsAPI.create({
        organizationId,
        definition,
        activate: activateOnSave,
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.builder.toasts.created"));
      queryClient.invalidateQueries({ queryKey: ["continuums"] });
    },
    onError: () => toast.error(t("pages.dashboard.builder.toasts.createFailed")),
  });

  const updateMutation = useMutation({
    mutationFn: (definition: Record<string, unknown>) =>
      continuumsAPI.addVersion({
        continuumId: selectedContinuumId,
        organizationId,
        definition,
        activate: activateOnSave,
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.builder.toasts.versionAdded"));
      queryClient.invalidateQueries({ queryKey: ["continuums"] });
    },
    onError: () => toast.error(t("pages.dashboard.builder.toasts.versionAddFailed")),
  });

  const handleGenerateTemplate = () => {
    const base = {
      ...DEFAULT_TEMPLATE,
      name: intentDraft ? intentDraft.slice(0, 48) : DEFAULT_TEMPLATE.name,
      goal: intentDraft || DEFAULT_TEMPLATE.goal,
      metadata: {
        ...DEFAULT_TEMPLATE.metadata,
        intent: intentDraft,
      },
    };
    setDefinitionText(stringifyTemplate(base));
    setValidationError(null);
  };

  const parseDefinition = (): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(definitionText) as Record<string, unknown>;
      if (!parsed.name || !parsed.goal || !parsed.steps) {
        throw new Error(t("pages.dashboard.builder.validation.missingFields"));
      }
      setValidationError(null);
      return parsed;
    } catch (error) {
      setValidationError(
        error instanceof Error
          ? error.message
          : t("pages.dashboard.builder.validation.invalidJson")
      );
      return null;
    }
  };

  const handleSave = () => {
    const parsed = parseDefinition();
    if (!parsed) return;

    if (mode === "create") {
      createMutation.mutate(parsed);
    } else {
      if (!selectedContinuumId) {
        toast.error(t("pages.dashboard.builder.toasts.selectToUpdate"));
        return;
      }
      updateMutation.mutate(parsed);
    }
  };

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("pages.dashboard.builder.noOrg")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <LayoutPanelLeft className="h-3 w-3" />
              {t("pages.dashboard.builder.kicker")}
            </div>
            <h1 className="font-semibold text-2xl">
              {t("pages.dashboard.builder.title")}
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              {t("pages.dashboard.builder.description")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="border border-primary/30 bg-primary/10 text-primary">
              {t("pages.dashboard.builder.badges.dsl")}
            </Badge>
            <Button onClick={handleSave} size="sm">
              <Rocket className="mr-2 h-4 w-4" />
              {mode === "create"
                ? t("pages.dashboard.builder.actions.publishContinuum")
                : t("pages.dashboard.builder.actions.publishVersion")}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_60%)]" />
          <CardHeader className="relative">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t("pages.dashboard.builder.intent.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.builder.intent.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="relative space-y-4">
            <div className="space-y-2">
              <Label htmlFor="intent">{t("pages.dashboard.builder.intent.fields.intent.label")}</Label>
              <Textarea
                className="min-h-[140px]"
                id="intent"
                onChange={(event) => setIntentDraft(event.target.value)}
                placeholder={t("pages.dashboard.builder.intent.fields.intent.placeholder")}
                value={intentDraft}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleGenerateTemplate}
                size="sm"
                variant="outline"
              >
                <FileText className="mr-2 h-4 w-4" />
                {t("pages.dashboard.builder.intent.actions.draft")}
              </Button>
              <Badge variant="secondary">
                {t("pages.dashboard.builder.intent.badges.autoPopulates")}
              </Badge>
            </div>

            <Separator />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("pages.dashboard.builder.publishMode.label")}</Label>
                <Select
                  onValueChange={(value) =>
                    setMode(value as "create" | "update")
                  }
                  value={mode}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("pages.dashboard.builder.publishMode.placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">{t("pages.dashboard.builder.publishMode.options.create")}</SelectItem>
                    <SelectItem value="update">{t("pages.dashboard.builder.publishMode.options.update")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("pages.dashboard.builder.target.label")}</Label>
                <Select
                  disabled={mode !== "update"}
                  onValueChange={setSelectedContinuumId}
                  value={selectedContinuumId}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        mode === "update"
                          ? t("pages.dashboard.builder.target.selectPlaceholder")
                          : t("pages.dashboard.builder.target.notRequired")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(continuums ?? []).map((continuum) => (
                      <SelectItem key={continuum.id} value={continuum.id}>
                        {continuum.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {continuumsError && (
                  <ApiErrorPanel
                    className="mt-2"
                    error={continuumsErrorObj}
                    onRetry={() => refetchContinuums()}
                    retryLabel={t("pages.dashboard.builder.target.reload")}
                  />
                )}
                {mode === "update" && !selectedContinuum && (
                  <p className="text-muted-foreground text-xs">
                    {t("pages.dashboard.builder.target.hint")}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div>
                <p className="font-medium text-sm">{t("pages.dashboard.builder.activation.title")}</p>
                <p className="text-muted-foreground text-xs">
                  {t("pages.dashboard.builder.activation.description")}
                </p>
              </div>
              <Switch
                checked={activateOnSave}
                onCheckedChange={setActivateOnSave}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Braces className="h-5 w-5 text-primary" />
              {t("pages.dashboard.builder.definition.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.builder.definition.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              className={cn(
                "min-h-[420px] font-mono text-xs",
                validationError && "border-red-500/60"
              )}
              onChange={(event) => setDefinitionText(event.target.value)}
              spellCheck={false}
              value={definitionText}
            />

            {validationError ? (
              <Alert variant="destructive">
                <AlertTitle>{t("pages.dashboard.builder.definition.invalidTitle")}</AlertTitle>
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>{t("pages.dashboard.builder.definition.readyTitle")}</AlertTitle>
                <AlertDescription>
                  {t("pages.dashboard.builder.definition.readyDescription")}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={parseDefinition} size="sm" variant="outline">
                {t("pages.dashboard.builder.actions.validateJson")}
              </Button>
              <Button onClick={handleSave} size="sm">
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="mr-2 h-4 w-4" />
                )}
                {mode === "create"
                  ? t("pages.dashboard.builder.actions.publishContinuum")
                  : t("pages.dashboard.builder.actions.publishVersion")}
              </Button>
              {selectedContinuum && (
                <Badge variant="secondary">
                  {t("pages.dashboard.builder.target.badge", { name: selectedContinuum.name })}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
