import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Checkbox } from "@memorystack/ui-core/checkbox";
import { Input } from "@memorystack/ui-core/input";
import { Label } from "@memorystack/ui-core/label";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import { Textarea } from "@memorystack/ui-core/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { adminAPI, type OnboardingRunbookItem } from "@/lib/api";

function normalizeDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function fallbackRunbook(orgId: string, orgName: string): OnboardingRunbookItem {
  return {
    organization_id: orgId,
    organization_name: orgName || orgId,
    checklist: {
      security_review_complete: false,
      data_custody_mapped: false,
      pilot_mandate_set: false,
      go_live_ready: false,
    },
    owner_email: null,
    target_go_live_at: null,
    notes: null,
    updated_by: null,
    updated_at: null,
    open_ticket_count: 0,
  };
}

export function OnboardingRunbookCard(props: {
  orgId: string;
  orgName: string;
}) {
  const { orgId, orgName } = props;
  const queryClient = useQueryClient();

  const runbookQuery = useQuery({
    queryKey: ["admin-onboarding-runbook", orgId],
    queryFn: async () => {
      const response = await adminAPI.listOnboardingRunbooks({
        organization_id: orgId,
        limit: 1,
      });
      return response.runbooks[0] ?? fallbackRunbook(orgId, orgName);
    },
  });

  const runbook = runbookQuery.data ?? fallbackRunbook(orgId, orgName);
  const [ownerEmail, setOwnerEmail] = useState(runbook.owner_email ?? "");
  const [targetDate, setTargetDate] = useState(
    normalizeDateInput(runbook.target_go_live_at)
  );
  const [notes, setNotes] = useState(runbook.notes ?? "");

  useEffect(() => {
    setOwnerEmail(runbook.owner_email ?? "");
    setTargetDate(normalizeDateInput(runbook.target_go_live_at));
    setNotes(runbook.notes ?? "");
  }, [runbook.notes, runbook.owner_email, runbook.target_go_live_at]);

  const readinessRatio = useMemo(() => {
    const completed = [
      runbook.checklist.security_review_complete,
      runbook.checklist.data_custody_mapped,
      runbook.checklist.pilot_mandate_set,
      runbook.checklist.go_live_ready,
    ].filter(Boolean).length;
    return `${completed}/4`;
  }, [runbook.checklist]);

  const updateMutation = useMutation({
    mutationFn: async (params: {
      organizationId: string;
      body: {
        security_review_complete?: boolean;
        data_custody_mapped?: boolean;
        pilot_mandate_set?: boolean;
        go_live_ready?: boolean;
        owner_email?: string | null;
        target_go_live_at?: string | null;
        notes?: string | null;
      };
    }) => {
      return adminAPI.updateOnboardingRunbook(params.organizationId, params.body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin-onboarding-runbook", orgId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin-onboarding-runbooks"],
      });
      toast.success("Onboarding runbook updated");
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Update failed");
    },
  });

  const setStep = async (
    key:
      | "security_review_complete"
      | "data_custody_mapped"
      | "pilot_mandate_set"
      | "go_live_ready",
    checked: boolean
  ) => {
    await updateMutation.mutateAsync({
      organizationId: orgId,
      body: { [key]: checked },
    });
  };

  const saveMeta = async () => {
    await updateMutation.mutateAsync({
      organizationId: orgId,
      body: {
        owner_email: ownerEmail.trim() || null,
        target_go_live_at: targetDate
          ? new Date(`${targetDate}T00:00:00.000Z`).toISOString()
          : null,
        notes: notes.trim() || null,
      },
    });
  };

  if (runbookQuery.isPending) {
    return (
      <Card className="border-border/70">
        <CardHeader>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-80" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">Pilot onboarding runbook</CardTitle>
          <Badge variant={runbook.checklist.go_live_ready ? "success" : "warning"}>
            {runbook.checklist.go_live_ready ? "Ready" : "In progress"} •{" "}
            {readinessRatio}
          </Badge>
        </div>
        <CardDescription>
          Security review, custody mapping, mandate setup, and go-live gate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3">
          <Label className="text-xs uppercase tracking-wide">Checklist</Label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={runbook.checklist.security_review_complete}
                onCheckedChange={(value) =>
                  void setStep("security_review_complete", Boolean(value))
                }
              />
              Security review checklist completed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={runbook.checklist.data_custody_mapped}
                onCheckedChange={(value) =>
                  void setStep("data_custody_mapped", Boolean(value))
                }
              />
              Data custody mapping completed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={runbook.checklist.pilot_mandate_set}
                onCheckedChange={(value) =>
                  void setStep("pilot_mandate_set", Boolean(value))
                }
              />
              Pilot mandate formally set
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={runbook.checklist.go_live_ready}
                onCheckedChange={(value) =>
                  void setStep("go_live_ready", Boolean(value))
                }
              />
              Go-live readiness gate passed
            </label>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="runbook-owner">Owner email</Label>
            <Input
              id="runbook-owner"
              onChange={(event) => setOwnerEmail(event.target.value)}
              placeholder="pilot.owner@drovi.co"
              value={ownerEmail}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="runbook-go-live">Target go-live date</Label>
            <Input
              id="runbook-go-live"
              onChange={(event) => setTargetDate(event.target.value)}
              type="date"
              value={targetDate}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="runbook-notes">Operations notes</Label>
          <Textarea
            id="runbook-notes"
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Scope, dependencies, and readiness blockers."
            rows={4}
            value={notes}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            {runbook.open_ticket_count > 0 ? (
              <AlertTriangle className="h-4 w-4 text-warning" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
            <span>
              {runbook.open_ticket_count} open support tickets linked to this
              organization.
            </span>
          </div>
          <a
            className="text-foreground underline-offset-4 hover:underline"
            href={`/dashboard/tickets?q=${encodeURIComponent(orgId)}`}
          >
            Open operations queue
          </a>
        </div>

        <div className="flex justify-end">
          <Button
            disabled={updateMutation.isPending}
            onClick={() => void saveMeta()}
            size="sm"
            type="button"
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save runbook"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
