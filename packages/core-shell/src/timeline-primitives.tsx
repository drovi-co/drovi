import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import { cn } from "@memorystack/ui-core/utils";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

export interface TimelinePrimitiveEvent {
  id: string;
  title: string;
  description?: string | null;
  timestampLabel: string;
  sourceLabel?: string | null;
  quote?: string | null;
  actorLabel?: string | null;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}

export interface TimelinePrimitivesProps {
  events: TimelinePrimitiveEvent[];
  className?: string;
  emptyState?: ReactNode;
  onOpenSource?: (event: TimelinePrimitiveEvent) => void;
  variant?: "default" | "institutional";
}

function markerToneClass(
  tone: TimelinePrimitiveEvent["tone"],
  variant: "default" | "institutional"
): string {
  if (tone === "success") {
    return variant === "institutional" ? "bg-emerald-700" : "bg-emerald-500";
  }
  if (tone === "warning") {
    return variant === "institutional" ? "bg-amber-700" : "bg-amber-500";
  }
  if (tone === "danger") {
    return variant === "institutional" ? "bg-red-700" : "bg-red-500";
  }
  return variant === "institutional" ? "bg-[color:var(--ring)]" : "bg-primary";
}

export function TimelinePrimitives({
  events,
  className,
  emptyState,
  onOpenSource,
  variant = "default",
}: TimelinePrimitivesProps) {
  if (events.length === 0) {
    return (
      <div
        className={cn(
          "py-8 text-center text-muted-foreground text-sm",
          className
        )}
      >
        {emptyState ?? "No timeline events yet."}
      </div>
    );
  }

  return (
    <div className={cn("space-y-0", className)} data-variant={variant}>
      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        return (
          <div className="flex gap-3" key={event.id}>
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center text-primary-foreground",
                  variant === "institutional" ? "rounded-sm" : "rounded-full",
                  markerToneClass(event.tone, variant)
                )}
              >
                {event.icon ?? (
                  <span className="size-2 rounded-full bg-current" />
                )}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "mt-2 min-h-[24px] w-0.5 flex-1",
                    variant === "institutional" ? "bg-border/80" : "bg-border"
                  )}
                />
              )}
            </div>
            <div className="flex-1 space-y-2 pb-6">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="font-medium text-sm">{event.title}</div>
                  {event.description ? (
                    <div className="text-muted-foreground text-xs">
                      {event.description}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                    {event.sourceLabel ? (
                      <Badge
                        className="h-5 px-1.5 py-0"
                        variant={variant === "institutional" ? "seal" : "secondary"}
                      >
                        {event.sourceLabel}
                      </Badge>
                    ) : null}
                    {event.actorLabel ? <span>{event.actorLabel}</span> : null}
                  </div>
                </div>
                <span className="whitespace-nowrap text-muted-foreground text-xs">
                  {event.timestampLabel}
                </span>
              </div>
              {event.quote ? (
                <blockquote
                  className={cn(
                    "px-3 py-2 text-xs italic",
                    variant === "institutional"
                      ? "rounded-sm border border-border/70 bg-muted/30"
                      : "rounded-md border-border border-l-2 bg-muted/40"
                  )}
                >
                  "{event.quote}"
                </blockquote>
              ) : null}
              {onOpenSource ? (
                <Button
                  className="h-7 px-2 text-xs"
                  onClick={() => onOpenSource(event)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <ExternalLink className="mr-1.5 size-3.5" />
                  View source
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
