import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Copy,
  LifeBuoy,
  LogIn,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APIError, getApiBase } from "@/lib/api";
import { useSupportModalStore } from "@/lib/support-modal";
import { cn } from "@/lib/utils";

function getDefaultTitle(error: unknown): string {
  if (!(error instanceof APIError)) {
    return "Something went wrong";
  }
  switch (error.code) {
    case "API_UNREACHABLE":
      return "Drovi API unreachable";
    case "UNAUTHENTICATED":
      return "Session expired";
    case "FORBIDDEN":
      return "Access denied";
    case "VALIDATION_ERROR":
      return "Invalid request";
    case "RATE_LIMITED":
      return "Rate limited";
    case "SERVER_ERROR":
      return "Server error";
    case "UNKNOWN_ERROR":
    default:
      return "Request failed";
  }
}

function getDefaultDescription(error: unknown): string {
  if (error instanceof APIError) {
    if (error.code === "UNAUTHENTICATED") {
      return "Your session is no longer valid. Sign in again to keep going.";
    }
    if (error.code === "API_UNREACHABLE") {
      return "We can’t reach the intelligence stack from this page.";
    }
    return error.detail || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export function ApiErrorPanel({
  error,
  title,
  description,
  onRetry,
  retryLabel = "Retry",
  className,
}: {
  error: unknown;
  title?: string;
  description?: string;
  onRetry?: () => unknown | Promise<unknown>;
  retryLabel?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const openSupport = useSupportModalStore((s) => s.openWith);

  const computedTitle = title ?? getDefaultTitle(error);
  const computedDescription = description ?? getDefaultDescription(error);

  const meta = useMemo(() => {
    if (!(error instanceof APIError)) {
      return null;
    }
    return {
      code: error.code,
      status: error.status,
      endpoint: error.endpoint,
      method: error.method,
      requestId: error.requestId,
    };
  }, [error]);

  const handleRetry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } catch (retryError) {
      toast.error(
        retryError instanceof Error ? retryError.message : "Retry failed"
      );
    } finally {
      setRetrying(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    const lines = [
      `API_BASE=${getApiBase()}`,
      `title=${computedTitle}`,
      `description=${computedDescription}`,
    ];
    if (meta) {
      lines.push(
        `code=${meta.code}`,
        `status=${meta.status}`,
        `endpoint=${meta.endpoint ?? "unknown"}`,
        `method=${meta.method ?? "unknown"}`,
        `requestId=${meta.requestId ?? "unknown"}`
      );
    }

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Diagnostics copied");
    } catch {
      toast.error("Failed to copy diagnostics");
    }
  };

  const handleContactSupport = () => {
    const subjectSuffix = meta?.code ? ` (${meta.code})` : "";
    const body = [
      "What I was doing:",
      "",
      "What happened:",
      computedDescription,
      "",
      meta
        ? `Endpoint: ${meta.method ?? "GET"} ${meta.endpoint ?? "unknown"} (status ${meta.status})`
        : null,
      meta?.requestId ? `Request ID: ${meta.requestId}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    openSupport({
      subject: `${computedTitle}${subjectSuffix}`.slice(0, 180),
      message: body,
      route: typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : undefined,
      diagnostics: meta
        ? {
            errorPanel: {
              code: meta.code,
              status: meta.status,
              endpoint: meta.endpoint,
              method: meta.method,
              requestId: meta.requestId,
              title: computedTitle,
              description: computedDescription,
            },
          }
        : {
            errorPanel: {
              title: computedTitle,
              description: computedDescription,
            },
          },
    });
  };

  const showSignIn = meta?.code === "UNAUTHENTICATED";
  const Icon = showSignIn ? ShieldAlert : AlertTriangle;

  return (
    <Card className={cn("border-amber-500/20 bg-card/60", className)}>
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-600">
            <Icon className="h-4 w-4" />
          </span>
          {computedTitle}
          {meta?.code ? (
            <span className="rounded-full border border-amber-500/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-amber-600">
              {meta.code.replace(/_/g, " ").toLowerCase()}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription className="text-sm">{computedDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {meta ? (
          <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
              <span className="font-mono text-foreground">
                {meta.method ?? "GET"} {meta.endpoint ?? "unknown"}
              </span>
              <span>status {meta.status}</span>
              {meta.requestId ? (
                <span className="font-mono">req {meta.requestId}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {onRetry ? (
            <Button
              className={cn("h-8 text-xs", retrying && "pointer-events-none")}
              onClick={handleRetry}
              size="sm"
              variant="outline"
            >
              <RefreshCw
                className={cn("mr-2 h-3.5 w-3.5", retrying && "animate-spin")}
              />
              {retryLabel}
            </Button>
          ) : null}

          {showSignIn ? (
            <Button
              className="h-8 text-xs"
              onClick={() => navigate({ to: "/login" })}
              size="sm"
            >
              <LogIn className="mr-2 h-3.5 w-3.5" />
              Sign in
            </Button>
          ) : null}

          <Button
            className="h-8 text-xs"
            onClick={handleContactSupport}
            size="sm"
            variant="secondary"
          >
            <LifeBuoy className="mr-2 h-3.5 w-3.5" />
            Contact support
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
      </CardContent>
    </Card>
  );
}
