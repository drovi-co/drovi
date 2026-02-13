import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { cn } from "@memorystack/ui-core/utils";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

export interface EvidenceLensItem {
  id: string;
  title: string;
  quote?: string | null;
  sourceLabel?: string | null;
  timestampLabel?: string | null;
  confidence?: number | null;
  roleLabel?: string | null;
}

export interface EvidenceLensProps {
  items: EvidenceLensItem[];
  onOpenSource?: (item: EvidenceLensItem) => void;
  className?: string;
  emptyState?: ReactNode;
}

function formatConfidence(
  confidence: number | null | undefined
): string | null {
  if (confidence == null) {
    return null;
  }
  return `${Math.round(confidence * 100)}%`;
}

function confidenceVariant(
  confidence: number | null | undefined
): "secondary" | "destructive" | "default" {
  if (confidence == null) {
    return "secondary";
  }
  if (confidence < 0.5) {
    return "destructive";
  }
  if (confidence < 0.8) {
    return "secondary";
  }
  return "default";
}

export function EvidenceLens({
  items,
  onOpenSource,
  className,
  emptyState,
}: EvidenceLensProps) {
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "py-6 text-center text-muted-foreground text-sm",
          className
        )}
      >
        {emptyState ?? "No evidence found."}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {items.map((item) => {
        const confidence = formatConfidence(item.confidence);
        return (
          <Card key={item.id}>
            <CardHeader className="space-y-2 pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm">{item.title}</CardTitle>
                <div className="flex items-center gap-2">
                  {item.roleLabel ? (
                    <Badge variant="outline">{item.roleLabel}</Badge>
                  ) : null}
                  {confidence ? (
                    <Badge variant={confidenceVariant(item.confidence)}>
                      {confidence}
                    </Badge>
                  ) : null}
                </div>
              </div>
              {(item.sourceLabel || item.timestampLabel) && (
                <div className="text-muted-foreground text-xs">
                  {item.sourceLabel}
                  {item.sourceLabel && item.timestampLabel ? " · " : null}
                  {item.timestampLabel}
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {item.quote ? (
                <blockquote className="rounded-md border-border border-l-2 bg-muted/40 px-3 py-2 text-sm italic">
                  "{item.quote}"
                </blockquote>
              ) : null}
              {onOpenSource ? (
                <Button
                  className="h-8 px-2 text-xs"
                  onClick={() => onOpenSource(item)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <ExternalLink className="mr-1.5 size-3.5" />
                  Open source
                </Button>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
