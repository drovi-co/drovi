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
  const organizationId = activeOrg?.id ?? "";

  const [mode, setMode] = useState<"create" | "update">("create");
  const [selectedContinuumId, setSelectedContinuumId] = useState<string>("");
  const [intentDraft, setIntentDraft] = useState("");
  const [definitionText, setDefinitionText] = useState(
    stringifyTemplate(DEFAULT_TEMPLATE)
  );
  const [activateOnSave, setActivateOnSave] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data: continuums } = useQuery({
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
      toast.success("Continuum created");
      queryClient.invalidateQueries({ queryKey: ["continuums"] });
    },
    onError: () => toast.error("Failed to create continuum"),
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
      toast.success("Continuum version added");
      queryClient.invalidateQueries({ queryKey: ["continuums"] });
    },
    onError: () => toast.error("Failed to add version"),
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
        throw new Error("Definition must include name, goal, and steps");
      }
      setValidationError(null);
      return parsed;
    } catch (error) {
      setValidationError(
        error instanceof Error
          ? error.message
          : "Invalid JSON definition"
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
        toast.error("Select a continuum to update");
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
        Select an organization to build Continuums
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
              Continuum Builder
            </div>
            <h1 className="font-semibold text-2xl">
              Design missions that never lose context
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Start from intent, refine the DSL, and ship a Continuum to runtime
              in seconds.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="border border-primary/30 bg-primary/10 text-primary">
              JSON DSL
            </Badge>
            <Button onClick={handleSave} size="sm">
              <Rocket className="mr-2 h-4 w-4" />
              {mode === "create" ? "Publish Continuum" : "Publish Version"}
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
              Intent Canvas
            </CardTitle>
            <CardDescription>
              Describe what the Continuum should protect. We’ll draft the DSL
              for you.
            </CardDescription>
          </CardHeader>
          <CardContent className="relative space-y-4">
            <div className="space-y-2">
              <Label htmlFor="intent">Mission intent</Label>
              <Textarea
                className="min-h-[140px]"
                id="intent"
                onChange={(event) => setIntentDraft(event.target.value)}
                placeholder="Example: Keep every executive commitment on track, escalate risks within 24 hours, and maintain an evidence chain for every action."
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
                Draft from intent
              </Button>
              <Badge variant="secondary">
                Auto-populates `metadata.intent`
              </Badge>
            </div>

            <Separator />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Publish mode</Label>
                <Select
                  onValueChange={(value) =>
                    setMode(value as "create" | "update")
                  }
                  value={mode}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create">Create new continuum</SelectItem>
                    <SelectItem value="update">Add new version</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target continuum</Label>
                <Select
                  disabled={mode !== "update"}
                  onValueChange={setSelectedContinuumId}
                  value={selectedContinuumId}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        mode === "update"
                          ? "Select Continuum"
                          : "Not required"
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
                {mode === "update" && !selectedContinuum && (
                  <p className="text-muted-foreground text-xs">
                    Choose a continuum to append a version.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
              <div>
                <p className="font-medium text-sm">Activate immediately</p>
                <p className="text-muted-foreground text-xs">
                  Runs on schedule after publish.
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
              Continuum Definition (JSON)
            </CardTitle>
            <CardDescription>
              Paste or edit the DSL. Validate before publishing.
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
                <AlertTitle>Invalid definition</AlertTitle>
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Ready to publish</AlertTitle>
                <AlertDescription>
                  Definition validated. Publish to runtime when ready.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={parseDefinition} size="sm" variant="outline">
                Validate JSON
              </Button>
              <Button onClick={handleSave} size="sm">
                {createMutation.isPending || updateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="mr-2 h-4 w-4" />
                )}
                {mode === "create" ? "Publish Continuum" : "Publish Version"}
              </Button>
              {selectedContinuum && (
                <Badge variant="secondary">
                  Target: {selectedContinuum.name}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
