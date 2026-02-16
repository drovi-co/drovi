// =============================================================================
// SCHEDULE & CONTINUUMS
// =============================================================================
//
// Unified schedule for commitments and continuum run cadence.
//

import { Badge } from "@memorystack/ui-core/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Separator } from "@memorystack/ui-core/separator";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calendar, Clock, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { CommitmentTimeline } from "@/components/dashboards";
import type { CommitmentCardData } from "@/components/dashboards/commitment-card";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { useCommitmentUIOs } from "@/hooks/use-uio";
import { useI18n, useT } from "@/i18n";
import { agentsAPI, type UIO } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { formatRelativeTime } from "@/lib/intl-time";

export const Route = createFileRoute("/dashboard/schedule")({
  component: SchedulePage,
});

function mapCommitmentStatus(status: string | null | undefined) {
  if (!status) return "pending" as const;
  if (status === "overdue") return "overdue" as const;
  if (status === "completed") return "completed" as const;
  if (status === "cancelled") return "cancelled" as const;
  if (status === "snoozed") return "snoozed" as const;
  return "pending" as const;
}

function mapCommitmentPriority(
  priority: unknown
): "low" | "medium" | "high" | "urgent" {
  if (priority === "low") return "low";
  if (priority === "high") return "high";
  if (priority === "urgent") return "urgent";
  return "medium";
}

function mapCommitment(uio: UIO): CommitmentCardData {
  return {
    id: uio.id,
    title: uio.canonicalTitle ?? uio.title,
    description: uio.canonicalDescription ?? uio.description,
    status: mapCommitmentStatus(uio.commitmentDetails?.status ?? uio.status),
    priority: mapCommitmentPriority(uio.commitmentDetails?.priority),
    direction:
      (uio.commitmentDetails?.direction as "owed_by_me" | "owed_to_me") ??
      "owed_by_me",
    dueDate: uio.dueDate ? new Date(uio.dueDate) : null,
    confidence: uio.confidence,
    isUserVerified: uio.isUserVerified,
    extractedAt: uio.extractedAt ? new Date(uio.extractedAt) : null,
    debtor: uio.debtor
      ? {
          id: uio.debtor.id,
          displayName: uio.debtor.displayName,
          primaryEmail: uio.debtor.primaryEmail,
        }
      : null,
    creditor: uio.creditor
      ? {
          id: uio.creditor.id,
          displayName: uio.creditor.displayName,
          primaryEmail: uio.creditor.primaryEmail,
        }
      : null,
  };
}

function parseScheduleLabel(trigger: {
  trigger_type: "manual" | "event" | "schedule";
  trigger_spec?: Record<string, unknown>;
}) {
  if (trigger.trigger_type !== "schedule") {
    return "on-demand";
  }
  const spec = trigger.trigger_spec ?? {};
  if (typeof spec.cron === "string" && spec.cron.length > 0) {
    return `cron ${spec.cron}`;
  }
  if (typeof spec.interval_minutes === "number" && spec.interval_minutes > 0) {
    return `every ${spec.interval_minutes} min`;
  }
  return "scheduled";
}

function SchedulePage() {
  const navigate = useNavigate();
  const t = useT();
  const { locale } = useI18n();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const commitmentsQuery = useCommitmentUIOs({
    organizationId,
    status: "pending",
    limit: 60,
    enabled: !!organizationId,
  });

  const {
    data: deployments,
    isLoading: deploymentsLoading,
    isError: deploymentsError,
    error: deploymentsErrorObj,
    refetch: refetchDeployments,
  } = useQuery({
    queryKey: ["agent-deployments", organizationId],
    queryFn: () => agentsAPI.listDeployments(organizationId),
    enabled: !!organizationId,
  });

  const {
    data: triggers,
    isLoading: triggersLoading,
    isError: triggersError,
    error: triggersErrorObj,
    refetch: refetchTriggers,
  } = useQuery({
    queryKey: ["agent-triggers", organizationId],
    queryFn: () => agentsAPI.listTriggers(organizationId),
    enabled: !!organizationId,
  });

  const {
    data: roles,
    isLoading: rolesLoading,
    isError: rolesError,
    error: rolesErrorObj,
    refetch: refetchRoles,
  } = useQuery({
    queryKey: ["agent-roles", organizationId],
    queryFn: () => agentsAPI.listRoles(organizationId),
    enabled: !!organizationId,
  });

  const timelineItems = useMemo(() => {
    return (commitmentsQuery.data?.items ?? []).map(mapCommitment);
  }, [commitmentsQuery.data]);

  const deploymentSnapshots = useMemo(() => {
    type TriggerSnapshot = {
      deployment_id: string;
      trigger_type: "manual" | "event" | "schedule";
      trigger_spec?: Record<string, unknown>;
    };

    const roleMap = new Map<string, string>();
    for (const role of roles ?? []) {
      roleMap.set(role.id, role.name);
    }
    const triggerMap = new Map<string, TriggerSnapshot[]>();
    for (const trigger of triggers ?? []) {
      const normalizedTrigger: TriggerSnapshot = {
        deployment_id: trigger.deployment_id,
        trigger_type: trigger.trigger_type,
        trigger_spec:
          (trigger.trigger_spec as Record<string, unknown> | undefined) ??
          undefined,
      };
      const list = triggerMap.get(trigger.deployment_id) ?? [];
      list.push(normalizedTrigger);
      triggerMap.set(trigger.deployment_id, list);
    }

    return (deployments ?? []).map((deployment) => {
      const deploymentTriggers = triggerMap.get(deployment.id) ?? [];
      const scheduleTrigger =
        deploymentTriggers.find(
          (trigger) => trigger.trigger_type === "schedule"
        ) ??
        deploymentTriggers[0] ??
        null;
      return {
        id: deployment.id,
        name: roleMap.get(deployment.role_id) ?? deployment.role_id,
        status: deployment.status,
        cadence: scheduleTrigger
          ? parseScheduleLabel({
              trigger_type: scheduleTrigger.trigger_type,
              trigger_spec: scheduleTrigger.trigger_spec,
            })
          : "on-demand",
        updatedAt:
          typeof deployment.updated_at === "string"
            ? deployment.updated_at
            : String(deployment.updated_at ?? ""),
      };
    });
  }, [deployments, roles, triggers]);

  const deploymentSectionLoading =
    deploymentsLoading || triggersLoading || rolesLoading;
  const deploymentSectionError =
    deploymentsError || triggersError || rolesError;
  const deploymentSectionErrorObject =
    deploymentsErrorObj ?? triggersErrorObj ?? rolesErrorObj;

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
        {t("pages.dashboard.schedule.selectOrg")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
            <Calendar className="h-3 w-3" />
            {t("pages.dashboard.schedule.kicker")}
          </div>
          <h1 className="font-semibold text-2xl">
            {t("pages.dashboard.schedule.title")}
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            {t("pages.dashboard.schedule.description")}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>
              {t("pages.dashboard.schedule.commitments.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.schedule.commitments.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {commitmentsQuery.isLoading ? (
              <Skeleton className="h-64" />
            ) : commitmentsQuery.isError ? (
              <ApiErrorPanel
                error={commitmentsQuery.error}
                onRetry={() => commitmentsQuery.refetch()}
              />
            ) : (
              <CommitmentTimeline
                commitments={timelineItems}
                onCommitmentClick={(commitment) =>
                  navigate({
                    to: "/dashboard/commitments",
                    search: { selected: commitment.id },
                  })
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              {t("pages.dashboard.schedule.continuums.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.schedule.continuums.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {deploymentSectionLoading ? (
              <Skeleton className="h-40" />
            ) : deploymentSectionError ? (
              <ApiErrorPanel
                error={deploymentSectionErrorObject}
                onRetry={() => {
                  refetchDeployments();
                  refetchTriggers();
                  refetchRoles();
                }}
              />
            ) : deploymentSnapshots.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                {t("pages.dashboard.schedule.continuums.empty")}
              </div>
            ) : (
              deploymentSnapshots.map((deployment) => (
                <div
                  className="rounded-lg border bg-muted/20 p-3"
                  key={deployment.id}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{deployment.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {t("pages.dashboard.schedule.continuums.nextRun")}{" "}
                        {deployment.cadence}
                      </p>
                      {deployment.updatedAt ? (
                        <p className="text-muted-foreground text-xs">
                          {formatRelativeTime(
                            new Date(deployment.updatedAt),
                            locale
                          )}
                        </p>
                      ) : null}
                    </div>
                    <Badge variant="outline">{deployment.status}</Badge>
                  </div>
                </div>
              ))
            )}
            <Separator />
            <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground text-xs">
              {t("pages.dashboard.schedule.continuums.note")}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
