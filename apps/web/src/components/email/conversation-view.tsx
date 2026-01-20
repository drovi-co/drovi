"use client";

import { format, isToday, isYesterday } from "date-fns";
import { motion } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileImage,
  FileText,
  Forward,
  Paperclip,
  Reply,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface MessageData {
  id: string;
  threadId: string;
  subject: string;
  from: {
    email: string;
    name: string;
    avatarUrl?: string;
  };
  to: Array<{
    email: string;
    name: string;
  }>;
  cc?: Array<{
    email: string;
    name: string;
  }>;
  date: Date;
  body: string;
  bodyHtml?: string;
  snippet: string;
  isUnread: boolean;
  attachments?: AttachmentData[];
  labels?: string[];
}

export interface AttachmentData {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadUrl?: string;
}

interface ConversationViewProps {
  messages: MessageData[];
  threadSubject: string;
  currentUserEmail?: string;
  isLoading?: boolean;
  onBack?: () => void;
  onReply?: (messageId: string) => void;
  onReplyAll?: (messageId: string) => void;
  onForward?: (messageId: string) => void;
  onArchive?: () => void;
  onDelete?: () => void;
  onStar?: () => void;
  onToggleIntelligence?: () => void;
  isStarred?: boolean;
  showIntelligenceButton?: boolean;
  highlightMessageId?: string;
  className?: string;
}

// =============================================================================
// CONVERSATION VIEW - WhatsApp Style
// =============================================================================

export function ConversationView({
  messages,
  threadSubject,
  currentUserEmail = "",
  isLoading = false,
  onBack,
  onReply,
  onReplyAll,
  onForward,
  onArchive,
  onDelete,
  onStar,
  onToggleIntelligence,
  isStarred = false,
  showIntelligenceButton = true,
  highlightMessageId,
  className,
}: ConversationViewProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(() => {
    // Expand all messages by default for chat view
    return new Set(messages.map((m) => m.id));
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Update expanded messages when messages change
  useEffect(() => {
    setExpandedMessages(new Set(messages.map((m) => m.id)));
  }, [messages]);

  const toggleMessage = (id: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (isLoading) {
    return <ConversationSkeleton />;
  }

  // Group messages by date
  const groupedMessages = groupMessagesByDate(messages);

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden bg-muted/30",
        className
      )}
    >
      {/* Messages - Chat style with proper scrolling */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-4">
          {Object.entries(groupedMessages).map(([dateKey, dateMessages]) => (
            <div key={dateKey}>
              {/* Date separator */}
              <div className="my-4 flex items-center justify-center">
                <span className="rounded-full bg-background/80 px-3 py-1 text-muted-foreground text-xs">
                  {dateKey}
                </span>
              </div>

              {/* Messages for this date */}
              <div className="space-y-3">
                {dateMessages.map((message, index) => {
                  const isFromUser =
                    message.from.email.toLowerCase() ===
                    currentUserEmail.toLowerCase();
                  const showAvatar =
                    index === 0 ||
                    dateMessages[index - 1]?.from.email !== message.from.email;

                  return (
                    <MessageBubble
                      isExpanded={expandedMessages.has(message.id)}
                      isFromUser={isFromUser}
                      isHighlighted={message.id === highlightMessageId}
                      key={message.id}
                      message={message}
                      onForward={() => onForward?.(message.id)}
                      onReply={() => onReply?.(message.id)}
                      onReplyAll={() => onReplyAll?.(message.id)}
                      onToggle={() => toggleMessage(message.id)}
                      showAvatar={showAvatar}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MESSAGE BODY CONTENT - Handles HTML, plain text, and fallbacks
// =============================================================================

function MessageBodyContent({
  message,
  isFromUser,
}: {
  message: MessageData;
  isFromUser: boolean;
}) {
  // Check if this is a notification/marketing email (usually HTML-heavy)
  const isNotificationEmail = isServiceEmail(message.from.email);

  // Try to render HTML content
  if (message.bodyHtml) {
    // For notification emails, render HTML directly with minimal sanitization
    // These emails are often image/table heavy and need full rendering
    if (isNotificationEmail) {
      return (
        <div
          className={cn(
            "email-content overflow-hidden",
            "[&_table]:w-full [&_table]:max-w-full",
            "[&_img]:inline-block [&_img]:h-auto [&_img]:max-w-full",
            "[&_td]:p-1 [&_td]:align-top",
            "[&_a]:text-primary [&_a]:underline",
            "[&_*]:max-w-full",
            isFromUser ? "text-primary-foreground" : "text-foreground"
          )}
          dangerouslySetInnerHTML={{
            __html: sanitizeNotificationHtml(message.bodyHtml),
          }}
        />
      );
    }

    // For regular emails, use more aggressive sanitization
    const sanitized = sanitizeHtml(message.bodyHtml);
    const textContent = sanitized
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (textContent.length > 10) {
      return (
        <div
          className={cn(
            "prose prose-sm [&_*]:!m-0 [&_p]:!my-1 max-w-none [&_img]:h-auto [&_img]:max-w-full",
            isFromUser
              ? "prose-invert prose-a:text-primary-foreground/90 prose-headings:text-primary-foreground prose-p:text-primary-foreground prose-strong:text-primary-foreground"
              : "dark:prose-invert prose-headings:text-foreground prose-p:text-foreground"
          )}
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      );
    }

    // HTML is mostly empty after sanitization, show extracted text or fallback
    if (message.snippet || message.body) {
      return (
        <p
          className={cn(
            "whitespace-pre-wrap text-sm",
            isFromUser ? "text-primary-foreground" : "text-foreground"
          )}
        >
          {message.body || message.snippet}
        </p>
      );
    }

    // Last resort: render HTML directly
    return (
      <div
        className={cn(
          "email-content overflow-hidden [&_img]:h-auto [&_img]:max-w-full",
          isFromUser ? "text-primary-foreground" : "text-foreground"
        )}
        dangerouslySetInnerHTML={{
          __html: sanitizeNotificationHtml(message.bodyHtml),
        }}
      />
    );
  }

  // Plain text content
  const cleanBody = cleanPlainTextBody(message.body);
  if (cleanBody) {
    return (
      <p
        className={cn(
          "whitespace-pre-wrap text-sm",
          isFromUser ? "text-primary-foreground" : "text-foreground"
        )}
      >
        {cleanBody}
      </p>
    );
  }

  // Fallback to snippet
  if (message.snippet) {
    return (
      <p
        className={cn(
          "text-sm italic",
          isFromUser ? "text-primary-foreground/70" : "text-muted-foreground"
        )}
      >
        {message.snippet}
      </p>
    );
  }

  // No content available
  return (
    <p
      className={cn(
        "text-sm italic",
        isFromUser ? "text-primary-foreground/70" : "text-muted-foreground"
      )}
    >
      (No message content)
    </p>
  );
}

/**
 * Check if email is from a known service/notification sender
 */
function isServiceEmail(email: string): boolean {
  const serviceDomains = [
    "linkedin.com",
    "facebookmail.com",
    "twitter.com",
    "x.com",
    "github.com",
    "slack.com",
    "notion.so",
    "figma.com",
    "stripe.com",
    "vercel.com",
    "netlify.com",
    "heroku.com",
    "aws.amazon.com",
    "amazonses.com",
    "google.com",
    "apple.com",
    "microsoft.com",
    "dropbox.com",
    "mailchimp.com",
    "sendgrid.net",
    "mailgun.org",
    "postmarkapp.com",
  ];

  const servicePatterns = [
    "noreply",
    "no-reply",
    "notification",
    "newsletter",
    "digest",
    "alerts",
    "updates",
    "mailer",
    "marketing",
    "info@",
    "hello@",
    "team@",
    "support@",
  ];

  const emailLower = email.toLowerCase();
  const domain = emailLower.split("@")[1] ?? "";

  // Check domain
  if (serviceDomains.some((d) => domain.includes(d))) {
    return true;
  }

  // Check patterns in local part
  if (servicePatterns.some((p) => emailLower.includes(p))) {
    return true;
  }

  return false;
}

/**
 * Light sanitization for notification emails - just remove dangerous content
 */
function sanitizeNotificationHtml(html: string): string {
  return (
    html
      // Remove script tags
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      // Remove event handlers
      .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "")
      // Remove style tags (often break dark mode)
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      // Fix colors for dark mode
      .replace(/color:\s*#000000/gi, "color: inherit")
      .replace(/color:\s*black/gi, "color: inherit")
      .replace(/color:\s*rgb\(0,\s*0,\s*0\)/gi, "color: inherit")
      .replace(
        /background(-color)?:\s*#fff(fff)?/gi,
        "background-color: transparent"
      )
      .replace(
        /background(-color)?:\s*white/gi,
        "background-color: transparent"
      )
      .replace(
        /background(-color)?:\s*rgb\(255,\s*255,\s*255\)/gi,
        "background-color: transparent"
      )
  );
}

// =============================================================================
// MESSAGE BUBBLE - WhatsApp Style
// =============================================================================

function MessageBubble({
  message,
  isFromUser,
  showAvatar,
  isExpanded,
  onToggle,
  onReply,
  onReplyAll,
  onForward,
  isHighlighted,
}: {
  message: MessageData;
  isFromUser: boolean;
  showAvatar: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  isHighlighted: boolean;
}) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex gap-2", isFromUser ? "flex-row-reverse" : "flex-row")}
      initial={{ opacity: 0, y: 10 }}
    >
      {/* Avatar */}
      <div className={cn("shrink-0", showAvatar ? "visible" : "invisible")}>
        <Avatar className="h-8 w-8">
          <AvatarImage src={message.from.avatarUrl} />
          <AvatarFallback className="bg-primary/10 text-primary text-xs">
            {message.from.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* Message bubble */}
      <div
        className={cn(
          "w-[85%] overflow-hidden rounded-2xl",
          isFromUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm border bg-background",
          isHighlighted && "ring-2 ring-amber-400"
        )}
      >
        {/* Sender info (only for received messages) */}
        {!isFromUser && showAvatar && (
          <div className="px-3 pt-2 pb-1">
            <span className="font-medium text-primary text-xs">
              {message.from.name}
            </span>
          </div>
        )}

        {/* Collapsible content */}
        <Collapsible onOpenChange={onToggle} open={isExpanded}>
          <CollapsibleTrigger asChild>
            <button
              className={cn(
                "w-full px-3 py-2 text-left transition-opacity hover:opacity-90",
                !isExpanded && "cursor-pointer"
              )}
              type="button"
            >
              {isExpanded ? (
                <div className="flex items-start justify-between gap-2">
                  <ChevronRight
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0 rotate-90",
                      isFromUser
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p
                    className={cn(
                      "line-clamp-2 text-sm",
                      isFromUser ? "text-primary-foreground" : "text-foreground"
                    )}
                  >
                    {message.snippet || message.body.slice(0, 150)}
                  </p>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isFromUser
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  />
                </div>
              )}
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            {/* Full message body */}
            <div className="px-3 pb-2">
              <MessageBodyContent isFromUser={isFromUser} message={message} />
            </div>

            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div
                className={cn(
                  "space-y-1 px-3 pb-2",
                  isFromUser
                    ? "border-primary-foreground/20 border-t"
                    : "border-t"
                )}
              >
                <div className="flex items-center gap-1 pt-2">
                  <Paperclip
                    className={cn(
                      "h-3 w-3",
                      isFromUser
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs",
                      isFromUser
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  >
                    {message.attachments.length} attachment
                    {message.attachments.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {message.attachments.map((attachment) => (
                  <AttachmentChip
                    attachment={attachment}
                    isFromUser={isFromUser}
                    key={attachment.id}
                  />
                ))}
              </div>
            )}

            {/* Quick actions */}
            <div
              className={cn(
                "flex items-center gap-1 px-2 py-1.5",
                isFromUser
                  ? "border-primary-foreground/20 border-t"
                  : "border-t"
              )}
            >
              <Button
                className={cn(
                  "h-7 text-xs",
                  isFromUser
                    ? "text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                    : ""
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onReply();
                }}
                size="sm"
                variant="ghost"
              >
                <Reply className="mr-1 h-3 w-3" />
                Reply
              </Button>
              <Button
                className={cn(
                  "h-7 text-xs",
                  isFromUser
                    ? "text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                    : ""
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onForward();
                }}
                size="sm"
                variant="ghost"
              >
                <Forward className="mr-1 h-3 w-3" />
                Forward
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Timestamp */}
        <div
          className={cn(
            "flex items-center justify-end gap-1 px-3 pb-2",
            isFromUser ? "text-primary-foreground/60" : "text-muted-foreground"
          )}
        >
          <span className="text-[10px]">{format(message.date, "h:mm a")}</span>
          {message.isUnread && (
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          )}
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// ATTACHMENT CHIP
// =============================================================================

function AttachmentChip({
  attachment,
  isFromUser,
}: {
  attachment: AttachmentData;
  isFromUser: boolean;
}) {
  const getIcon = () => {
    if (attachment.mimeType.startsWith("image/")) {
      return <FileImage className="h-3 w-3" />;
    }
    if (attachment.mimeType === "application/pdf") {
      return <FileText className="h-3 w-3" />;
    }
    return <File className="h-3 w-3" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <a
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors",
        isFromUser
          ? "bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20"
          : "bg-muted hover:bg-muted/80"
      )}
      download={attachment.filename}
      href={attachment.downloadUrl}
      onClick={(e) => e.stopPropagation()}
    >
      {getIcon()}
      <span className="max-w-[150px] truncate">{attachment.filename}</span>
      <span className="text-[10px] opacity-70">
        {formatSize(attachment.size)}
      </span>
      <Download className="h-3 w-3 opacity-70" />
    </a>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function groupMessagesByDate(
  messages: MessageData[]
): Record<string, MessageData[]> {
  const groups: Record<string, MessageData[]> = {};

  for (const message of messages) {
    const date = message.date;
    let key: string;

    if (isToday(date)) {
      key = "Today";
    } else if (isYesterday(date)) {
      key = "Yesterday";
    } else {
      key = format(date, "MMMM d, yyyy");
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(message);
  }

  return groups;
}

/**
 * Strip quoted replies and signatures from email content.
 * Returns only the actual new message content.
 */
function stripQuotedContent(text: string): string {
  // Common patterns for quoted content start
  const quotePatterns = [
    // "On Mon, Jan 05, 2026 at 11:15 AM, Name <email> wrote:"
    /^On\s+\w+,\s+\w+\s+\d+,\s+\d+\s+at\s+\d+:\d+\s*[AP]M,?\s+.*?wrote:\s*$/im,
    // "On 05/01/2026 11:15, Name wrote:"
    /^On\s+\d+\/\d+\/\d+\s+\d+:\d+,?\s+.*?wrote:\s*$/im,
    // "Le 05/01/2026 à 11:15, Name a écrit :"
    /^Le\s+\d+\/\d+\/\d+\s+à\s+\d+:\d+,?\s+.*?a\s+écrit\s*:\s*$/im,
    // Outlook-style English: "From: Name <email>" followed by To/Date/Subject
    /^\s*From\s*:\s+.+[\r\n]+/im,
    // Outlook-style French: "De : Name <email>" followed by À/Date/Objet
    /^\s*De\s*:\s+.+[\r\n]+/im,
    // "From :" with space before colon (Outlook French locale)
    /^\s*From\s*:\s+[^\r\n]+<[^>]+>[\r\n]/im,
    // Gmail quote marker
    /^>+\s*/m,
    // "-----Original Message-----"
    /^-{3,}\s*Original Message\s*-{3,}$/im,
    // "________________________________"
    /^_{10,}$/m,
    // Date line in Outlook format: "Date : Monday, 5 January 2026 at 15:15"
    /^Date\s*:\s+\w+,?\s+\d+\s+\w+\s+\d+/im,
  ];

  // Common signature patterns
  const signaturePatterns = [
    // "-- " (standard signature delimiter)
    /^--\s*$/m,
    // "Cordialement," or "Best regards," etc.
    /^(Cordialement|Best regards?|Regards|Thanks|Merci|Sincerely|Cheers|Cdlt),?\s*$/im,
    // Email signature blocks with contact info
    /^(📧|📲|📞|Tel:|Phone:|Email:|Mobile:)\s*/im,
    // "CONFIDENTIEL" disclaimers
    /^CONFIDENTIEL\s*$/im,
    // Long dashes often precede signatures
    /^-{5,}$/m,
  ];

  let cleanText = text;

  // Find the earliest quote or signature marker and cut there
  let cutIndex = cleanText.length;

  for (const pattern of [...quotePatterns, ...signaturePatterns]) {
    const match = cleanText.match(pattern);
    if (match?.index !== undefined && match.index < cutIndex) {
      cutIndex = match.index;
    }
  }

  // Cut the content
  cleanText = cleanText.slice(0, cutIndex).trim();

  return cleanText || text; // Return original if stripping removes everything
}

/**
 * Strip quoted content from HTML emails.
 */
function stripQuotedHtml(html: string): string {
  // Remove Gmail quote blocks
  const clean = html
    // Gmail blockquote with gmail_quote class
    .replace(/<div\s+class="gmail_quote"[\s\S]*$/i, "")
    // Generic blockquotes that contain quotes
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    // Outlook quote blocks
    .replace(/<div\s+id="appendonsend"[\s\S]*$/i, "")
    .replace(
      /<div\s+style="border:none;border-top:solid #[A-Fa-f0-9]+ 1\.0pt[\s\S]*$/i,
      ""
    )
    // Outlook-style "From: ..." or "From :" blocks (with optional space before colon)
    .replace(/<div[^>]*>\s*From\s*:\s+[\s\S]*$/i, "")
    .replace(/<p[^>]*>\s*From\s*:\s+[\s\S]*$/i, "")
    .replace(/<span[^>]*>\s*From\s*:\s+[\s\S]*$/i, "")
    // French Outlook "De :" format
    .replace(/<div[^>]*>\s*De\s*:\s+[\s\S]*$/i, "")
    .replace(/<p[^>]*>\s*De\s*:\s+[\s\S]*$/i, "")
    // Bold "From" in Outlook: <b>From:</b>
    .replace(/<b>\s*From\s*:\s*<\/b>[\s\S]*$/i, "")
    .replace(/<b>\s*De\s*:\s*<\/b>[\s\S]*$/i, "")
    // "On ... wrote:" patterns in divs
    .replace(
      /<div[^>]*>On\s+\w+,\s+\w+\s+\d+,\s+\d+\s+at\s+\d+:\d+\s*[AP]M[\s\S]*$/i,
      ""
    )
    // French "Le ... a écrit" patterns
    .replace(/<div[^>]*>Le\s+\d+[\s\S]*?a\s+écrit[\s\S]*$/i, "")
    // Remove "Cdlt" and everything after in signatures
    .replace(/<[^>]*>Cdlt<\/[^>]*>[\s\S]*$/i, "")
    .replace(/<[^>]*>Cordialement<\/[^>]*>[\s\S]*$/i, "")
    // Plain text "From :" in HTML (no tags wrapping it)
    .replace(/From\s*:\s+[^<\n]+<[^>]+>[\s\S]*$/i, "")
    .replace(/De\s*:\s+[^<\n]+<[^>]+>[\s\S]*$/i, "")
    // Remove trailing <br> tags
    .replace(/(<br\s*\/?>\s*)+$/gi, "");

  return clean;
}

function sanitizeHtml(html: string): string {
  // First strip quoted content
  let clean = stripQuotedHtml(html);

  // Basic sanitization - in production, use DOMPurify
  // Remove script tags and event handlers
  clean = clean
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/gi, "")
    .replace(/on\w+='[^']*'/gi, "")
    // Fix common email styling issues
    .replace(/color:\s*#000000/gi, "color: inherit")
    .replace(/color:\s*black/gi, "color: inherit")
    .replace(/background-color:\s*#ffffff/gi, "")
    .replace(/background-color:\s*white/gi, "");

  return clean;
}

/**
 * Clean plain text email body.
 */
function cleanPlainTextBody(body: string): string {
  return stripQuotedContent(body);
}

// =============================================================================
// SKELETON
// =============================================================================

function ConversationSkeleton() {
  return (
    <div className="flex h-full flex-col bg-muted/30">
      <div className="border-b bg-background p-4">
        <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4">
        {[1, 2, 3].map((i) => (
          <div
            className={cn("flex gap-2", i % 2 === 0 ? "flex-row-reverse" : "")}
            key={i}
          >
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <div
              className={cn(
                "max-w-[70%] rounded-2xl p-4",
                i % 2 === 0 ? "bg-primary/20" : "border bg-background"
              )}
            >
              <div className="mb-2 h-4 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
