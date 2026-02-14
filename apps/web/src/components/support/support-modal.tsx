import { Button } from "@memorystack/ui-core/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@memorystack/ui-core/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@memorystack/ui-core/dialog";
import { Input } from "@memorystack/ui-core/input";
import { Label } from "@memorystack/ui-core/label";
import { Switch } from "@memorystack/ui-core/switch";
import { Textarea } from "@memorystack/ui-core/textarea";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Copy, LifeBuoy, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { connectionsAPI, getApiBase, supportAPI } from "@/lib/api";
import { useApiTraceStore } from "@/lib/api-trace";
import { useAuthStore } from "@/lib/auth";
import { useSupportModalStore } from "@/lib/support-modal";
import { cn } from "@/lib/utils";

function safeJsonPreview(value: unknown, maxChars = 8000): string {
  try {
    const json = JSON.stringify(value, null, 2) ?? "";
    if (json.length <= maxChars) return json;
    return `${json.slice(0, maxChars)}\n… (truncated, ${json.length - maxChars} chars omitted)`;
  } catch {
    return "Unable to render diagnostics.";
  }
}

export function SupportModal() {
  const user = useAuthStore((s) => s.user);

  const open = useSupportModalStore((s) => s.open);
  const prefill = useSupportModalStore((s) => s.prefill);
  const close = useSupportModalStore((s) => s.close);

  const traces = useApiTraceStore((s) => s.traces);

  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null);

  const recentErrors = useMemo(() => {
    return traces
      .filter((t) => t.kind === "error")
      .slice(0, 10)
      .map((t) => ({
        at: new Date(t.at).toISOString(),
        method: t.method,
        endpoint: t.endpoint,
        status: t.status,
        requestId: t.requestId,
        durationMs: t.durationMs,
      }));
  }, [traces]);

  const currentRoute = useMemo(() => {
    if (typeof window === "undefined") return prefill?.route ?? null;
    return `${window.location.pathname}${window.location.search}`;
  }, [prefill?.route]);

  const diagnostics = useMemo(() => {
    const base: Record<string, unknown> = {
      route: currentRoute,
      apiBase: getApiBase(),
      user: user
        ? {
            id: user.user_id,
            email: user.email,
            role: user.role,
            orgId: user.org_id,
            orgName: user.org_name,
          }
        : null,
      browser:
        typeof navigator !== "undefined"
          ? { userAgent: navigator.userAgent, language: navigator.language }
          : null,
      recentApiErrors: recentErrors,
      createdAt: new Date().toISOString(),
    };

    const merged = {
      ...base,
      ...(prefill?.diagnostics ?? {}),
    };

    // Keep payload reasonably bounded and serializable.
    return merged;
  }, [currentRoute, prefill?.diagnostics, recentErrors, user]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const trimmedSubject = subject.trim();
      const trimmedMessage = message.trim();
      if (trimmedSubject.length < 3) {
        throw new Error("Subject must be at least 3 characters.");
      }
      if (!trimmedMessage) {
        throw new Error("Message cannot be empty.");
      }

      let connectorSnapshot: unknown = null;
      if (includeDiagnostics) {
        try {
          const connections = await connectionsAPI.list();
          connectorSnapshot = connections.map((c) => ({
            id: c.id,
            connector_type: c.connector_type,
            status: c.status,
            created_at: c.created_at,
            last_sync_at: c.last_sync_at,
            sync_enabled: c.sync_enabled,
            streams: c.streams,
          }));
        } catch (error) {
          connectorSnapshot = {
            error:
              error instanceof Error
                ? error.message
                : "Failed to list connections",
          };
        }
      }

      return supportAPI.createTicket({
        subject: trimmedSubject,
        message: trimmedMessage,
        route: currentRoute ?? undefined,
        locale:
          prefill?.locale ??
          (typeof navigator !== "undefined" ? navigator.language : undefined),
        diagnostics: includeDiagnostics
          ? {
              ...diagnostics,
              connections: connectorSnapshot,
            }
          : {},
      });
    },
    onSuccess: (result) => {
      setCreatedTicketId(result.ticket_id);
      toast.success("Support ticket created", {
        description: `Ticket ${result.ticket_id}`,
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to create ticket"
      );
    },
  });

  useEffect(() => {
    if (!open) return;
    setCreatedTicketId(null);
    setShowDiagnostics(false);
    setIncludeDiagnostics(true);
    setSubject(prefill?.subject ?? "");
    setMessage(prefill?.message ?? "");
  }, [open, prefill?.message, prefill?.subject]);

  const diagnosticsPreview = useMemo(
    () => safeJsonPreview(diagnostics),
    [diagnostics]
  );

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
      open={open}
    >
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-muted/40">
              <LifeBuoy className="h-4 w-4 text-foreground/80" />
            </span>
            Contact support
          </DialogTitle>
          <DialogDescription>
            Create a ticket for the Drovi team. Replies arrive by email and
            appear in the admin console.
          </DialogDescription>
        </DialogHeader>

        {createdTicketId ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="text-muted-foreground text-xs uppercase tracking-[0.22em]">
                Ticket created
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="font-mono text-sm">{createdTicketId}</div>
                <Button
                  className="h-8 text-xs"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(createdTicketId);
                      toast.success("Ticket ID copied");
                    } catch {
                      toast.error("Failed to copy");
                    }
                  }}
                  size="sm"
                  variant="outline"
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              <div className="mt-3 text-muted-foreground text-xs">
                You can close this window. If you don’t hear back, reply to the
                confirmation email to add more context.
              </div>
            </div>

            <DialogFooter className="justify-end">
              <Button onClick={() => close()}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="support-subject">Subject</Label>
              <Input
                id="support-subject"
                onChange={(ev) => setSubject(ev.target.value)}
                placeholder="Example: Gmail connector stuck on backfill"
                value={subject}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="support-message">Message</Label>
              <Textarea
                className="min-h-[120px] resize-y"
                id="support-message"
                onChange={(ev) => setMessage(ev.target.value)}
                placeholder="What happened? What did you expect? Include any steps to reproduce."
                value={message}
              />
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-medium text-sm">Include diagnostics</div>
                  <div className="text-muted-foreground text-xs">
                    Route, API base, and recent request errors help us debug
                    faster.
                  </div>
                </div>
                <Switch
                  checked={includeDiagnostics}
                  onCheckedChange={setIncludeDiagnostics}
                />
              </div>

              <Collapsible
                className={cn("mt-3", !includeDiagnostics && "opacity-50")}
                onOpenChange={setShowDiagnostics}
                open={showDiagnostics}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    className="h-8 w-full justify-between px-2 text-xs"
                    disabled={!includeDiagnostics}
                    type="button"
                    variant="ghost"
                  >
                    <span className="text-muted-foreground">
                      Preview diagnostics ({recentErrors.length} recent API
                      errors)
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        showDiagnostics && "rotate-180"
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 max-h-[220px] overflow-auto rounded-md border border-border/70 bg-background/30 p-3">
                    <pre className="text-[11px] text-muted-foreground leading-relaxed">
                      {diagnosticsPreview}
                    </pre>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            <DialogFooter className="justify-end gap-2">
              <Button
                className="h-9"
                onClick={() => close()}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                className="h-9"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate()}
                type="button"
              >
                <Send
                  className={cn(
                    "mr-2 h-4 w-4",
                    createMutation.isPending && "opacity-70"
                  )}
                />
                {createMutation.isPending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
