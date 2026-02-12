import { Button } from "@memorystack/ui-core/button";
import { AlertTriangle, Copy, RefreshCw, ServerCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getApiBase, healthAPI } from "@/lib/api";
import { useApiReachability } from "@/lib/api-reachability";
import { cn } from "@/lib/utils";

export function ApiStatusBanner() {
  const { reachable, lastError, lastCheckedAt } = useApiReachability();
  const [isChecking, setIsChecking] = useState(false);

  if (reachable) {
    return null;
  }

  const handleRetry = async () => {
    setIsChecking(true);
    try {
      await healthAPI.ping();
      toast.success("Drovi API reachable again");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Still unable to reach API"
      );
    } finally {
      setIsChecking(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    const diagnostics = [
      `API_BASE=${getApiBase()}`,
      `lastError=${lastError ?? "unknown"}`,
      `lastCheckedAt=${lastCheckedAt ? new Date(lastCheckedAt).toISOString() : "unknown"}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(diagnostics);
      toast.success("Diagnostics copied");
    } catch {
      toast.error("Failed to copy diagnostics");
    }
  };

  return (
    <div className="sticky top-0 z-40 border-amber-500/20 border-b bg-gradient-to-r from-amber-500/10 via-background to-rose-500/10 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-foreground text-sm">
              Drovi API unreachable
              <span className="rounded-full border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-600 uppercase tracking-[0.2em]">
                offline
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              We can’t reach{" "}
              <span className="font-mono text-foreground">{getApiBase()}</span>.
              Check that the docker stack is running and the API is healthy.
            </p>
            {lastError && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <ServerCog className="h-3 w-3" />
                <span className="font-mono">{lastError}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className={cn("h-8 text-xs", isChecking && "pointer-events-none")}
            onClick={handleRetry}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn("mr-2 h-3.5 w-3.5", isChecking && "animate-spin")}
            />
            Retry connection
          </Button>
          <Button
            className="h-8 text-xs"
            onClick={handleCopyDiagnostics}
            size="sm"
            variant="ghost"
          >
            <Copy className="mr-2 h-3.5 w-3.5" />
            Copy diagnostics
          </Button>
        </div>
      </div>
    </div>
  );
}
