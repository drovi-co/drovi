// =============================================================================
// SCHEDULE & CONTINUUMS
// =============================================================================
//
// Unified schedule for commitments and continuum run cadence.
//

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Calendar, Clock, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { CommitmentTimeline } from "@/components/dashboards";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { continuumsAPI, type UIO } from "@/lib/api";
import { useCommitmentUIOs } from "@/hooks/use-uio";
import type { CommitmentCardData } from "@/components/dashboards/commitment-card";

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

function mapCommitment(uio: UIO): CommitmentCardData {
  return {
    id: uio.id,
    title: uio.canonicalTitle ?? uio.title,
    description: uio.canonicalDescription ?? uio.description,
    status: mapCommitmentStatus(uio.commitmentDetails?.status ?? uio.status),
    priority: (uio.commitmentDetails?.priority as any) ?? "medium",
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

function SchedulePage() {
  const navigate = useNavigate();
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
    data: continuums,
    isLoading: continuumsLoading,
    isError: continuumsError,
    error: continuumsErrorObj,
    refetch: refetchContinuums,
  } = useQuery({
    queryKey: ["continuums", organizationId],
    queryFn: () => continuumsAPI.list(organizationId),
    enabled: !!organizationId,
  });

  const timelineItems = useMemo(() => {
    return (commitmentsQuery.data?.items ?? []).map(mapCommitment);
  }, [commitmentsQuery.data]);

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
        Select an organization to view schedules
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            Schedule
          </div>
          <h1 className="font-semibold text-2xl">
            Timeline of commitments and continuum runs
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Align obligations with automated missions so nothing slips past the
            horizon.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Commitment timeline</CardTitle>
            <CardDescription>
              Due dates and urgency across the week ahead.
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
              Continuum cadence
            </CardTitle>
            <CardDescription>Upcoming runs and status signals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {continuumsLoading ? (
              <Skeleton className="h-40" />
            ) : continuumsError ? (
              <ApiErrorPanel error={continuumsErrorObj} onRetry={() => refetchContinuums()} />
            ) : (continuums ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                No Continuums scheduled yet.
              </div>
            ) : (
              (continuums ?? []).map((continuum) => (
                <div
                  className="rounded-lg border bg-muted/20 p-3"
                  key={continuum.id}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{continuum.name}</p>
                      <p className="text-muted-foreground text-xs">
                        Next run: {continuum.nextRunAt ?? "On demand"}
                      </p>
                    </div>
                    <Badge variant="outline">{continuum.status}</Badge>
                  </div>
                </div>
              ))
            )}
            <Separator />
            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              Align scheduled runs with mission-critical work for tighter
              accountability.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
