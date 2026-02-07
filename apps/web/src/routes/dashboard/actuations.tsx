// =============================================================================
// ACTUATION PLANE
// =============================================================================
//
// Execute and audit actions triggered by Continuums.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  CirclePlay,
  Loader2,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
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
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
  actuationsAPI,
  type ActuationRecordSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/actuations")({
  component: ActuationsPage,
});

const STATUS_STYLES: Record<string, string> = {
  queued: "border-blue-500/30 bg-blue-500/10 text-blue-600",
  running: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  failed: "border-red-500/30 bg-red-500/10 text-red-600",
  staged: "border-violet-500/30 bg-violet-500/10 text-violet-600",
  draft: "border-slate-400/30 bg-slate-400/10 text-slate-600",
};

function ActuationsPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const [driver, setDriver] = useState<string>("");
  const [action, setAction] = useState("notify");
  const [tier, setTier] = useState("tier_1");
  const [payloadText, setPayloadText] = useState(
    JSON.stringify(
      {
        channel: "email",
        message: "Escalation triggered",
      },
      null,
      2
    )
  );

  const {
    data: drivers,
    isLoading: driversLoading,
    isError: driversError,
    error: driversErrorObj,
    refetch: refetchDrivers,
  } = useQuery({
    queryKey: ["actuation-drivers"],
    queryFn: () => actuationsAPI.listDrivers(),
  });

  const {
    data: actuationLog,
    isLoading: logLoading,
    isError: logError,
    error: logErrorObj,
    refetch: refetchLog,
  } = useQuery({
    queryKey: ["actuations", organizationId],
    queryFn: () => actuationsAPI.list(organizationId),
    enabled: !!organizationId,
  });

  const runMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      actuationsAPI.run({
        organizationId,
        driver,
        action,
        payload,
        tier,
      }),
    onSuccess: () => {
      toast.success("Actuation queued");
      queryClient.invalidateQueries({ queryKey: ["actuations"] });
    },
    onError: () => toast.error("Failed to run actuation"),
  });

  const approveMutation = useMutation({
    mutationFn: (actionId: string) =>
      actuationsAPI.approve({ organizationId, actionId }),
    onSuccess: () => {
      toast.success("Actuation approved");
      queryClient.invalidateQueries({ queryKey: ["actuations"] });
    },
    onError: () => toast.error("Failed to approve actuation"),
  });

  const rollbackMutation = useMutation({
    mutationFn: (actionId: string) =>
      actuationsAPI.rollback({ organizationId, actionId }),
    onSuccess: () => {
      toast.success("Actuation rolled back");
      queryClient.invalidateQueries({ queryKey: ["actuations"] });
    },
    onError: () => toast.error("Failed to rollback actuation"),
  });

  const handleRun = () => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(payloadText) as Record<string, unknown>;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Invalid payload JSON"
      );
      return;
    }

    if (!driver) {
      toast.error("Select a driver");
      return;
    }

    runMutation.mutate(payload);
  };

  const sortedLog = useMemo(() => {
    return [...(actuationLog ?? [])].slice(0, 20);
  }, [actuationLog]);

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
        Select an organization to manage actuations
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Zap className="h-3 w-3" />
              Actuation Plane
            </div>
            <h1 className="font-semibold text-2xl">
              Execute actions with policy-grade oversight
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Run approvals, inspect every action, and keep the control plane in
              check.
            </p>
          </div>
          <Button onClick={handleRun} size="sm">
            {runMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CirclePlay className="mr-2 h-4 w-4" />
            )}
            Execute action
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              New Actuation
            </CardTitle>
            <CardDescription>
              Configure driver, action, and payload before execution.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Driver</Label>
                <Select onValueChange={setDriver} value={driver}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select driver" />
                  </SelectTrigger>
                  <SelectContent>
                    {(drivers ?? []).map((driverName) => (
                      <SelectItem key={driverName} value={driverName}>
                        {driverName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {driversLoading && (
                  <p className="text-muted-foreground text-xs">Loading...</p>
                )}
                {driversError && (
                  <ApiErrorPanel
                    className="mt-2"
                    error={driversErrorObj}
                    onRetry={() => refetchDrivers()}
                    retryLabel="Reload drivers"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Action</Label>
                <Input
                  onChange={(event) => setAction(event.target.value)}
                  value={action}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tier</Label>
              <Select onValueChange={setTier} value={tier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tier_1">Tier 1</SelectItem>
                  <SelectItem value="tier_2">Tier 2</SelectItem>
                  <SelectItem value="tier_3">Tier 3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Payload (JSON)</Label>
              <Textarea
                className="min-h-[180px] font-mono text-xs"
                onChange={(event) => setPayloadText(event.target.value)}
                value={payloadText}
              />
            </div>

            <Button onClick={handleRun} variant="outline">
              <CirclePlay className="mr-2 h-4 w-4" />
              Execute action
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Action Ledger
            </CardTitle>
            <CardDescription>
              Inspect the last 20 actuation records.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {logLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : logError ? (
              <ApiErrorPanel error={logErrorObj} onRetry={() => refetchLog()} />
            ) : sortedLog.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                No actuation runs yet.
              </div>
            ) : (
              sortedLog.map((record) => (
                <ActuationRow
                  key={record.id}
                  record={record}
                  onApprove={() => approveMutation.mutate(record.id)}
                  onRollback={() => rollbackMutation.mutate(record.id)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActuationRow({
  record,
  onApprove,
  onRollback,
}: {
  record: ActuationRecordSummary;
  onApprove: () => void;
  onRollback: () => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-sm">{record.actionType}</p>
          <p className="text-muted-foreground text-xs">{record.driver}</p>
        </div>
        <Badge
          className={cn(
            "border text-[11px]",
            STATUS_STYLES[record.status] ||
              "border-muted bg-muted text-muted-foreground"
          )}
          variant="outline"
        >
          {record.status}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{record.tier}</Badge>
        {record.createdAt && (
          <span className="text-muted-foreground text-xs">
            {new Date(record.createdAt).toLocaleString()}
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={onApprove} size="sm" variant="outline">
          Approve
        </Button>
        <Button onClick={onRollback} size="sm" variant="ghost">
          Rollback
        </Button>
      </div>
    </div>
  );
}
