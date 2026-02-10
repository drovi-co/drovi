import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/i18n";
import {
  type DriveUploadEntry,
  useDriveUploadsStore,
} from "@/lib/drive-uploads";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function statusIcon(status: DriveUploadEntry["status"]) {
  if (status === "failed") return AlertCircle;
  if (status === "done") return CheckCircle2;
  if (status === "queued") return Clock;
  return Loader2;
}

function statusClass(status: DriveUploadEntry["status"]): string {
  switch (status) {
    case "failed":
      return "text-destructive";
    case "done":
      return "text-emerald-600";
    case "processing":
    case "uploading":
    case "finalizing":
    case "starting":
    case "hashing":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

export function DriveUploadManager({
  organizationId,
}: {
  organizationId: string;
}) {
  const t = useT();
  const uploads = useDriveUploadsStore((s) => s.uploads);
  const retry = useDriveUploadsStore((s) => s.retry);
  const dismiss = useDriveUploadsStore((s) => s.dismiss);

  if (uploads.length === 0) {
    return null;
  }

  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t("drive.uploads.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {uploads.map((u) => {
          const Icon = statusIcon(u.status);
          const spinning =
            u.status !== "failed" &&
            u.status !== "done" &&
            u.status !== "queued";
          const statusText = t(`drive.uploads.status.${u.status}`);

          return (
            <div className="rounded-lg border bg-card px-3 py-3" key={u.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon
                      className={cn(
                        "h-4 w-4",
                        statusClass(u.status),
                        spinning && "animate-spin"
                      )}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-sm">
                        {u.fileName}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                        <span>{formatBytes(u.byteSize)}</span>
                        <span>{statusText}</span>
                        {typeof u.partsDone === "number" &&
                        typeof u.partsTotal === "number" ? (
                          <span>
                            {t("drive.uploads.parts", {
                              done: u.partsDone,
                              total: u.partsTotal,
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2">
                    <Progress value={u.progressPct} />
                    {u.error ? (
                      <div className="mt-2 text-destructive text-xs">
                        {u.error}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {u.status === "failed" ? (
                    <Button
                      onClick={() => retry(u.id, organizationId)}
                      size="sm"
                      variant="outline"
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      {t("drive.uploads.retry")}
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => dismiss(u.id)}
                    size="icon"
                    variant="ghost"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
