"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowUpRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Forward,
  HelpCircle,
  Lightbulb,
  Loader2,
  Mail,
  Reply,
  Star,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useCommandBar } from "@/components/email/command-bar";
import {
  ConversationView,
  type MessageData,
} from "@/components/email/conversation-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

interface EmailPreviewPaneProps {
  /** The ID of the selected thread to preview */
  threadId: string | null;
  /** Callback when the pane should close (deselect thread) */
  onClose?: () => void;
  /** Callback to expand into full view */
  onExpand?: (threadId: string) => void;
  /** Additional class name */
  className?: string;
}

export function EmailPreviewPane({
  threadId,
  onClose,
  onExpand,
  className,
}: EmailPreviewPaneProps) {
  const queryClient = useQueryClient();
  const { openReply, openForward } = useCommandBar();
  const [showFullIntelligence, setShowFullIntelligence] = useState(false);

  // Fetch thread details
  const { data: threadData, isLoading: isLoadingThread } = useQuery({
    ...trpc.threads.getById.queryOptions({ threadId: threadId ?? "" }),
    enabled: !!threadId,
  });

  // Fetch messages
  const { data: messagesData, isLoading: isLoadingMessages } = useQuery({
    ...trpc.threads.getMessages.queryOptions({ threadId: threadId ?? "" }),
    enabled: !!threadId,
  });

  // Fetch intelligence
  const { data: intelligenceData, isLoading: isLoadingIntelligence } = useQuery({
    ...trpc.threads.getIntelligence.queryOptions({ threadId: threadId ?? "" }),
    enabled: !!threadId,
    staleTime: 60_000,
  });

  // Mark as read on view
  const markReadMutation = useMutation({
    ...trpc.threads.markRead.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["unifiedInbox"] });
    },
  });

  // Mark as read when thread changes
  useEffect(() => {
    if (threadId && threadData?.thread && !threadData.thread.isRead) {
      markReadMutation.mutate({ threadId, read: true });
    }
  }, [threadId, threadData?.thread?.isRead]);

  // Mutations
  const archiveMutation = useMutation({
    ...trpc.threads.archive.mutationOptions(),
    onSuccess: () => {
      toast.success("Thread archived");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["unifiedInbox"] });
      onClose?.();
    },
  });

  const starMutation = useMutation({
    ...trpc.threads.star.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const deleteMutation = useMutation({
    ...trpc.threads.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Thread deleted");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      queryClient.invalidateQueries({ queryKey: ["unifiedInbox"] });
      onClose?.();
    },
  });

  // Handlers
  const handleArchive = useCallback(() => {
    if (threadId) {
      archiveMutation.mutate({ threadId });
    }
  }, [archiveMutation, threadId]);

  const handleStar = useCallback(() => {
    if (threadId) {
      const currentStarred = threadData?.thread?.isStarred ?? false;
      starMutation.mutate({ threadId, starred: !currentStarred });
    }
  }, [starMutation, threadId, threadData?.thread?.isStarred]);

  const handleDelete = useCallback(() => {
    if (threadId) {
      deleteMutation.mutate({ threadId });
    }
  }, [deleteMutation, threadId]);

  const handleReply = useCallback(() => {
    if (threadId) {
      openReply(threadId);
    }
  }, [openReply, threadId]);

  const handleForward = useCallback(() => {
    if (!threadId) return;

    const messageList = messagesData?.messages ?? [];
    const lastMessage = messageList[messageList.length - 1];
    if (!lastMessage) {
      toast.error("No message to forward");
      return;
    }

    const originalSubject = threadData?.thread?.subject ?? "";
    const forwardSubject =
      originalSubject.startsWith("Fwd:") || originalSubject.startsWith("FW:")
        ? originalSubject
        : `Fwd: ${originalSubject}`;

    const fromName = lastMessage.from?.name ?? "";
    const fromEmail = lastMessage.from?.email ?? "";
    const originalFrom = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    const originalTo = (lastMessage.to ?? [])
      .map((r: { email: string; name?: string }) =>
        r.name ? `${r.name} <${r.email}>` : r.email
      )
      .join(", ");
    const originalDate = format(
      new Date(lastMessage.date),
      "EEE, MMM d, yyyy 'at' h:mm a"
    );
    const messageBody = lastMessage.body ?? "";

    const forwardBody = `

---------- Forwarded message ---------
From: ${originalFrom}
Date: ${originalDate}
Subject: ${originalSubject}
To: ${originalTo}

${messageBody}`;

    openForward({
      subject: forwardSubject,
      body: forwardBody,
      originalFrom,
      originalDate,
      originalTo,
    });
  }, [messagesData?.messages, threadData?.thread?.subject, openForward, threadId]);

  // Transform messages data
  const messages: MessageData[] = (messagesData?.messages ?? []).map((m) => ({
    id: m.id,
    threadId: m.threadId,
    subject: m.subject ?? "",
    from: m.from ?? { email: "", name: "" },
    to: (m.to ?? []).map((t) => ({ email: t.email, name: t.name ?? "" })),
    cc: m.cc?.map((c) => ({ email: c.email, name: c.name ?? "" })),
    date: new Date(m.date),
    body: m.body ?? "",
    bodyHtml: m.bodyHtml ?? undefined,
    snippet: m.snippet ?? "",
    isUnread: m.isUnread ?? false,
    attachments: m.attachments,
  }));

  // Extract intelligence data
  const commitments = intelligenceData?.commitments ?? [];
  const decisions = intelligenceData?.decisions ?? [];
  const openQuestions = intelligenceData?.openQuestions ?? [];
  const riskWarnings: Array<{
    id: string;
    title: string;
    description: string;
    recommendation?: string;
  }> = [];

  const hasIntelligence =
    commitments.length > 0 ||
    decisions.length > 0 ||
    openQuestions.length > 0 ||
    riskWarnings.length > 0;

  const brief = threadData?.thread?.brief;
  const suggestedAction = (threadData?.thread as { suggestedAction?: string })
    ?.suggestedAction;
  const priority = threadData?.thread?.priorityTier;

  // Get current user email from messages
  const currentUserEmail = messages[0]?.from?.email ?? "";

  // Empty state when no thread is selected
  if (!threadId) {
    return (
      <div
        className={cn(
          "flex h-full flex-col items-center justify-center bg-muted/30",
          className
        )}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Mail className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 font-medium text-lg">Select an email</h3>
        <p className="mt-1 text-center text-muted-foreground text-sm">
          Choose an email from the list to preview it here
        </p>
      </div>
    );
  }

  // Loading state
  if (isLoadingThread) {
    return (
      <div className={cn("flex h-full flex-col bg-background", className)}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <Skeleton className="h-5 w-48" />
          <div className="flex gap-1">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        </div>
        <div className="flex-1 p-4">
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col bg-background", className)}>
      {/* Header */}
      <div className="shrink-0 border-b bg-background">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="truncate font-medium text-sm">
              {threadData?.thread?.subject ?? "No subject"}
            </h2>
            <p className="mt-0.5 text-muted-foreground text-xs">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
              {messages.length > 0 && messages[messages.length - 1]?.date && (
                <>
                  {" "}
                  &middot; Last reply{" "}
                  {formatDistanceToNow(messages[messages.length - 1].date, {
                    addSuffix: true,
                  })}
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8"
                    onClick={handleReply}
                    size="icon"
                    variant="ghost"
                  >
                    <Reply className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reply (r)</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8"
                    onClick={handleForward}
                    size="icon"
                    variant="ghost"
                  >
                    <Forward className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Forward (f)</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="mx-1 h-5 w-px bg-border" />

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8"
                    onClick={handleStar}
                    size="icon"
                    variant="ghost"
                  >
                    <Star
                      className={cn(
                        "h-4 w-4",
                        threadData?.thread?.isStarred &&
                          "fill-amber-400 text-amber-400"
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Star (s)</TooltipContent>
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
                <TooltipContent>Archive (e)</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="h-8 w-8"
                    onClick={handleDelete}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete (#)</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="mx-1 h-5 w-px bg-border" />

            {onExpand && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="h-8 w-8"
                      onClick={() => onExpand(threadId)}
                      size="icon"
                      variant="ghost"
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open full view</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {onClose && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="h-8 w-8"
                      onClick={onClose}
                      size="icon"
                      variant="ghost"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Close (Esc)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </div>

      {/* Intelligence Panel - Compact */}
      <div className="shrink-0 border-b bg-gradient-to-r from-slate-50 via-blue-50/30 to-purple-50/30 dark:from-slate-900 dark:via-blue-950/20 dark:to-purple-950/20">
        <div className="px-4 py-2">
          {/* Brief Summary - Compact */}
          {brief ? (
            <div className="flex items-start gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-purple-600">
                <Brain className="h-3 w-3 text-white" />
              </div>
              <p className="line-clamp-2 flex-1 text-foreground text-xs leading-relaxed">
                {brief}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              {isLoadingIntelligence ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Brain className="h-3 w-3" />
                  <span>No AI summary available</span>
                </>
              )}
            </div>
          )}

          {/* Intelligence Badges - Ultra Compact */}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {commitments.length > 0 && (
              <Badge
                className="h-5 gap-1 px-1.5 text-[10px]"
                variant="secondary"
              >
                <CheckCircle2 className="h-3 w-3 text-blue-500" />
                {commitments.length}
              </Badge>
            )}
            {decisions.length > 0 && (
              <Badge
                className="h-5 gap-1 px-1.5 text-[10px]"
                variant="secondary"
              >
                <Lightbulb className="h-3 w-3 text-purple-500" />
                {decisions.length}
              </Badge>
            )}
            {openQuestions.length > 0 && (
              <Badge
                className="h-5 gap-1 px-1.5 text-[10px]"
                variant="secondary"
              >
                <HelpCircle className="h-3 w-3 text-amber-500" />
                {openQuestions.length}
              </Badge>
            )}
            {suggestedAction && (
              <Badge
                className="h-5 gap-1 border-0 bg-blue-500/10 px-1.5 text-[10px] text-blue-600"
                variant="secondary"
              >
                <Zap className="h-3 w-3" />
                {formatAction(suggestedAction)}
              </Badge>
            )}
            {priority && priority !== "medium" && (
              <Badge
                className={cn(
                  "h-5 px-1.5 text-[10px]",
                  priority === "urgent" &&
                    "border-red-500 bg-red-500/10 text-red-500",
                  priority === "high" &&
                    "border-orange-500 bg-orange-500/10 text-orange-500",
                  priority === "low" && "text-muted-foreground"
                )}
                variant="outline"
              >
                {priority.toUpperCase()}
              </Badge>
            )}

            {hasIntelligence && (
              <Button
                className="ml-auto h-5 px-2 text-[10px] text-muted-foreground"
                onClick={() => setShowFullIntelligence(!showFullIntelligence)}
                size="sm"
                variant="ghost"
              >
                {showFullIntelligence ? (
                  <>
                    Less
                    <ChevronUp className="ml-0.5 h-3 w-3" />
                  </>
                ) : (
                  <>
                    More
                    <ChevronDown className="ml-0.5 h-3 w-3" />
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Expanded Intelligence */}
          <AnimatePresence>
            {showFullIntelligence && hasIntelligence && (
              <motion.div
                animate={{ height: "auto", opacity: 1 }}
                className="overflow-hidden"
                exit={{ height: 0, opacity: 0 }}
                initial={{ height: 0, opacity: 0 }}
              >
                <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                  {commitments.map((c) => {
                    const debtorName =
                      typeof c.debtor === "object" && c.debtor
                        ? c.debtor.name || c.debtor.email || "Unknown"
                        : "Unknown";
                    return (
                      <div
                        className="rounded border border-blue-500/20 bg-blue-500/5 p-2"
                        key={c.id}
                      >
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-blue-500" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-xs">{c.title}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {debtorName}
                              {c.dueDate &&
                                ` · Due ${formatDistanceToNow(new Date(c.dueDate), { addSuffix: true })}`}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {decisions.map((d) => {
                    const makerName =
                      typeof d.maker === "object" && d.maker
                        ? d.maker.name || d.maker.email || "Unknown"
                        : d.maker || "Unknown";
                    return (
                      <div
                        className="rounded border border-purple-500/20 bg-purple-500/5 p-2"
                        key={d.id}
                      >
                        <div className="flex items-start gap-2">
                          <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-purple-500" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-xs">{d.title}</p>
                            <p className="text-[10px] text-muted-foreground">
                              By {makerName} ·{" "}
                              {format(new Date(d.date), "MMM d")}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {openQuestions.map((q) => (
                    <div
                      className="rounded border border-amber-500/20 bg-amber-500/5 p-2"
                      key={q.id}
                    >
                      <div className="flex items-start gap-2">
                        <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                        <p className="min-w-0 flex-1 font-medium text-xs">
                          {q.question}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Messages Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <ConversationView
          className="h-full"
          currentUserEmail={currentUserEmail}
          isLoading={isLoadingMessages}
          messages={messages}
          showIntelligenceButton={false}
          threadSubject={threadData?.thread?.subject ?? ""}
        />
      </div>
    </div>
  );
}

// Helper function
function formatAction(action: string): string {
  const actions: Record<string, string> = {
    respond: "Respond",
    follow_up: "Follow Up",
    review: "Review",
    archive: "Archive",
    delegate: "Delegate",
    schedule: "Schedule",
  };
  return (
    actions[action] ||
    action.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
  );
}
