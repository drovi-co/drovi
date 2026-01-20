"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { format, formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Forward,
  HelpCircle,
  Lightbulb,
  Loader2,
  Reply,
  Star,
  Trash2,
  Users,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { queryClient, trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/email/thread/$threadId")({
  component: ThreadDetailPage,
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function ThreadDetailPage() {
  const navigate = useNavigate();
  const { threadId } = useParams({ from: "/dashboard/email/thread/$threadId" });
  const {
    open: commandBarOpen,
    setOpen: setCommandBarOpen,
    openReply,
    openForward,
  } = useCommandBar();
  const [showFullIntelligence, setShowFullIntelligence] = useState(false);

  // Fetch thread details
  const { data: threadData, isLoading: isLoadingThread } = useQuery({
    ...trpc.threads.getById.queryOptions({ threadId }),
    enabled: !!threadId,
  });

  // Fetch messages
  const { data: messagesData, isLoading: isLoadingMessages } = useQuery({
    ...trpc.threads.getMessages.queryOptions({ threadId }),
    enabled: !!threadId,
  });

  // Fetch intelligence
  const { data: intelligenceData, isLoading: isLoadingIntelligence } = useQuery(
    {
      ...trpc.threads.getIntelligence.queryOptions({ threadId }),
      enabled: !!threadId,
      staleTime: 60_000,
    }
  );

  // Mark as read on mount
  const markReadMutation = useMutation({
    ...trpc.threads.markRead.mutationOptions(),
    onSuccess: () => {
      // Invalidate thread queries to update unread status in inbox
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  useEffect(() => {
    if (threadId) {
      markReadMutation.mutate({ threadId, read: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Mutations
  const archiveMutation = useMutation({
    ...trpc.threads.archive.mutationOptions(),
    onSuccess: () => {
      toast.success("Thread archived");
      navigate({ to: "/dashboard/inbox" });
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
      navigate({ to: "/dashboard/inbox" });
    },
  });

  // Handlers
  const handleBack = useCallback(() => {
    navigate({ to: "/dashboard/inbox" });
  }, [navigate]);

  const handleArchive = useCallback(async () => {
    await archiveMutation.mutateAsync({ threadId });
  }, [archiveMutation, threadId]);

  const handleStar = useCallback(async () => {
    const currentStarred = threadData?.thread?.isStarred ?? false;
    await starMutation.mutateAsync({ threadId, starred: !currentStarred });
  }, [starMutation, threadId, threadData?.thread?.isStarred]);

  const handleDelete = useCallback(async () => {
    await deleteMutation.mutateAsync({ threadId });
  }, [deleteMutation, threadId]);

  const handleReply = useCallback(() => {
    openReply(threadId);
  }, [openReply, threadId]);

  const handleForward = useCallback(() => {
    // Get the last message in the thread for forwarding
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

    // Build the forward body with original message context
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
  }, [messagesData?.messages, threadData?.thread?.subject, openForward]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleBack();
        return;
      }

      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandBarOpen(true);
        return;
      }

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "e") handleArchive();
      if (e.key === "s") handleStar();
      if (e.key === "r") handleReply();
      if (e.key === "f") handleForward();
      if (e.key === "#") handleDelete();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleBack,
    handleArchive,
    handleStar,
    handleDelete,
    handleReply,
    handleForward,
    setCommandBarOpen,
  ]);

  // Transform data
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
  // riskWarnings is currently always empty from the API, provide proper type
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

  // Get brief from thread data
  const brief = threadData?.thread?.brief;
  // These properties may not exist on all thread types - use optional chaining with fallbacks
  const suggestedAction = (threadData?.thread as { suggestedAction?: string })
    ?.suggestedAction;
  const priority = threadData?.thread?.priorityTier;

  // Get current user email from thread data - may need to derive from messages
  const currentUserEmail = messages[0]?.from?.email ?? "";

  // Participants - derive from messages
  const participantsMap = new Map<string, { name: string; email: string }>();
  for (const m of messages) {
    if (m.from?.email) {
      participantsMap.set(m.from.email, {
        email: m.from.email,
        name: m.from.name || "",
      });
    }
    for (const recipient of m.to ?? []) {
      if (recipient.email) {
        participantsMap.set(recipient.email, {
          email: recipient.email,
          name: recipient.name || "",
        });
      }
    }
  }
  const participants = Array.from(participantsMap.values());

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col overflow-hidden bg-background">
        {/* Top Navigation Bar */}
        <div className="z-20 shrink-0 border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3 px-4 py-2">
            <Button onClick={handleBack} size="icon" variant="ghost">
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate font-medium text-sm">
                {threadData?.thread?.subject ?? "Loading..."}
              </h1>
              {participants.length > 0 && (
                <div className="mt-0.5 flex items-center gap-1 text-muted-foreground text-xs">
                  <Users className="h-3 w-3" />
                  <span className="truncate">
                    {participants
                      .slice(0, 3)
                      .map((p) => p.name || p.email.split("@")[0])
                      .join(", ")}
                    {participants.length > 3 && ` +${participants.length - 3}`}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="gap-1.5"
                      onClick={handleReply}
                      size="sm"
                      variant="ghost"
                    >
                      <Reply className="h-4 w-4" />
                      <span className="hidden text-xs sm:inline">Reply</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reply (r)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="gap-1.5"
                      onClick={handleForward}
                      size="sm"
                      variant="ghost"
                    >
                      <Forward className="h-4 w-4" />
                      <span className="hidden text-xs sm:inline">Forward</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Forward (f)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="mx-1 h-5 w-px bg-border" />

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleStar} size="icon" variant="ghost">
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
                    <Button onClick={handleArchive} size="icon" variant="ghost">
                      <Archive className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Archive (e)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleDelete} size="icon" variant="ghost">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete (#)</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>

        {/* AI Intelligence Panel - Always visible */}
        <div className="shrink-0 border-b bg-gradient-to-r from-slate-50 via-blue-50/50 to-purple-50/50 dark:from-slate-900 dark:via-blue-950/30 dark:to-purple-950/30">
          <div className="px-4 py-3">
            <div className="mx-auto max-w-4xl">
              {/* Brief Summary */}
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    brief
                      ? "bg-gradient-to-br from-blue-500 to-purple-600 shadow-md"
                      : "bg-muted"
                  )}
                >
                  {isLoadingIntelligence ? (
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  ) : (
                    <Brain
                      className={cn(
                        "h-4 w-4",
                        brief ? "text-white" : "text-muted-foreground"
                      )}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {brief ? (
                    <>
                      <p className="text-foreground text-sm leading-relaxed">
                        {brief}
                      </p>
                      {(suggestedAction ||
                        (priority && priority !== "medium")) && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {suggestedAction && (
                            <Badge className="border-0 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 dark:text-blue-400">
                              <Zap className="mr-1 h-3 w-3" />
                              {formatAction(suggestedAction)}
                            </Badge>
                          )}
                          {priority && priority !== "medium" && (
                            <Badge
                              className={cn(
                                "text-[10px]",
                                priority === "urgent" &&
                                  "border-red-500 bg-red-500/10 text-red-500",
                                priority === "high" &&
                                  "border-orange-500 bg-orange-500/10 text-orange-500",
                                priority === "low" &&
                                  "border-muted-foreground text-muted-foreground"
                              )}
                              variant="outline"
                            >
                              {priority.toUpperCase()}
                            </Badge>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {isLoadingIntelligence
                        ? "Analyzing thread..."
                        : "AI analysis pending - new threads are analyzed automatically"}
                    </p>
                  )}
                </div>
              </div>

              {/* Intelligence Stats Row */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* Always show all categories */}
                <IntelligencePill
                  colorClass="text-red-500 bg-red-500/10"
                  count={riskWarnings.length}
                  icon={AlertTriangle}
                  isLoading={isLoadingIntelligence}
                  label="Risks"
                />
                <IntelligencePill
                  colorClass="text-blue-500 bg-blue-500/10"
                  count={commitments.length}
                  icon={CheckCircle2}
                  isLoading={isLoadingIntelligence}
                  label="Commitments"
                />
                <IntelligencePill
                  colorClass="text-purple-500 bg-purple-500/10"
                  count={decisions.length}
                  icon={Lightbulb}
                  isLoading={isLoadingIntelligence}
                  label="Decisions"
                />
                <IntelligencePill
                  colorClass="text-amber-500 bg-amber-500/10"
                  count={openQuestions.length}
                  icon={HelpCircle}
                  isLoading={isLoadingIntelligence}
                  label="Questions"
                />

                {hasIntelligence && (
                  <>
                    <div className="flex-1" />
                    <Button
                      className="h-7 text-muted-foreground text-xs"
                      onClick={() =>
                        setShowFullIntelligence(!showFullIntelligence)
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {showFullIntelligence ? "Hide details" : "Show details"}
                      {showFullIntelligence ? (
                        <ChevronUp className="ml-1 h-3 w-3" />
                      ) : (
                        <ChevronDown className="ml-1 h-3 w-3" />
                      )}
                    </Button>
                  </>
                )}
              </div>

              {/* Expanded Intelligence Details */}
              <AnimatePresence>
                {showFullIntelligence && hasIntelligence && (
                  <motion.div
                    animate={{ height: "auto", opacity: 1 }}
                    className="overflow-hidden"
                    exit={{ height: 0, opacity: 0 }}
                    initial={{ height: 0, opacity: 0 }}
                  >
                    <div className="max-h-64 space-y-3 overflow-y-auto pt-4">
                      {/* Risk Warnings */}
                      {riskWarnings.map((warning) => (
                        <IntelligenceCard
                          bgColor="bg-red-500/5 border-red-500/20"
                          description={warning.description}
                          icon={AlertTriangle}
                          iconColor="text-red-500"
                          key={warning.id}
                          meta={
                            warning.recommendation &&
                            `→ ${warning.recommendation}`
                          }
                          title={warning.title}
                        />
                      ))}

                      {/* Commitments */}
                      {commitments.map((c) => {
                        const debtorName =
                          typeof c.debtor === "object" && c.debtor
                            ? c.debtor.name || c.debtor.email || "Unknown"
                            : c.debtor || "Unknown";
                        const creditorName =
                          typeof c.creditor === "object" && c.creditor
                            ? c.creditor.name || c.creditor.email || "Unknown"
                            : c.creditor || "Unknown";
                        return (
                          <IntelligenceCard
                            badge={c.status}
                            bgColor="bg-blue-500/5 border-blue-500/20"
                            description={`${debtorName} owes this`}
                            icon={CheckCircle2}
                            iconColor="text-blue-500"
                            key={c.id}
                            meta={
                              c.dueDate &&
                              `Due ${formatDistanceToNow(new Date(c.dueDate), { addSuffix: true })}`
                            }
                            title={c.title}
                          />
                        );
                      })}

                      {/* Decisions */}
                      {decisions.map((d) => {
                        const makerName =
                          typeof d.maker === "object" && d.maker
                            ? d.maker.name || d.maker.email || "Unknown"
                            : d.maker || "Unknown";
                        return (
                          <IntelligenceCard
                            bgColor="bg-purple-500/5 border-purple-500/20"
                            description={d.statement}
                            icon={Lightbulb}
                            iconColor="text-purple-500"
                            key={d.id}
                            meta={`By ${makerName} • ${format(new Date(d.date), "MMM d, yyyy")}`}
                            title={d.title}
                          />
                        );
                      })}

                      {/* Open Questions */}
                      {openQuestions.map((q) => {
                        const askerName =
                          typeof q.askedBy === "object" && q.askedBy
                            ? q.askedBy.name || q.askedBy.email || "Unknown"
                            : q.askedBy || "Unknown";
                        return (
                          <IntelligenceCard
                            badge={q.isAnswered ? "Answered" : undefined}
                            badgeColor={
                              q.isAnswered
                                ? "bg-green-500/10 text-green-600"
                                : undefined
                            }
                            bgColor="bg-amber-500/5 border-amber-500/20"
                            icon={HelpCircle}
                            iconColor="text-amber-500"
                            key={q.id}
                            meta={`Asked by ${askerName}`}
                            title={q.question}
                          />
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Conversation View - Takes remaining space */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationView
            className="h-full"
            currentUserEmail={currentUserEmail}
            isLoading={isLoadingMessages}
            messages={messages}
            showIntelligenceButton={false}
            threadSubject={threadData?.thread?.subject ?? "Loading..."}
          />
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

function IntelligencePill({
  icon: Icon,
  label,
  count,
  colorClass,
  isLoading,
}: {
  icon: React.ElementType;
  label: string;
  count: number;
  colorClass: string;
  isLoading: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs transition-colors",
        count > 0 ? colorClass : "bg-muted/50 text-muted-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {isLoading ? (
        <span className="h-3 w-3 animate-pulse rounded bg-current/20" />
      ) : (
        <span>{count}</span>
      )}
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}

function IntelligenceCard({
  icon: Icon,
  iconColor,
  bgColor,
  title,
  description,
  meta,
  badge,
  badgeColor,
}: {
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
  title: string;
  description?: string;
  meta?: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-3", bgColor)}>
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconColor)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-sm">{title}</p>
            {badge && (
              <Badge
                className={cn("shrink-0 text-[10px]", badgeColor)}
                variant="outline"
              >
                {badge}
              </Badge>
            )}
          </div>
          {description && (
            <p className="mt-1 text-muted-foreground text-xs">{description}</p>
          )}
          {meta && <p className="mt-1 text-primary text-xs">{meta}</p>}
        </div>
      </div>
    </div>
  );
}

function formatAction(action: string): string {
  const actions: Record<string, string> = {
    respond: "Needs Response",
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
