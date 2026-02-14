/**
 * Auto-updater component for Drovi desktop app
 * Shows update status and allows users to download and install updates
 */

import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from "@heroicons/react/24/outline";
import { Button } from "@memorystack/ui-core/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@memorystack/ui-core/dialog";
import { Progress } from "@memorystack/ui-core/progress";
import { useEffect, useState } from "react";
import { useUpdater } from "@/hooks/use-tauri";
import { cn } from "@/lib/utils";

/**
 * Auto-updater dialog that appears when an update is available
 */
export function AutoUpdaterDialog() {
  const {
    status,
    updateInfo,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
    isDesktop,
  } = useUpdater();
  const [open, setOpen] = useState(false);

  // Show dialog when update is available
  useEffect(() => {
    if (status === "available") {
      setOpen(true);
    }
  }, [status]);

  // Check for updates on mount (with delay to not block startup)
  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    const timer = setTimeout(() => {
      checkForUpdates();
    }, 5000);

    return () => clearTimeout(timer);
  }, [isDesktop, checkForUpdates]);

  if (!isDesktop) {
    return null;
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent showCloseButton={status !== "downloading"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {status === "downloading" ? (
              <>
                <ArrowPathIcon className="size-5 animate-spin text-primary" />
                Downloading Update
              </>
            ) : status === "ready" ? (
              <>
                <CheckCircleIcon className="size-5 text-green-500" />
                Update Ready
              </>
            ) : status === "error" ? (
              <>
                <ExclamationCircleIcon className="size-5 text-destructive" />
                Update Error
              </>
            ) : (
              <>
                <ArrowDownTrayIcon className="size-5 text-primary" />
                Update Available
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {status === "downloading"
              ? "Please wait while the update is being downloaded..."
              : status === "ready"
                ? "The update has been downloaded. The app will restart to apply changes."
                : status === "error"
                  ? error || "An error occurred while checking for updates."
                  : `Version ${updateInfo?.version} is available.`}
          </DialogDescription>
        </DialogHeader>

        {status === "downloading" && (
          <div className="py-4">
            <Progress className="h-2" value={progress} />
            <p className="mt-2 text-center text-muted-foreground text-xs">
              {progress}% complete
            </p>
          </div>
        )}

        {updateInfo?.body && status === "available" && (
          <div className="py-2">
            <h4 className="mb-2 font-medium text-muted-foreground text-xs">
              What&apos;s new:
            </h4>
            <div className="max-h-[200px] overflow-y-auto whitespace-pre-wrap text-foreground/80 text-sm">
              {updateInfo.body}
            </div>
          </div>
        )}

        <DialogFooter>
          {status === "available" && (
            <>
              <Button onClick={() => setOpen(false)} variant="ghost">
                Later
              </Button>
              <Button onClick={downloadAndInstall}>Download & Install</Button>
            </>
          )}
          {status === "error" && (
            <>
              <Button onClick={() => setOpen(false)} variant="ghost">
                Dismiss
              </Button>
              <Button onClick={checkForUpdates}>Try Again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Small update indicator that can be shown in the UI
 * Useful for showing in settings or status bar
 */
export function UpdateIndicator({ className }: { className?: string }) {
  const { status, updateInfo, checkForUpdates, downloadAndInstall, isDesktop } =
    useUpdater();

  if (!isDesktop) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {status === "idle" && (
        <Button onClick={checkForUpdates} size="sm" variant="ghost">
          <ArrowPathIcon className="size-4" />
          Check for Updates
        </Button>
      )}

      {status === "checking" && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <ArrowPathIcon className="size-4 animate-spin" />
          Checking for updates...
        </div>
      )}

      {status === "available" && (
        <Button onClick={downloadAndInstall} size="sm" variant="default">
          <ArrowDownTrayIcon className="size-4" />
          Update to {updateInfo?.version}
        </Button>
      )}

      {status === "downloading" && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <ArrowPathIcon className="size-4 animate-spin" />
          Downloading...
        </div>
      )}

      {status === "ready" && (
        <div className="flex items-center gap-2 text-green-500 text-sm">
          <CheckCircleIcon className="size-4" />
          Update ready, restarting...
        </div>
      )}

      {status === "error" && (
        <Button
          className="text-destructive"
          onClick={checkForUpdates}
          size="sm"
          variant="ghost"
        >
          <ExclamationCircleIcon className="size-4" />
          Retry Update Check
        </Button>
      )}
    </div>
  );
}

/**
 * Version display with update status
 */
export function VersionDisplay({ className }: { className?: string }) {
  const { status, updateInfo, isDesktop } = useUpdater();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    (async () => {
      const { getVersion } = await import("@tauri-apps/api/app");
      const version = await getVersion();
      setCurrentVersion(version);
    })();
  }, [isDesktop]);

  if (!(isDesktop && currentVersion)) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-muted-foreground text-xs",
        className
      )}
    >
      <span>v{currentVersion}</span>
      {status === "available" && updateInfo && (
        <span className="text-primary">(v{updateInfo.version} available)</span>
      )}
    </div>
  );
}
