"use client";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  type LucideIcon,
  Mail,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useI18n, useT } from "@/i18n";
import { cn } from "@/lib/utils";

// =============================================================================
// EVIDENCE CHAIN COMPONENT
// =============================================================================
//
// "Show me the source" component with clickable links to original messages
// in any source. Displays the evidence trail that led to a UIO.
//

export interface EvidenceSource {
  id: string;
  sourceType: string;
  role: "origin" | "update" | "confirmation" | "context";
  quotedText?: string | null;
  segmentHash?: string | null;
  extractedTitle?: string | null;
  confidence: number;
  sourceTimestamp?: Date | null;
  // Link data
  conversationId?: string | null;
  messageId?: string | null;
  emailThreadId?: string | null;
  emailMessageId?: string | null;
}

interface EvidenceChainProps extends React.HTMLAttributes<HTMLDivElement> {
  sources: EvidenceSource[];
  onViewSource?: (source: EvidenceSource) => void;
  loading?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

// Source type to icon mapping
const sourceIcons: Record<string, LucideIcon> = {
  email: Mail,
  slack: MessageSquare,
  calendar: Calendar,
  notion: FileText,
  google_docs: FileText,
  document: FileText,
  meeting_transcript: FileText,
  teams: MessageSquare,
  discord: MessageSquare,
  whatsapp: MessageSquare,
};

const ROLE_LABEL_KEYS: Record<string, string> = {
  origin: "evidenceChain.roles.origin",
  update: "evidenceChain.roles.update",
  confirmation: "evidenceChain.roles.confirmation",
  context: "evidenceChain.roles.context",
};

// Role to badge color
const roleColors: Record<string, string> = {
  origin:
    "bg-green-500/10 text-green-600 border-green-200 dark:bg-green-500/20 dark:text-green-400",
  update:
    "bg-blue-500/10 text-blue-600 border-blue-200 dark:bg-blue-500/20 dark:text-blue-400",
  confirmation:
    "bg-purple-500/10 text-purple-600 border-purple-200 dark:bg-purple-500/20 dark:text-purple-400",
  context:
    "bg-gray-500/10 text-gray-600 border-gray-200 dark:bg-gray-500/20 dark:text-gray-400",
};

const SOURCE_NAME_KEYS: Record<string, string> = {
  email: "evidenceChain.sources.email",
  slack: "evidenceChain.sources.slack",
  calendar: "evidenceChain.sources.calendar",
  notion: "evidenceChain.sources.notion",
  google_docs: "evidenceChain.sources.googleDocs",
  google_sheets: "evidenceChain.sources.googleSheets",
  document: "evidenceChain.sources.document",
  meeting_transcript: "evidenceChain.sources.meeting",
  teams: "evidenceChain.sources.teams",
  discord: "evidenceChain.sources.discord",
  whatsapp: "evidenceChain.sources.whatsapp",
  github: "evidenceChain.sources.github",
  linear: "evidenceChain.sources.linear",
};

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  let colorClass = "bg-green-500/10 text-green-600";
  if (percent < 70) {
    colorClass = "bg-yellow-500/10 text-yellow-600";
  }
  if (percent < 50) {
    colorClass = "bg-red-500/10 text-red-600";
  }

  return (
    <span className={cn("rounded px-1.5 py-0.5 text-xs", colorClass)}>
      {percent}%
    </span>
  );
}

function EvidenceItem({
  source,
  onViewSource,
}: {
  source: EvidenceSource;
  onViewSource?: (source: EvidenceSource) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const Icon = sourceIcons[source.sourceType] ?? FileText;
  const sourceNameKey = SOURCE_NAME_KEYS[source.sourceType];
  const sourceName = sourceNameKey ? t(sourceNameKey) : source.sourceType;
  const roleLabelKey = ROLE_LABEL_KEYS[source.role];
  const roleLabel = roleLabelKey ? t(roleLabelKey) : source.role;
  const roleColor = roleColors[source.role] ?? roleColors.context;
  const hasLink =
    source.conversationId || source.emailThreadId || source.messageId;

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <span className="font-medium text-sm">{sourceName}</span>
            {source.sourceTimestamp && (
              <span className="ml-2 text-muted-foreground text-xs">
                {new Intl.DateTimeFormat(locale, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(source.sourceTimestamp)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn("h-5 text-xs", roleColor)} variant="outline">
            {roleLabel}
          </Badge>
          <ConfidenceBadge confidence={source.confidence} />
        </div>
      </div>

      {/* Extracted content */}
      {source.extractedTitle && (
        <div className="font-medium text-foreground text-sm">
          {source.extractedTitle}
        </div>
      )}

      {/* Quoted text */}
      {source.quotedText && (
        <div className="border-muted border-l-2 pl-3">
          <p className="line-clamp-3 text-muted-foreground text-xs italic">
            "{source.quotedText}"
          </p>
        </div>
      )}

      {source.segmentHash && (
        <div className="text-muted-foreground text-xs">
          <span className="mr-1 font-medium">
            {t("evidenceChain.labels.segmentHash")}
          </span>
          <span
            className="inline-block max-w-full truncate align-bottom font-mono"
            title={source.segmentHash}
          >
            {source.segmentHash}
          </span>
        </div>
      )}

      {/* View source link */}
      {hasLink && onViewSource && (
        <Button
          className="h-7 w-fit text-xs"
          onClick={() => onViewSource(source)}
          size="sm"
          variant="ghost"
        >
          <ExternalLink className="mr-1.5 h-3 w-3" />
          {t("evidenceChain.actions.viewIn", { source: sourceName })}
        </Button>
      )}
    </div>
  );
}

export function EvidenceChain({
  sources,
  onViewSource,
  loading = false,
  collapsible = true,
  defaultOpen = true,
  className,
  ...props
}: EvidenceChainProps) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Sort sources: origin first, then by timestamp
  const sortedSources = [...sources].sort((a, b) => {
    if (a.role === "origin" && b.role !== "origin") {
      return -1;
    }
    if (b.role === "origin" && a.role !== "origin") {
      return 1;
    }
    const aTime = a.sourceTimestamp?.getTime() ?? 0;
    const bTime = b.sourceTimestamp?.getTime() ?? 0;
    return bTime - aTime;
  });

  if (loading) {
    return (
      <div className={cn("space-y-3", className)} {...props}>
        {[1, 2].map((i) => (
          <div className="h-24 animate-pulse rounded-lg bg-muted/50" key={i} />
        ))}
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div
        className={cn(
          "py-6 text-center text-muted-foreground text-sm",
          className
        )}
        {...props}
      >
        {t("evidenceChain.empty")}
      </div>
    );
  }

  const content = (
    <div className="space-y-3">
      {sortedSources.map((source) => (
        <EvidenceItem
          key={source.id}
          onViewSource={onViewSource}
          source={source}
        />
      ))}
    </div>
  );

  if (!collapsible) {
    return (
      <div className={className} {...props}>
        {content}
      </div>
    );
  }

  return (
    <Collapsible className={className} onOpenChange={setIsOpen} open={isOpen}>
      <CollapsibleTrigger asChild>
        <Button
          className="h-9 w-full justify-between px-3"
          size="sm"
          variant="ghost"
        >
          <span className="font-medium text-sm">
            {sources.length === 1
              ? t("evidenceChain.headingOne", { count: sources.length })
              : t("evidenceChain.headingMany", { count: sources.length })}
          </span>
          {isOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">{content}</CollapsibleContent>
    </Collapsible>
  );
}
