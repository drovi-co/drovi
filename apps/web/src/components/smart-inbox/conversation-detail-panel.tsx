// =============================================================================
// CONVERSATION DETAIL PANEL COMPONENT
// =============================================================================
//
// Right panel (2/3 width) displaying full conversation details.
// Clean design matching the task detail page:
// - Title with optional pending tag
// - Description section (AI brief)
// - Email fields (From, Subject, To) then body
// - Beautiful timeline with vertical line and circular dots

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  Archive,
  Clock,
  ExternalLink,
  Inbox,
  Link2,
  MessageSquare,
  Paperclip,
  Send,
  Star,
  StarOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommentThread, WhoIsViewing } from "@/components/collaboration";
import type { LinkedUIOCardData } from "@/components/smart-inbox/linked-uio-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTrackViewing } from "@/hooks/use-presence";
import { authClient, useActiveOrganization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

export interface ConversationDetailPanelProps {
  conversationId: string | null;
  onClose: () => void;
  className?: string;
}

interface TimelineEvent {
  id: string;
  type: "status_change" | "message" | "action";
  icon?: "pending" | "investigating" | "resolved" | "message";
  label?: string;
  description: string;
  date: Date;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Remove email signatures and common noise from message bodies.
 * Strips everything after common signature patterns.
 */
function cleanMessageBody(text: string): string {
  if (!text) {
    return "";
  }

  // Common signature patterns to cut off at
  const signaturePatterns = [
    /^--\s*$/m, // Standard signature delimiter
    /^_{3,}\s*$/m, // ___
    /^-{3,}\s*$/m, // ---
    /^Sent from my iPhone$/im,
    /^Sent from my iPad$/im,
    /^Sent from my Android$/im,
    /^Sent from Mail for Windows$/im,
    /^Get Outlook for iOS$/im,
    /^Get Outlook for Android$/im,
    /^Envoyé de mon iPhone$/im,
    /^Envoyé depuis mon iPhone$/im,
    /^Envoyé depuis Outlook$/im,
    /^\*\*\*\*\*DISCLAIMER\*\*\*\*\*/im,
    /^CONFIDENTIALITY NOTICE:/im,
    /^This email and any attachments/im,
    /^The information contained in this/im,
    /^Ce message.*confidentiel/im,
    /^On .+ wrote:$/im, // Reply quote marker
    /^Le .+ a écrit\s?:$/im, // French reply quote
    /^-{2,}\s*Original Message\s*-{2,}/im,
    /^-{2,}\s*Message d'origine\s*-{2,}/im,
    /^From:.*\nSent:.*\nTo:/im, // Outlook quote header
    /^De\s?:.*\nEnvoyé\s?:.*\nÀ\s?:/im, // French Outlook quote
  ];

  let cleaned = text;

  // Find the earliest signature pattern and cut there
  let earliestIndex = cleaned.length;
  for (const pattern of signaturePatterns) {
    const match = cleaned.match(pattern);
    if (match?.index !== undefined && match.index < earliestIndex) {
      earliestIndex = match.index;
    }
  }

  if (earliestIndex < cleaned.length) {
    cleaned = cleaned.slice(0, earliestIndex);
  }

  // Clean up excessive whitespace and trailing lines
  cleaned = cleaned
    .replace(/\n{3,}/g, "\n\n") // Max 2 consecutive newlines
    .replace(/\s+$/g, ""); // Trim trailing whitespace

  return cleaned;
}

/**
 * Convert plain text URLs into clickable links.
 * Handles URLs wrapped in angle brackets <url> and plain URLs.
 * Displays "Link" instead of ugly URLs.
 */
function linkifyText(text: string): string {
  // First handle URLs wrapped in angle brackets: <https://...>
  // Replace these BEFORE escaping HTML
  let processed = text.replace(
    /<(https?:\/\/[^>]+)>/gi,
    (_match, url) => `__LINK_START__${url}__LINK_END__`
  );

  // Also handle plain URLs
  processed = processed.replace(
    /(^|[\s(])((https?:\/\/)[^\s<>)\]]+)/gi,
    (_match, prefix, url) => `${prefix}__LINK_START__${url}__LINK_END__`
  );

  // Now escape HTML to prevent XSS
  const escaped = processed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  // Replace link placeholders with actual anchor tags
  return escaped.replace(/__LINK_START__(.+?)__LINK_END__/g, (_match, url) => {
    // Extract domain for display
    let displayText = "Link";
    try {
      const urlObj = new URL(url);
      displayText = urlObj.hostname.replace(/^www\./, "");
    } catch {
      displayText = "Link";
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-blue-500 hover:underline">${displayText} ↗</a>`;
  });
}

// =============================================================================
// CONVERSATION DETAIL PANEL COMPONENT
// =============================================================================

export function ConversationDetailPanel({
  conversationId,
  onClose,
  className,
}: ConversationDetailPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [newNote, setNewNote] = useState("");
  const [showComments, setShowComments] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const { data: session } = authClient.useSession();
  const organizationId = activeOrg?.id ?? "";
  const currentUserId = session?.user?.id ?? "";

  // Track viewing this conversation for real-time presence
  useTrackViewing({
    organizationId,
    resourceType: "conversation",
    resourceId: conversationId ?? "",
    enabled: Boolean(organizationId && conversationId),
  });

  // Fetch conversation details
  const { data: conversationData, isLoading: isLoadingConversation } = useQuery(
    {
      ...trpc.unifiedInbox.get.queryOptions({
        conversationId: conversationId ?? "",
      }),
      enabled: Boolean(conversationId),
    }
  );

  // Fetch messages for all source types (email, Slack, WhatsApp, etc.)
  const { data: messagesData, isLoading: isLoadingMessages } = useQuery({
    ...trpc.unifiedInbox.getMessages.queryOptions({
      conversationId: conversationId ?? "",
    }),
    enabled: Boolean(conversationId),
  });

  // Fetch related conversations (those sharing UIOs with this one)
  const { data: relatedConversationsData } = useQuery({
    ...trpc.unifiedInbox.getRelatedConversations.queryOptions({
      conversationId: conversationId ?? "",
      limit: 5,
    }),
    enabled: Boolean(conversationId),
  });

  // Star mutation
  const starMutation = useMutation(
    trpc.unifiedInbox.star.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.unifiedInbox.get.queryKey({
            conversationId: conversationId ?? "",
          }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.unifiedInbox.list.queryKey(),
        });
      },
    })
  );

  // Archive mutation
  const archiveMutation = useMutation(
    trpc.unifiedInbox.archive.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.unifiedInbox.get.queryKey({
            conversationId: conversationId ?? "",
          }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.unifiedInbox.list.queryKey(),
        });
        onClose();
      },
    })
  );

  // Mark read mutation
  const markReadMutation = useMutation(
    trpc.unifiedInbox.markRead.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.unifiedInbox.get.queryKey({
            conversationId: conversationId ?? "",
          }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.unifiedInbox.list.queryKey(),
        });
      },
    })
  );

  // Track which conversations we've already marked as read to prevent loops
  const markedAsReadRef = useRef<Set<string>>(new Set());

  // Auto-mark as read when viewing (only once per conversation)
  useEffect(() => {
    if (
      conversationId &&
      conversationData &&
      !conversationData.isRead &&
      !markedAsReadRef.current.has(conversationId)
    ) {
      markedAsReadRef.current.add(conversationId);
      markReadMutation.mutate({ conversationId, read: true });
    }
  }, [conversationId, conversationData?.isRead]);

  // Handlers
  const handleStar = useCallback(() => {
    if (conversationId) {
      starMutation.mutate({
        conversationId,
        starred: !conversationData?.isStarred,
      });
    }
  }, [conversationId, conversationData?.isStarred, starMutation]);

  const handleArchive = useCallback(() => {
    if (conversationId) {
      archiveMutation.mutate({ conversationId });
    }
  }, [conversationId, archiveMutation]);

  const handleUIOClick = useCallback(
    (uio: LinkedUIOCardData) => {
      // Build return URL to come back to this conversation
      const returnUrl = conversationId
        ? `/dashboard/inbox?id=${conversationId}`
        : "/dashboard/inbox";

      if (uio.type === "commitment") {
        navigate({
          to: "/dashboard/commitments/$commitmentId",
          params: { commitmentId: uio.id },
          search: { from: returnUrl },
        });
      } else if (uio.type === "decision") {
        navigate({
          to: "/dashboard/decisions/$decisionId",
          params: { decisionId: uio.id },
          search: { from: returnUrl },
        });
      }
    },
    [navigate, conversationId]
  );

  // Keyboard shortcut for Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Empty state
  if (!conversationId) {
    return <EmptyState className={className} />;
  }

  // Loading state
  if (isLoadingConversation) {
    return <LoadingSkeleton className={className} />;
  }

  // No data state
  if (!conversationData) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center bg-card",
          className
        )}
      >
        <p className="text-muted-foreground">Conversation not found</p>
      </div>
    );
  }

  // Transform UIOs
  const linkedUIOs: LinkedUIOCardData[] = (
    conversationData.unifiedObjects ?? []
  ).map(
    (uio: {
      id: string;
      type: string;
      title: string;
      dueDate?: Date | string | null;
      status: string;
      sourceBreadcrumbs?: Array<{
        sourceType: string;
        count: number;
        sourceName: string;
      }>;
    }) => ({
      id: uio.id,
      type: uio.type as LinkedUIOCardData["type"],
      title: uio.title,
      dueDate: uio.dueDate ? new Date(uio.dueDate) : undefined,
      status: uio.status,
      sourceBreadcrumbs: uio.sourceBreadcrumbs,
    })
  );

  // Create timeline events from messages
  const timelineEvents: TimelineEvent[] = [];

  // Add status-related events
  if (conversationData.hasOpenLoops) {
    timelineEvents.push({
      id: "pending-status",
      type: "status_change",
      icon: "pending",
      label: "Pending external",
      description:
        "Provider engaged, waiting on their investigation and timeline",
      date: new Date(conversationData.lastMessageAt ?? Date.now()),
    });
  }

  // Add message events
  if (messagesData?.messages) {
    for (const msg of messagesData.messages.slice(-5)) {
      timelineEvents.push({
        id: msg.id,
        type: "message",
        icon: "message",
        description: msg.subject ?? "Message sent",
        date: new Date(msg.date ?? Date.now()),
      });
    }
  }

  // Sort by date descending
  timelineEvents.sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div className={cn("flex h-full flex-col bg-card", className)}>
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          {/* Title with optional status tag and presence */}
          <div className="mb-6 flex items-start justify-between gap-3">
            <h1 className="font-semibold text-foreground text-xl">
              {conversationData.title || "No subject"}
            </h1>
            <div className="flex items-center gap-2">
              {/* Real-time viewers indicator */}
              {organizationId && conversationId && (
                <WhoIsViewing
                  compact
                  organizationId={organizationId}
                  resourceId={conversationId}
                  resourceType="conversation"
                />
              )}
              {conversationData.hasOpenLoops && (
                <Badge
                  className="shrink-0 bg-amber-500/10 text-[10px] text-amber-600"
                  variant="secondary"
                >
                  Pending
                </Badge>
              )}
            </div>
          </div>

          {/* Description (AI Brief) - clean text only */}
          {conversationData.brief && (
            <div className="mb-6">
              <label className="mb-2 block font-medium text-muted-foreground text-sm">
                Description
              </label>
              <div className="min-h-[80px] whitespace-pre-wrap rounded-lg border border-border bg-muted p-4 text-foreground text-sm leading-relaxed">
                {conversationData.brief}
              </div>
            </div>
          )}

          {/* Messages Section - Shows messages from this conversation only */}
          {messagesData?.messages && messagesData.messages.length > 0 ? (
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2">
                <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {conversationData.sourceType
                    ? `${conversationData.sourceType.charAt(0).toUpperCase()}${conversationData.sourceType.slice(1)} `
                    : ""}
                  Messages ({messagesData.messages.length})
                </span>
              </div>
              <div className="space-y-4">
                {messagesData.messages.map((msg) => {
                  const isFromUser = msg.isFromUser;
                  const senderName =
                    msg.from?.name ??
                    msg.from?.email?.split("@")[0] ??
                    "Unknown";
                  const senderInitial = senderName.charAt(0).toUpperCase();

                  return (
                    <div
                      className={cn(
                        "flex gap-3",
                        isFromUser && "flex-row-reverse"
                      )}
                      key={msg.id}
                    >
                      {/* Avatar */}
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-medium text-white text-xs",
                          isFromUser ? "bg-primary" : "bg-emerald-500"
                        )}
                      >
                        {senderInitial}
                      </div>

                      {/* Message bubble */}
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-4 py-2",
                          isFromUser
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        )}
                      >
                        {/* Sender name for non-user messages */}
                        {!isFromUser && (
                          <div className="mb-1 font-medium text-muted-foreground text-xs">
                            {senderName}
                          </div>
                        )}

                        {/* Subject line for emails */}
                        {msg.subject && (
                          <div className="mb-1 font-medium text-sm">
                            {msg.subject}
                          </div>
                        )}

                        {/* Message body with link parsing and signature removal */}
                        <div
                          className={cn(
                            "whitespace-pre-wrap text-sm leading-relaxed",
                            "[&_a]:text-blue-500 [&_a]:underline"
                          )}
                          // biome-ignore lint/security/noDangerouslySetInnerHtml: Links are sanitized
                          dangerouslySetInnerHTML={{
                            __html: linkifyText(
                              cleanMessageBody(msg.body || "")
                            ),
                          }}
                        />

                        {/* Timestamp */}
                        <div
                          className={cn(
                            "mt-1 text-[10px]",
                            isFromUser
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          )}
                        >
                          {format(new Date(msg.date), "MMM d, h:mm a")}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : conversationData.snippet ? (
            <div className="mb-6">
              <div
                className="whitespace-pre-wrap text-foreground text-sm leading-relaxed [&_a]:text-blue-500 [&_a]:underline"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Links are sanitized
                dangerouslySetInnerHTML={{
                  __html: linkifyText(conversationData.snippet),
                }}
              />
            </div>
          ) : null}

          {/* Timeline - Beautiful design with vertical line */}
          <div className="mt-8 border-border border-t pt-6">
            <div className="mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-foreground text-sm">
                Timeline
              </span>
            </div>

            {/* Add Note Input */}
            <div className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
              <Input
                className="flex-1 border-0 bg-transparent px-2 text-sm placeholder:text-muted-foreground focus-visible:ring-0"
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Leave a note"
                value={newNote}
              />
              <div className="flex items-center gap-1">
                <Button className="h-7 w-7" size="icon" variant="ghost">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button className="h-7 w-7" size="icon" variant="ghost">
                  <Send className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </div>

            {/* Timeline with vertical line */}
            <div className="relative ml-2">
              {/* Vertical line */}
              <div className="absolute top-0 bottom-0 left-2 w-0.5 bg-border" />

              <div className="space-y-4">
                {/* Timeline Events */}
                {timelineEvents.map((event) => (
                  <div className="relative pl-8" key={event.id}>
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        "absolute top-1 left-0 h-4 w-4 rounded-full border-2 bg-background",
                        event.icon === "pending" && "border-amber-500",
                        event.icon === "investigating" && "border-blue-500",
                        event.icon === "resolved" && "border-green-500",
                        event.icon === "message" && "border-muted-foreground"
                      )}
                    />
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          {event.label && (
                            <Badge
                              className={cn(
                                "mr-2 mb-1 text-[10px]",
                                event.icon === "pending" &&
                                  "bg-amber-500/10 text-amber-600",
                                event.icon === "investigating" &&
                                  "bg-blue-500/10 text-blue-600",
                                event.icon === "resolved" &&
                                  "bg-green-500/10 text-green-600"
                              )}
                              variant="secondary"
                            >
                              {event.label}
                            </Badge>
                          )}
                          <p
                            className="text-foreground text-sm [&_a]:text-blue-500 [&_a]:hover:underline"
                            // biome-ignore lint/security/noDangerouslySetInnerHtml: Links are sanitized
                            dangerouslySetInnerHTML={{
                              __html: linkifyText(event.description),
                            }}
                          />
                        </div>
                        <span className="shrink-0 text-muted-foreground text-xs">
                          {format(event.date, "MMM d")}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Linked UIOs in Timeline */}
                {linkedUIOs.map((uio) => (
                  <div
                    className="relative cursor-pointer pl-8 transition-colors hover:opacity-80"
                    key={uio.id}
                    onClick={() => handleUIOClick(uio)}
                  >
                    {/* Timeline dot with type color */}
                    <div
                      className={cn(
                        "absolute top-1 left-0 h-4 w-4 rounded-full border-2 bg-background",
                        uio.type === "commitment" && "border-blue-500",
                        uio.type === "decision" && "border-purple-500"
                      )}
                    />
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Badge
                          className={cn(
                            "mr-2 mb-1 text-[10px] capitalize",
                            uio.type === "commitment" &&
                              "bg-blue-500/10 text-blue-600",
                            uio.type === "decision" &&
                              "bg-purple-500/10 text-purple-600"
                          )}
                          variant="secondary"
                        >
                          {uio.type}
                        </Badge>
                        <p className="text-foreground text-sm">{uio.title}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {uio.dueDate && (
                          <span className="shrink-0 text-muted-foreground text-xs">
                            {format(uio.dueDate, "MMM d")}
                          </span>
                        )}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Related Conversations Section */}
          {relatedConversationsData?.conversations &&
            relatedConversationsData.conversations.length > 0 && (
              <div className="mt-6 border-border border-t pt-6">
                <div className="mb-4 flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-foreground text-sm">
                    Related Conversations
                  </span>
                  <Badge className="text-[10px]" variant="secondary">
                    {relatedConversationsData.conversations.length}
                  </Badge>
                </div>

                <div className="space-y-2">
                  {relatedConversationsData.conversations.map((related) => (
                    <div
                      className="cursor-pointer rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
                      key={related.conversation.id}
                      onClick={() => {
                        navigate({
                          to: "/dashboard/inbox",
                          search: { id: related.conversation.id },
                        });
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge
                              className="shrink-0 text-[10px] capitalize"
                              variant="outline"
                            >
                              {related.conversation.sourceType}
                            </Badge>
                            <span className="truncate font-medium text-sm">
                              {related.conversation.title}
                            </span>
                          </div>
                          {/* Shared UIOs summary */}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {related.sharedUIOs.map((uio) => (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded px-1.5 py-0.5 text-[10px]",
                                  uio.type === "commitment" &&
                                    "bg-blue-500/10 text-blue-600",
                                  uio.type === "decision" &&
                                    "bg-purple-500/10 text-purple-600",
                                  uio.type === "topic" &&
                                    "bg-cyan-500/10 text-cyan-600"
                                )}
                                key={uio.type}
                              >
                                {uio.count} {uio.type}
                                {uio.count > 1 ? "s" : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Team Discussion / Comments Section */}
          <div className="mt-6 border-border border-t pt-6">
            <button
              className="mb-4 flex w-full items-center justify-between gap-2"
              onClick={() => setShowComments(!showComments)}
              type="button"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-foreground text-sm">
                  Team Discussion
                </span>
              </div>
              <Badge className="text-[10px]" variant="secondary">
                {showComments ? "Hide" : "Show"}
              </Badge>
            </button>

            {showComments &&
              organizationId &&
              conversationId &&
              currentUserId && (
                <CommentThread
                  currentUserId={currentUserId}
                  organizationId={organizationId}
                  targetId={conversationId}
                  targetType="conversation"
                />
              )}
          </div>
        </div>
      </div>

      {/* Bottom Actions Bar */}
      <div className="shrink-0 border-border border-t bg-card px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className={cn(
                      "h-8 w-8",
                      conversationData.isStarred && "text-yellow-500"
                    )}
                    onClick={handleStar}
                    size="icon"
                    variant="ghost"
                  >
                    {conversationData.isStarred ? (
                      <Star className="h-4 w-4 fill-current" />
                    ) : (
                      <StarOff className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {conversationData.isStarred ? "Unstar" : "Star"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8"
                    onClick={handleArchive}
                    size="icon"
                    variant="ghost"
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Archive</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Comments toggle button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8"
                    onClick={() => setShowComments(!showComments)}
                    size="icon"
                    variant="ghost"
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Team Discussion</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <kbd className="rounded bg-muted px-1.5 py-0.5">Esc</kbd>
            <span>to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

function EmptyState({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center bg-card px-6 text-center",
        className
      )}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Inbox className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="font-medium text-lg">Select a conversation</h3>
      <p className="mt-1 max-w-sm text-muted-foreground text-sm">
        Choose a conversation from the list to view messages, linked
        commitments, decisions, and more.
      </p>
      <div className="mt-4 text-muted-foreground text-xs">
        <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          J
        </kbd>
        {" / "}
        <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          K
        </kbd>
        {" to navigate"}
      </div>
    </div>
  );
}

// =============================================================================
// LOADING SKELETON
// =============================================================================

function LoadingSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full flex-col bg-card", className)}>
      <div className="flex-1 p-6">
        {/* Status icon */}
        <Skeleton className="mb-4 h-10 w-10 rounded-lg" />
        {/* Title */}
        <Skeleton className="mb-6 h-7 w-3/4" />
        {/* Description label */}
        <Skeleton className="mb-2 h-4 w-20" />
        {/* Description */}
        <Skeleton className="mb-6 h-16 w-full" />
        {/* Email fields */}
        <div className="mb-6 space-y-3 border-y py-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-5 w-40" />
        </div>
        {/* Body */}
        <Skeleton className="mb-6 h-32 w-full" />
        {/* Timeline */}
        <Skeleton className="mb-4 h-4 w-16" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
