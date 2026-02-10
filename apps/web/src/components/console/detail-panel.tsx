"use client";

/**
 * ConsoleDetailPanel
 *
 * Datadog-style slide-in drawer showing full item details:
 * - All attributes in key:value format
 * - Collapsible sections
 * - Event timeline
 * - Sources and related items
 * - Action buttons
 */

import { format, formatDistanceToNow } from "date-fns";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  Network,
  Paperclip,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  ConsoleItem,
  RelatedItem,
  SourceItem,
} from "@/hooks/use-console-query";
import {
  useRelatedUios,
  useSourceDetail,
  useUioSources,
} from "@/hooks/use-console-query";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ConsoleDetailPanelProps {
  item: ConsoleItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkComplete?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onArchive?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  organizationId: string;
  onSelectRelated?: (item: RelatedItem) => void;
}

// =============================================================================
// COLLAPSIBLE SECTION
// =============================================================================

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  count?: number;
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  count,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border">
      <button
        className="flex w-full items-center justify-between px-4 py-3 hover:bg-accent/50"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          <span className="font-medium text-sm">{title}</span>
          {count !== undefined && <Badge variant="secondary">{count}</Badge>}
        </div>
      </button>
      {isOpen && <div className="border-t px-4 py-3">{children}</div>}
    </div>
  );
}

// =============================================================================
// ATTRIBUTE ROW
// =============================================================================

interface AttributeRowProps {
  label: string;
  value: React.ReactNode;
  copyable?: boolean;
  copyValue?: string;
}

function AttributeRow({
  label,
  value,
  copyable,
  copyValue,
}: AttributeRowProps) {
  const resolvedCopyValue =
    typeof copyValue === "string"
      ? copyValue
      : typeof value === "string"
        ? value
        : null;
  const handleCopy = useCallback(() => {
    if (!resolvedCopyValue) {
      toast.error("Nothing to copy");
      return;
    }
    navigator.clipboard.writeText(resolvedCopyValue);
    toast.success("Copied to clipboard");
  }, [resolvedCopyValue]);

  return (
    <div className="group/attr grid grid-cols-[auto,minmax(0,1fr)] items-start gap-x-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-start justify-end gap-1.5 text-right">
        <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
          {value}
        </div>
        {copyable && (
          <button
            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover/attr:opacity-100"
            onClick={handleCopy}
            type="button"
          >
            <Copy className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// TYPE INDICATOR
// =============================================================================

function TypeIndicator({ type }: { type: string }) {
  // Vercel-style muted colors
  const colors: Record<string, string> = {
    commitment: "bg-[#666666]",
    decision: "bg-[#0070f3]",
    task: "bg-[#171717] dark:bg-[#ededed]",
    risk: "bg-[#dc2626]",
    claim: "bg-[#059669]",
    brief: "bg-[#a3a3a3]",
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn("size-2 rounded-full", colors[type] ?? "bg-[#a3a3a3]")}
      />
      <span className="font-medium text-xs uppercase tracking-wider">
        {type}
      </span>
    </div>
  );
}

// =============================================================================
// SOURCE DETAIL VIEW
// =============================================================================

interface SourceDetailViewProps {
  sourceId: string;
  organizationId: string;
  onBack: () => void;
  onSelectUio?: (uio: { id: string; type: string; title: string }) => void;
}

function SourceDetailView({
  sourceId,
  organizationId,
  onBack,
  onSelectUio,
}: SourceDetailViewProps) {
  const {
    data: detail,
    isLoading,
    error,
  } = useSourceDetail(organizationId, sourceId);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-destructive">Failed to load source details</p>
        <Button onClick={onBack} size="sm" variant="outline">
          <ArrowLeft className="mr-2 size-4" />
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Header with back button */}
      <SheetHeader className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            className="size-8"
            onClick={onBack}
            size="icon"
            variant="ghost"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Badge className="capitalize" variant="outline">
                <Mail className="mr-1 size-3" />
                {detail.source_type}
              </Badge>
              {detail.has_attachments && (
                <Badge variant="secondary">
                  <Paperclip className="mr-1 size-3" />
                  {detail.attachments.length}
                </Badge>
              )}
            </div>
            <SheetTitle className="mt-1 text-left text-lg">
              {detail.subject || "No Subject"}
            </SheetTitle>
          </div>
          {detail.deep_link && (
            <Button asChild size="sm" variant="outline">
              <a
                href={detail.deep_link}
                rel="noopener noreferrer"
                target="_blank"
              >
                <ExternalLink className="mr-1.5 size-4" />
                Open Original
              </a>
            </Button>
          )}
        </div>
      </SheetHeader>

      <ScrollArea className="h-[calc(100vh-180px)] overflow-x-hidden">
        <div className="space-y-4 overflow-x-hidden px-6 py-4">
          {/* Source Info Header */}
          <div className="flex items-start gap-3 overflow-hidden rounded-lg border p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Mail className="size-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {detail.sender_name || detail.sender_email ? (
                    <>
                      <p className="truncate font-medium">
                        {detail.sender_name || detail.sender_email}
                      </p>
                      {detail.sender_email && detail.sender_name && (
                        <p className="truncate text-muted-foreground text-sm">
                          {detail.sender_email}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="font-medium capitalize">
                      {detail.source_type} Source
                    </p>
                  )}
                </div>
                {(detail.sent_at || detail.received_at) && (
                  <p className="shrink-0 text-muted-foreground text-sm">
                    {format(
                      new Date(detail.sent_at || detail.received_at!),
                      "PPpp"
                    )}
                  </p>
                )}
              </div>
              {detail.recipients.length > 0 && (
                <p className="mt-1 truncate text-muted-foreground text-sm">
                  To:{" "}
                  {detail.recipients.map((r) => r.name || r.email).join(", ")}
                </p>
              )}
            </div>
          </div>

          {/* Main Evidence Content */}
          {detail.quoted_text ? (
            <CollapsibleSection defaultOpen title="Extracted Evidence">
              <div className="overflow-hidden rounded-lg border-primary/50 border-l-4 bg-muted/50 p-4">
                <p className="mb-2 text-muted-foreground text-xs uppercase tracking-wide">
                  AI extracted the following from this source:
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">
                  "{detail.quoted_text}"
                </p>
              </div>
            </CollapsibleSection>
          ) : detail.body_html || detail.body_text || detail.snippet ? (
            <CollapsibleSection defaultOpen title="Message Content">
              <div className="prose prose-sm dark:prose-invert max-w-none overflow-hidden break-words [&_*]:max-w-full [&_*]:break-words">
                {detail.body_html ? (
                  <div
                    className="overflow-hidden break-words text-sm [&_*]:max-w-full [&_*]:break-words"
                    dangerouslySetInnerHTML={{ __html: detail.body_html }}
                  />
                ) : detail.body_text ? (
                  <pre className="max-w-full overflow-hidden whitespace-pre-wrap break-words font-sans text-sm">
                    {detail.body_text}
                  </pre>
                ) : (
                  <p className="break-words text-muted-foreground text-sm">
                    {detail.snippet}
                  </p>
                )}
              </div>
            </CollapsibleSection>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-sm">
              No content available for this source
            </div>
          )}

          {/* Attachments */}
          {detail.attachments.length > 0 && (
            <CollapsibleSection
              count={detail.attachments.length}
              defaultOpen
              title="Attachments"
            >
              <div className="space-y-2">
                {detail.attachments.map((att) => (
                  <div
                    className="flex items-center gap-2 rounded-lg border p-2"
                    key={att.id}
                  >
                    <Paperclip className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate text-sm">
                      {att.filename}
                    </span>
                    {att.size_bytes && (
                      <span className="text-muted-foreground text-xs">
                        {(att.size_bytes / 1024).toFixed(1)} KB
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Conversation Context */}
          {detail.conversation_title && (
            <CollapsibleSection defaultOpen={false} title="Conversation">
              <div className="space-y-2">
                <AttributeRow
                  label="Thread"
                  value={detail.conversation_title}
                />
                <AttributeRow
                  label="Messages"
                  value={`${detail.message_count} message${detail.message_count !== 1 ? "s" : ""}`}
                />
              </div>
            </CollapsibleSection>
          )}

          {/* Related UIOs from same source */}
          {detail.related_uios.length > 0 && (
            <CollapsibleSection
              count={detail.related_uios.length}
              defaultOpen
              title="Intelligence from this Source"
            >
              <div className="space-y-2">
                {detail.related_uios.map((uio) => (
                  <button
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg border p-2 text-left",
                      "transition-colors hover:bg-accent/50",
                      onSelectUio && "cursor-pointer"
                    )}
                    key={uio.id}
                    onClick={() => onSelectUio?.(uio)}
                    type="button"
                  >
                    <Badge
                      className="text-xs uppercase"
                      variant={
                        uio.type === "commitment"
                          ? "default"
                          : uio.type === "decision"
                            ? "info"
                            : uio.type === "task"
                              ? "warning"
                              : "secondary"
                      }
                    >
                      {uio.type}
                    </Badge>
                    <span className="flex-1 truncate text-sm">{uio.title}</span>
                    {uio.confidence !== null && (
                      <span className="text-muted-foreground text-xs">
                        {Math.round(uio.confidence * 100)}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Metadata */}
          <CollapsibleSection defaultOpen={false} title="Metadata">
            <div className="space-y-1">
              <AttributeRow
                copyable
                copyValue={detail.source_id}
                label="Source ID"
                value={
                  <code className="text-xs">
                    {detail.source_id.slice(0, 12)}...
                  </code>
                }
              />
              <AttributeRow label="Source Type" value={detail.source_type} />
              {detail.sent_at && (
                <AttributeRow
                  label="Sent"
                  value={format(new Date(detail.sent_at), "PPpp")}
                />
              )}
              {detail.received_at && (
                <AttributeRow
                  label="Received"
                  value={format(new Date(detail.received_at), "PPpp")}
                />
              )}
            </div>
          </CollapsibleSection>
        </div>
      </ScrollArea>
    </>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ConsoleDetailPanel({
  item,
  open,
  onOpenChange,
  onMarkComplete,
  onSnooze,
  onArchive,
  onEdit,
  onDelete,
  organizationId,
  onSelectRelated,
}: ConsoleDetailPanelProps) {
  // View state for drill-down navigation
  const [viewMode, setViewMode] = useState<"item" | "source">("item");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  // Reset view when panel closes or item changes
  useEffect(() => {
    if (!open) {
      setViewMode("item");
      setSelectedSourceId(null);
    }
  }, [open]);

  useEffect(() => {
    setViewMode("item");
    setSelectedSourceId(null);
  }, [item?.id]);

  // Fetch sources and related items
  const { data: sources, isLoading: sourcesLoading } = useUioSources(
    organizationId,
    open && viewMode === "item" ? (item?.id ?? null) : null
  );
  const { data: relatedItems, isLoading: relatedLoading } = useRelatedUios(
    organizationId,
    open && viewMode === "item" ? (item?.id ?? null) : null
  );

  const handleCopyId = useCallback(() => {
    if (!item) return;
    navigator.clipboard.writeText(item.id);
    toast.success("ID copied to clipboard");
  }, [item?.id]);

  const handleSourceClick = useCallback((source: SourceItem) => {
    setSelectedSourceId(source.id);
    setViewMode("source");
  }, []);

  const handleBackFromSource = useCallback(() => {
    setViewMode("item");
    setSelectedSourceId(null);
  }, []);

  if (!item) {
    return null;
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="!w-full sm:!w-[65vw] sm:!max-w-[900px] overflow-hidden p-0">
        {/* Source Detail View - Drill-down state */}
        {viewMode === "source" && selectedSourceId ? (
          <SourceDetailView
            onBack={handleBackFromSource}
            organizationId={organizationId}
            sourceId={selectedSourceId}
          />
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="border-b px-6 py-4 pr-12">
              <div className="flex items-center gap-2">
                <TypeIndicator type={item.type} />
                <Button
                  className="size-6"
                  onClick={handleCopyId}
                  size="icon"
                  title="Copy ID"
                  variant="ghost"
                >
                  <Copy className="size-3" />
                </Button>
              </div>
              <SheetTitle className="mt-2 text-left text-lg">
                {item.title}
              </SheetTitle>
            </SheetHeader>

            <ScrollArea className="h-[calc(100vh-200px)] overflow-x-hidden">
              <div className="space-y-4 overflow-x-hidden px-6 py-4">
                {/* Attributes Section */}
                <CollapsibleSection title="Attributes">
                  <div className="group space-y-0.5">
                    <AttributeRow
                      copyable
                      copyValue={item.id}
                      label="id"
                      value={
                        <code className="text-xs">
                          {item.id.slice(0, 8)}...
                        </code>
                      }
                    />
                    <AttributeRow label="type" value={item.type} />
                    <AttributeRow
                      label="status"
                      value={
                        <Badge
                          variant={
                            item.status === "completed"
                              ? "success"
                              : item.is_overdue
                                ? "destructive"
                                : item.is_at_risk
                                  ? "warning"
                                  : "secondary"
                          }
                        >
                          {item.status.replace(/_/g, " ")}
                        </Badge>
                      }
                    />
                    {item.priority && (
                      <AttributeRow
                        label="priority"
                        value={
                          <Badge
                            variant={
                              item.priority === "urgent"
                                ? "destructive"
                                : item.priority === "high"
                                  ? "warning"
                                  : "secondary"
                            }
                          >
                            {item.priority}
                          </Badge>
                        }
                      />
                    )}
                    {item.owner && (
                      <AttributeRow
                        label="owner"
                        value={
                          <div className="flex items-center gap-1.5">
                            <Avatar className="size-4">
                              <AvatarImage
                                src={item.owner.avatar_url ?? undefined}
                              />
                              <AvatarFallback className="text-[8px]">
                                {(item.owner.display_name ??
                                  item.owner.email)?.[0]?.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span>
                              {item.owner.display_name ?? item.owner.email}
                            </span>
                            <Link2 className="size-3 text-muted-foreground" />
                          </div>
                        }
                      />
                    )}
                    {item.due_date && (
                      <AttributeRow
                        label="due_date"
                        value={
                          <span
                            className={cn(item.is_overdue && "text-[#dc2626]")}
                          >
                            {format(new Date(item.due_date), "PPP")}
                          </span>
                        }
                      />
                    )}
                    <AttributeRow
                      label="confidence"
                      value={
                        item.confidence !== null ? (
                          <div className="flex items-center gap-1">
                            <Sparkles className="size-3" />
                            <span>{Math.round(item.confidence * 100)}%</span>
                          </div>
                        ) : (
                          "—"
                        )
                      }
                    />
                    {item.source_type && (
                      <AttributeRow label="source" value={item.source_type} />
                    )}
                    <AttributeRow
                      label="created_at"
                      value={format(new Date(item.created_at), "PPpp")}
                    />
                    <AttributeRow
                      label="updated_at"
                      value={format(new Date(item.updated_at), "PPpp")}
                    />
                    <AttributeRow
                      label="verified"
                      value={item.is_user_verified ? "true" : "false"}
                    />
                  </div>
                </CollapsibleSection>

                {/* Description Section */}
                {item.description && (
                  <CollapsibleSection title="Description">
                    <p className="whitespace-pre-wrap text-sm">
                      {item.description}
                    </p>
                  </CollapsibleSection>
                )}

                {/* Event Timeline Section */}
                <CollapsibleSection defaultOpen={false} title="Event Timeline">
                  <div className="relative space-y-4">
                    {/* Timeline line */}
                    <div className="absolute top-2 bottom-2 left-[7px] w-px bg-border" />

                    {/* Creation event */}
                    <div className="relative flex gap-3">
                      <div className="relative z-10 size-4 rounded-full border-2 border-primary bg-background" />
                      <div className="flex-1 pb-2">
                        <p className="font-medium text-sm">
                          {item.type.charAt(0).toUpperCase() +
                            item.type.slice(1)}{" "}
                          extracted
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatDistanceToNow(new Date(item.created_at), {
                            addSuffix: true,
                          })}
                          {item.confidence !== null &&
                            ` • confidence: ${Math.round(item.confidence * 100)}%`}
                        </p>
                        {item.source_type && (
                          <Button
                            className="mt-1 h-6 px-2"
                            size="sm"
                            variant="link"
                          >
                            <ExternalLink className="mr-1 size-3" />
                            View Source
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Updated event (if different from created) */}
                    {item.updated_at !== item.created_at && (
                      <div className="relative flex gap-3">
                        <div className="relative z-10 size-4 rounded-full border-2 border-muted bg-background" />
                        <div className="flex-1 pb-2">
                          <p className="font-medium text-sm">Updated</p>
                          <p className="text-muted-foreground text-xs">
                            {formatDistanceToNow(new Date(item.updated_at), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </CollapsibleSection>

                {/* Contacts Section */}
                {(() => {
                  const contacts = [
                    item.owner && { role: "Owner", ...item.owner },
                    item.debtor && { role: "Debtor", ...item.debtor },
                    item.creditor && { role: "Creditor", ...item.creditor },
                    item.assignee && { role: "Assignee", ...item.assignee },
                    item.decision_maker && {
                      role: "Decision Maker",
                      ...item.decision_maker,
                    },
                  ].filter(Boolean) as Array<{
                    role: string;
                    id: string;
                    display_name: string | null;
                    email: string;
                    avatar_url: string | null;
                    company: string | null;
                  }>;

                  if (contacts.length === 0) return null;

                  return (
                    <CollapsibleSection
                      count={contacts.length}
                      title="Contacts"
                    >
                      <div className="space-y-2">
                        {contacts.map((contact) => (
                          <div
                            className="flex items-center justify-between rounded-lg border p-2"
                            key={`${contact.role}-${contact.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <Avatar className="size-6">
                                <AvatarImage
                                  src={contact.avatar_url ?? undefined}
                                />
                                <AvatarFallback className="text-xs">
                                  {(contact.display_name ??
                                    contact.email)?.[0]?.toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium text-sm">
                                  {contact.display_name ??
                                    contact.email?.split("@")[0] ??
                                    "Unknown"}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                  {contact.role} • {contact.email}
                                </p>
                              </div>
                            </div>
                            <Button
                              className="size-6"
                              size="icon"
                              variant="ghost"
                            >
                              <ExternalLink className="size-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  );
                })()}

                {/* Sources Section */}
                <CollapsibleSection
                  count={sources?.length}
                  defaultOpen={sources && sources.length > 0}
                  title="Sources"
                >
                  {sourcesLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  ) : sources && sources.length > 0 ? (
                    <div className="space-y-2">
                      {sources.map((source) => (
                        <button
                          className={cn(
                            "flex w-full items-start justify-between rounded-lg border p-3 text-left",
                            "cursor-pointer transition-colors hover:bg-accent/50"
                          )}
                          key={source.id}
                          onClick={() => handleSourceClick(source)}
                          type="button"
                        >
                          <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                            <div className="flex min-w-0 items-center gap-2">
                              <Badge
                                className="shrink-0 capitalize"
                                variant="outline"
                              >
                                {source.source_type}
                              </Badge>
                              {source.subject ? (
                                <span className="min-w-0 truncate font-medium text-sm">
                                  {source.subject}
                                </span>
                              ) : source.quoted_text ? (
                                <span className="min-w-0 truncate text-muted-foreground text-sm">
                                  "{source.quoted_text.slice(0, 60)}..."
                                </span>
                              ) : null}
                              <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
                            </div>
                            {source.sender_name && (
                              <p className="truncate text-muted-foreground text-xs">
                                From: {source.sender_name}
                                {source.sender_email &&
                                  ` <${source.sender_email}>`}
                              </p>
                            )}
                            {source.quoted_text && source.subject && (
                              <p className="line-clamp-2 break-words text-muted-foreground text-xs italic">
                                "{source.quoted_text}"
                              </p>
                            )}
                            {source.source_timestamp && (
                              <p className="text-muted-foreground text-xs">
                                {formatDistanceToNow(
                                  new Date(source.source_timestamp),
                                  {
                                    addSuffix: true,
                                  }
                                )}
                              </p>
                            )}
                          </div>
                          {source.deep_link && (
                            <Button
                              asChild
                              className="ml-2 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                              size="sm"
                              variant="ghost"
                            >
                              <a
                                href={source.deep_link}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                <ExternalLink className="size-4" />
                              </a>
                            </Button>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                      <FileText className="mr-2 size-4" />
                      No source evidence found
                    </div>
                  )}
                </CollapsibleSection>

                {/* Related Objects Section */}
                <CollapsibleSection
                  count={relatedItems?.length}
                  defaultOpen={relatedItems && relatedItems.length > 0}
                  title="Related Objects"
                >
                  {relatedLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  ) : relatedItems && relatedItems.length > 0 ? (
                    <div className="space-y-2">
                      {relatedItems.map((related) => (
                        <button
                          className={cn(
                            "flex w-full items-start justify-between rounded-lg border p-3 text-left",
                            "transition-colors hover:bg-accent/50",
                            onSelectRelated && "cursor-pointer"
                          )}
                          key={related.id}
                          onClick={() => onSelectRelated?.(related)}
                          type="button"
                        >
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge
                                className="text-xs uppercase"
                                variant={
                                  related.type === "commitment"
                                    ? "default"
                                    : related.type === "decision"
                                      ? "info"
                                      : related.type === "task"
                                        ? "warning"
                                        : related.type === "risk"
                                          ? "destructive"
                                          : "secondary"
                                }
                              >
                                {related.type}
                              </Badge>
                              <Badge className="text-xs" variant="outline">
                                {related.relationship.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <p className="line-clamp-2 font-medium text-sm">
                              {related.title}
                            </p>
                            <div className="flex items-center gap-2 text-muted-foreground text-xs">
                              <span className="capitalize">
                                {related.status.replace(/_/g, " ")}
                              </span>
                              {related.confidence !== null && (
                                <>
                                  <span>•</span>
                                  <span>
                                    {Math.round(related.confidence * 100)}%
                                  </span>
                                </>
                              )}
                              <span>•</span>
                              <span>
                                {formatDistanceToNow(
                                  new Date(related.created_at),
                                  {
                                    addSuffix: true,
                                  }
                                )}
                              </span>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                      <Network className="mr-2 size-4" />
                      No related items found
                    </div>
                  )}
                </CollapsibleSection>

                {/* AI Confidence Breakdown */}
                <CollapsibleSection
                  defaultOpen={false}
                  title="AI Confidence Breakdown"
                >
                  <div className="space-y-3">
                    {item.confidence !== null ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-sm">
                            Overall Confidence
                          </span>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  item.confidence >= 0.8
                                    ? "bg-foreground"
                                    : item.confidence >= 0.5
                                      ? "bg-muted-foreground"
                                      : "bg-muted-foreground/50"
                                )}
                                style={{ width: `${item.confidence * 100}%` }}
                              />
                            </div>
                            <span className="w-10 text-right font-medium text-sm">
                              {Math.round(item.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          Detailed confidence breakdown coming soon
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        No confidence data available
                      </p>
                    )}
                  </div>
                </CollapsibleSection>
              </div>
            </ScrollArea>

            {/* Action Bar */}
            <div className="absolute inset-x-0 bottom-0 border-t bg-background px-6 py-4">
              <div className="flex items-center gap-2">
                {item.status !== "completed" && onMarkComplete && (
                  <Button
                    onClick={() => onMarkComplete(item.id)}
                    size="sm"
                    variant="default"
                  >
                    <CheckCircle2 className="mr-1.5 size-4" />
                    Mark Complete
                  </Button>
                )}
                {onSnooze && (
                  <Button
                    onClick={() => onSnooze(item.id)}
                    size="sm"
                    variant="outline"
                  >
                    <Clock className="mr-1.5 size-4" />
                    Snooze
                  </Button>
                )}
                {onArchive && (
                  <Button
                    onClick={() => onArchive(item.id)}
                    size="sm"
                    variant="outline"
                  >
                    <Archive className="mr-1.5 size-4" />
                    Archive
                  </Button>
                )}
                <div className="flex-1" />
                {onEdit && (
                  <Button
                    className="size-8"
                    onClick={() => onEdit(item.id)}
                    size="icon"
                    variant="ghost"
                  >
                    <Edit2 className="size-4" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    className="size-8 text-destructive hover:text-destructive"
                    onClick={() => onDelete(item.id)}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
