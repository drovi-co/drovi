function joinClassNames(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

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
    return "border-success/35 bg-success/10 text-success";
  }
  if (normalized === "running" || normalized === "accepted") {
    return "border-ring/40 bg-ring/10 text-ring";
  }
  if (normalized === "waiting_approval") {
    return "border-warning/35 bg-warning/10 text-warning";
  }
  if (normalized === "failed" || normalized === "cancelled") {
    return "border-destructive/35 bg-destructive/10 text-destructive";
  }
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

export function deploymentStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "active") {
    return "border-success/35 bg-success/10 text-success";
  }
  if (normalized === "canary") {
    return "border-ring/40 bg-ring/10 text-ring";
  }
  if (normalized === "draft") {
    return "border-warning/35 bg-warning/10 text-warning";
  }
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

export function statusBadgeClass(kind: "run" | "deployment", status: string) {
  return joinClassNames(
    "border font-medium",
    kind === "run" ? runStatusClass(status) : deploymentStatusClass(status)
  );
}
