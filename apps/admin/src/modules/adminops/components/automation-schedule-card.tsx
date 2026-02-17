import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import { adminAPI } from "@/lib/api";

function formatRunAt(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusVariant(status: string | null):
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info" {
  if (status === "succeeded") return "success";
  if (status === "failed") return "destructive";
  if (status === "running") return "warning";
  if (status === "queued") return "info";
  return "secondary";
}

export function AutomationScheduleCard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-onboarding-automations"],
    queryFn: () => adminAPI.listOnboardingAutomations(),
    refetchInterval: 30_000,
  });

  const triggerMutation = useMutation({
    mutationFn: adminAPI.triggerOnboardingAutomation,
    onSuccess: async (result) => {
      toast.success(`Queued ${result.key}`);
      await queryClient.invalidateQueries({
        queryKey: ["admin-onboarding-automations"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["admin-jobs"],
      });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to queue job");
    },
  });

  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="h-4 w-4" />
          Operational automation cadences
        </CardTitle>
        <CardDescription>
          Weekly continuity briefs and monthly integrity reports.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : query.error ? (
          <div className="text-muted-foreground text-sm">
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </div>
        ) : (
          <div className="space-y-3">
            {(query.data?.automations ?? []).map((automation) => (
              <div
                className="rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                key={automation.key}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-sm">{automation.label}</div>
                    <div className="text-muted-foreground text-xs">
                      cron {automation.cron} • {automation.cadence}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={automation.enabled ? "success" : "secondary"}
                    >
                      {automation.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Badge variant={statusVariant(automation.last_status)}>
                      {automation.last_status ?? "No runs"}
                    </Badge>
                    <Button
                      disabled={triggerMutation.isPending}
                      onClick={() =>
                        triggerMutation.mutate({
                          key:
                            automation.key === "monthly_integrity_report"
                              ? "monthly_integrity_report"
                              : "weekly_operations_brief",
                        })
                      }
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      {triggerMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Run now
                    </Button>
                  </div>
                </div>
                <div className="mt-2 text-muted-foreground text-xs">
                  Last run: {formatRunAt(automation.last_run_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
