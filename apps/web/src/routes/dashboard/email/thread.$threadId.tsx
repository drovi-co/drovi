"use client";

import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { ConversationView, type MessageData } from "@/components/email/conversation-view";
import { CommandBar, useCommandBar } from "@/components/email/command-bar";

import { trpc, queryClient } from "@/utils/trpc";
import {
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Archive,
  Star,
  Trash2,
  Users,
  Zap,
  Brain,
  Loader2,
  Reply,
  Forward,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

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
  const { open: commandBarOpen, setOpen: setCommandBarOpen, openReply, openForward } = useCommandBar();
  const [showFullIntelligence, setShowFullIntelligence] = useState(false);

  // Fetch thread details
  const {
    data: threadData,
    isLoading: isLoadingThread,
  } = useQuery({
    ...trpc.threads.getById.queryOptions({ threadId }),
    enabled: !!threadId,
  });

  // Fetch messages
  const { data: messagesData, isLoading: isLoadingMessages } = useQuery({
    ...trpc.threads.getMessages.queryOptions({ threadId }),
    enabled: !!threadId,
  });

  // Fetch intelligence
  const { data: intelligenceData, isLoading: isLoadingIntelligence } = useQuery({
    ...trpc.threads.getIntelligence.queryOptions({ threadId }),
    enabled: !!threadId,
    staleTime: 60000,
  });

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
      navigate({ to: "/dashboard/email" });
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
      navigate({ to: "/dashboard/email" });
    },
  });

  // Handlers
  const handleBack = useCallback(() => {
    navigate({ to: "/dashboard/email" });
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
    const forwardSubject = originalSubject.startsWith("Fwd:") || originalSubject.startsWith("FW:")
      ? originalSubject
      : `Fwd: ${originalSubject}`;

    // Build the forward body with original message context
    const fromName = lastMessage.from?.name ?? "";
    const fromEmail = lastMessage.from?.email ?? "";
    const originalFrom = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    const originalTo = (lastMessage.to ?? []).map((r: { email: string; name?: string }) =>
      r.name ? `${r.name} <${r.email}>` : r.email
    ).join(", ");
    const originalDate = format(new Date(lastMessage.date), "EEE, MMM d, yyyy 'at' h:mm a");
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
  }, [handleBack, handleArchive, handleStar, handleDelete, handleReply, handleForward, setCommandBarOpen]);

  // Transform data
  const messages: MessageData[] = (messagesData?.messages ?? []).map((m) => ({
    id: m.id,
    threadId: m.threadId,
    subject: m.subject ?? "",
    from: m.from ?? { email: "", name: "" },
    to: m.to ?? [],
    cc: m.cc,
    date: new Date(m.date),
    body: m.body ?? "",
    bodyHtml: m.bodyHtml,
    snippet: m.snippet ?? "",
    isUnread: m.isUnread ?? false,
    attachments: m.attachments,
  }));

  // Extract intelligence data
  const commitments = intelligenceData?.commitments ?? [];
  const decisions = intelligenceData?.decisions ?? [];
  const openQuestions = intelligenceData?.openQuestions ?? [];
  const riskWarnings = intelligenceData?.riskWarnings ?? [];

  const hasIntelligence = commitments.length > 0 || decisions.length > 0 ||
    openQuestions.length > 0 || riskWarnings.length > 0;

  // Get brief and suggested action from thread data
  const brief = threadData?.thread?.brief;
  const suggestedAction = threadData?.thread?.suggestedAction;
  const priority = threadData?.thread?.priority;

  // Get current user email from thread data
  const currentUserEmail = threadData?.thread?.accountEmail ?? "";

  // Participants
  const participants = threadData?.thread?.participants ?? [];

  return (
    <div data-no-shell-padding className="h-full">
      <CommandBar open={commandBarOpen} onOpenChange={setCommandBarOpen} />

      <div className="h-[calc(100vh-var(--header-height))] flex flex-col bg-background overflow-hidden">
        {/* Top Navigation Bar */}
        <div className="border-b bg-background/95 backdrop-blur-sm shrink-0 z-20">
          <div className="flex items-center gap-3 px-4 py-2">
            <Button variant="ghost" size="icon" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-medium truncate">
                {threadData?.thread?.subject ?? "Loading..."}
              </h1>
              {participants.length > 0 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <Users className="h-3 w-3" />
                  <span className="truncate">
                    {participants.slice(0, 3).map(p => p.name || p.email.split("@")[0]).join(", ")}
                    {participants.length > 3 && ` +${participants.length - 3}`}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={handleReply} className="gap-1.5">
                      <Reply className="h-4 w-4" />
                      <span className="hidden sm:inline text-xs">Reply</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reply (r)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={handleForward} className="gap-1.5">
                      <Forward className="h-4 w-4" />
                      <span className="hidden sm:inline text-xs">Forward</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Forward (f)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="w-px h-5 bg-border mx-1" />

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={handleStar}>
                      <Star className={cn("h-4 w-4", threadData?.thread?.isStarred && "fill-amber-400 text-amber-400")} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Star (s)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={handleArchive}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Archive (e)</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={handleDelete}>
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
            <div className="max-w-4xl mx-auto">
              {/* Brief Summary */}
              <div className="flex items-start gap-3">
                <div className={cn(
                  "shrink-0 h-9 w-9 rounded-lg flex items-center justify-center",
                  brief
                    ? "bg-gradient-to-br from-blue-500 to-purple-600 shadow-md"
                    : "bg-muted"
                )}>
                  {isLoadingIntelligence ? (
                    <Loader2 className="h-4 w-4 text-white animate-spin" />
                  ) : (
                    <Brain className={cn("h-4 w-4", brief ? "text-white" : "text-muted-foreground")} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {brief ? (
                    <>
                      <p className="text-sm text-foreground leading-relaxed">{brief}</p>
                      {(suggestedAction || (priority && priority !== "medium")) && (
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {suggestedAction && (
                            <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0 hover:bg-blue-500/20">
                              <Zap className="h-3 w-3 mr-1" />
                              {formatAction(suggestedAction)}
                            </Badge>
                          )}
                          {priority && priority !== "medium" && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                priority === "urgent" && "border-red-500 text-red-500 bg-red-500/10",
                                priority === "high" && "border-orange-500 text-orange-500 bg-orange-500/10",
                                priority === "low" && "border-muted-foreground text-muted-foreground"
                              )}
                            >
                              {priority.toUpperCase()}
                            </Badge>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {isLoadingIntelligence
                        ? "Analyzing thread..."
                        : "AI analysis pending - new threads are analyzed automatically"}
                    </p>
                  )}
                </div>
              </div>

              {/* Intelligence Stats Row */}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {/* Always show all categories */}
                <IntelligencePill
                  icon={AlertTriangle}
                  label="Risks"
                  count={riskWarnings.length}
                  colorClass="text-red-500 bg-red-500/10"
                  isLoading={isLoadingIntelligence}
                />
                <IntelligencePill
                  icon={CheckCircle2}
                  label="Commitments"
                  count={commitments.length}
                  colorClass="text-blue-500 bg-blue-500/10"
                  isLoading={isLoadingIntelligence}
                />
                <IntelligencePill
                  icon={Lightbulb}
                  label="Decisions"
                  count={decisions.length}
                  colorClass="text-purple-500 bg-purple-500/10"
                  isLoading={isLoadingIntelligence}
                />
                <IntelligencePill
                  icon={HelpCircle}
                  label="Questions"
                  count={openQuestions.length}
                  colorClass="text-amber-500 bg-amber-500/10"
                  isLoading={isLoadingIntelligence}
                />

                {hasIntelligence && (
                  <>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowFullIntelligence(!showFullIntelligence)}
                      className="h-7 text-xs text-muted-foreground"
                    >
                      {showFullIntelligence ? "Hide details" : "Show details"}
                      {showFullIntelligence ? (
                        <ChevronUp className="h-3 w-3 ml-1" />
                      ) : (
                        <ChevronDown className="h-3 w-3 ml-1" />
                      )}
                    </Button>
                  </>
                )}
              </div>

              {/* Expanded Intelligence Details */}
              <AnimatePresence>
                {showFullIntelligence && hasIntelligence && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-4 space-y-3 max-h-64 overflow-y-auto">
                      {/* Risk Warnings */}
                      {riskWarnings.map((warning) => (
                        <IntelligenceCard
                          key={warning.id}
                          icon={AlertTriangle}
                          iconColor="text-red-500"
                          bgColor="bg-red-500/5 border-red-500/20"
                          title={warning.title}
                          description={warning.description}
                          meta={warning.recommendation && `→ ${warning.recommendation}`}
                        />
                      ))}

                      {/* Commitments */}
                      {commitments.map((c) => {
                        const debtorName = typeof c.debtor === 'object' && c.debtor
                          ? (c.debtor.name || c.debtor.email || 'Unknown')
                          : (c.debtor || 'Unknown');
                        const creditorName = typeof c.creditor === 'object' && c.creditor
                          ? (c.creditor.name || c.creditor.email || 'Unknown')
                          : (c.creditor || 'Unknown');
                        return (
                          <IntelligenceCard
                            key={c.id}
                            icon={CheckCircle2}
                            iconColor="text-blue-500"
                            bgColor="bg-blue-500/5 border-blue-500/20"
                            title={c.title}
                            description={`${debtorName} owes this`}
                            meta={c.dueDate && `Due ${formatDistanceToNow(new Date(c.dueDate), { addSuffix: true })}`}
                            badge={c.status}
                          />
                        );
                      })}

                      {/* Decisions */}
                      {decisions.map((d) => {
                        const makerName = typeof d.maker === 'object' && d.maker
                          ? (d.maker.name || d.maker.email || 'Unknown')
                          : (d.maker || 'Unknown');
                        return (
                          <IntelligenceCard
                            key={d.id}
                            icon={Lightbulb}
                            iconColor="text-purple-500"
                            bgColor="bg-purple-500/5 border-purple-500/20"
                            title={d.title}
                            description={d.statement}
                            meta={`By ${makerName} • ${format(new Date(d.date), "MMM d, yyyy")}`}
                          />
                        );
                      })}

                      {/* Open Questions */}
                      {openQuestions.map((q) => {
                        const askerName = typeof q.askedBy === 'object' && q.askedBy
                          ? (q.askedBy.name || q.askedBy.email || 'Unknown')
                          : (q.askedBy || 'Unknown');
                        return (
                          <IntelligenceCard
                            key={q.id}
                            icon={HelpCircle}
                            iconColor="text-amber-500"
                            bgColor="bg-amber-500/5 border-amber-500/20"
                            title={q.question}
                            meta={`Asked by ${askerName}`}
                            badge={q.isAnswered ? "Answered" : undefined}
                            badgeColor={q.isAnswered ? "bg-green-500/10 text-green-600" : undefined}
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
        <div className="flex-1 min-h-0 overflow-hidden">
          <ConversationView
            messages={messages}
            threadSubject={threadData?.thread?.subject ?? "Loading..."}
            currentUserEmail={currentUserEmail}
            isLoading={isLoadingMessages}
            showIntelligenceButton={false}
            className="h-full"
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
    <div className={cn(
      "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
      count > 0 ? colorClass : "text-muted-foreground bg-muted/50"
    )}>
      <Icon className="h-3.5 w-3.5" />
      {isLoading ? (
        <span className="w-3 h-3 bg-current/20 rounded animate-pulse" />
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
    <div className={cn("rounded-lg p-3 border", bgColor)}>
      <div className="flex items-start gap-2">
        <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">{title}</p>
            {badge && (
              <Badge variant="outline" className={cn("text-[10px] shrink-0", badgeColor)}>
                {badge}
              </Badge>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
          {meta && (
            <p className="text-xs text-primary mt-1">{meta}</p>
          )}
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
  return actions[action] || action.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}
