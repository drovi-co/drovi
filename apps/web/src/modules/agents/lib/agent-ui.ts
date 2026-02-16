import { cn } from "@/lib/utils";

export function formatDateTime(value: unknown): string {
  if (!value) {
    return "—";
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function runStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "completed") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600";
  }
  if (normalized === "running" || normalized === "accepted") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-600";
  }
  if (normalized === "waiting_approval") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-600";
  }
  if (normalized === "failed" || normalized === "cancelled") {
    return "border-red-500/30 bg-red-500/10 text-red-600";
  }
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

export function deploymentStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "active") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600";
  }
  if (normalized === "canary") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-600";
  }
  if (normalized === "draft") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-600";
  }
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

export function statusBadgeClass(kind: "run" | "deployment", status: string) {
  return cn(
    "border font-medium",
    kind === "run" ? runStatusClass(status) : deploymentStatusClass(status)
  );
}
