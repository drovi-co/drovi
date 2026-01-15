"use client";

import { ComposeDialog } from "@/components/compose";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveOrganization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc, useTRPC } from "@/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  ArrowRight,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  FileText,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  Reply,
  Search,
  Send,
  Settings,
  Sparkles,
  Star,
  StarOff,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, createContext, useContext } from "react";
import { toast } from "sonner";

// =============================================================================
// CONTEXT FOR GLOBAL COMMAND BAR STATE
// =============================================================================

interface ForwardContext {
  subject: string;
  body: string;
  originalFrom: string;
  originalDate: string;
  originalTo: string;
}

interface ComposeContext {
  to?: Array<{ email: string; name?: string }>;
  subject?: string;
  body?: string;
}

interface CommandBarContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  openCompose: (context?: ComposeContext) => void;
  openReply: (threadId: string) => void;
  openForward: (context: ForwardContext) => void;
}

const CommandBarContext = createContext<CommandBarContextType | null>(null);

export function CommandBarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [forwardContext, setForwardContext] = useState<ForwardContext | null>(null);
  const [composeContext, setComposeContext] = useState<ComposeContext | null>(null);

  const openCompose = useCallback((context?: ComposeContext) => {
    setReplyThreadId(null);
    setForwardContext(null);
    setComposeContext(context ?? null);
    setComposeOpen(true);
  }, []);

  const openReply = useCallback((threadId: string) => {
    setReplyThreadId(threadId);
    setForwardContext(null);
    setComposeOpen(true);
  }, []);

  const openForward = useCallback((context: ForwardContext) => {
    setReplyThreadId(null);
    setForwardContext(context);
    setComposeOpen(true);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" ||
                       target.tagName === "TEXTAREA" ||
                       target.isContentEditable;

      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }

      // C for compose (when not typing)
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !isTyping) {
        e.preventDefault();
        openCompose();
        return;
      }

      // R for reply (when not typing)
      if (e.key === "r" && !e.metaKey && !e.ctrlKey && !isTyping) {
        // Get thread ID from URL if on thread page
        const threadIdMatch = window.location.pathname.match(/\/thread\/([a-f0-9-]{36})/);
        if (threadIdMatch?.[1]) {
          e.preventDefault();
          openReply(threadIdMatch[1]);
        }
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openCompose, openReply]);

  return (
    <CommandBarContext.Provider value={{ open, setOpen, openCompose, openReply, openForward }}>
      {children}
      {/* Provider-level compose state for global shortcuts */}
      <ComposeDialogGlobal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        replyThreadId={replyThreadId}
        forwardContext={forwardContext}
        composeContext={composeContext}
      />
    </CommandBarContext.Provider>
  );
}

/**
 * Global compose dialog component that gets organization/account from hooks
 */
function ComposeDialogGlobal({
  open,
  onOpenChange,
  replyThreadId,
  forwardContext,
  composeContext,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replyThreadId: string | null;
  forwardContext: ForwardContext | null;
  composeContext: ComposeContext | null;
}) {
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const trpcClient = useTRPC();

  // Always fetch email accounts when we have an org (not just when dialog is open)
  // This ensures the data is ready when user presses 'c'
  const { data: accounts, isLoading } = useQuery({
    ...trpcClient.emailAccounts.list.queryOptions({
      organizationId,
    }),
    enabled: !!organizationId,
  });

  // emailAccounts.list returns an array directly
  const primaryAccountId = accounts?.find((a) => a.isPrimary)?.id
    ?? accounts?.[0]?.id
    ?? "";

  // Don't render anything if dialog is not open
  if (!open) {
    return null;
  }

  // Show loading or error state if no account
  if (!organizationId) {
    return null;
  }

  if (isLoading) {
    // Dialog is open but accounts still loading - show dialog with loading state
    return (
      <ComposeDialog
        open={open}
        onOpenChange={onOpenChange}
        organizationId={organizationId}
        accountId=""
        replyToThreadId={replyThreadId ?? undefined}
        initialTo={composeContext?.to}
        initialSubject={forwardContext?.subject ?? composeContext?.subject}
        initialBody={forwardContext?.body ?? composeContext?.body}
      />
    );
  }

  if (!primaryAccountId) {
    // No email account connected - close dialog and show toast
    if (open) {
      onOpenChange(false);
      toast.error("No email account connected. Please connect an email account first.");
    }
    return null;
  }

  return (
    <ComposeDialog
      open={open}
      onOpenChange={onOpenChange}
      organizationId={organizationId}
      accountId={primaryAccountId}
      replyToThreadId={replyThreadId ?? undefined}
      initialTo={composeContext?.to}
      initialSubject={forwardContext?.subject ?? composeContext?.subject}
      initialBody={forwardContext?.body ?? composeContext?.body}
    />
  );
}

export function useCommandBar() {
  const context = useContext(CommandBarContext);
  if (!context) {
    throw new Error("useCommandBar must be used within a CommandBarProvider");
  }
  return context;
}

// =============================================================================
// TYPES
// =============================================================================

interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResult {
  id: string;
  type: "thread" | "message" | "commitment" | "decision" | "contact";
  title: string;
  snippet: string;
  confidence: number;
  metadata?: {
    threadId?: string;
    date?: string;
    sender?: string;
  };
}

interface AIResponse {
  answer: string;
  citations: Array<{
    id: string;
    text: string;
    source: string;
    threadId?: string;
  }>;
  confidence: number;
  followUpQuestions?: string[];
}

type CommandMode = "search" | "ask" | "navigate" | "action";

interface ThinkingStep {
  id: string;
  label: string;
  status: "pending" | "active" | "complete";
}

const MODES: CommandMode[] = ["search", "ask", "navigate", "action"];

// =============================================================================
// MAIN COMMAND BAR COMPONENT
// =============================================================================

export function CommandBar({ open, onOpenChange }: CommandBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const trpcClient = useTRPC();
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<CommandMode>("search");
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  const [isAskingAI, setIsAskingAI] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSnoozePicker, setShowSnoozePicker] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeReplyThreadId, setComposeReplyThreadId] = useState<string | null>(null);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Detect current thread from URL (e.g., /dashboard/email/thread/uuid)
  const currentThreadId = location.pathname.match(/\/thread\/([a-f0-9-]{36})/)?.[1] ?? null;

  // Get primary email account for composing
  const { data: emailAccounts } = useQuery({
    ...trpcClient.emailAccounts.list.queryOptions({
      organizationId,
    }),
    enabled: !!organizationId,
  });
  // emailAccounts.list returns an array directly
  const primaryAccountId = emailAccounts?.find((a) => a.isPrimary)?.id
    ?? emailAccounts?.[0]?.id
    ?? "";

  // ==========================================================================
  // ACTION MUTATIONS
  // ==========================================================================

  const archiveMutation = useMutation({
    ...trpc.threads.archive.mutationOptions(),
    onSuccess: () => {
      toast.success("Thread archived");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      onOpenChange(false);
      navigate({ to: "/dashboard/email" });
    },
    onError: (err) => toast.error(`Failed to archive: ${err.message}`),
  });

  const starMutation = useMutation({
    ...trpc.threads.star.mutationOptions(),
    onSuccess: (_, variables) => {
      toast.success(variables.starred ? "Thread starred" : "Star removed");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(`Failed to update star: ${err.message}`),
  });

  const markReadMutation = useMutation({
    ...trpc.threads.markRead.mutationOptions(),
    onSuccess: (_, variables) => {
      toast.success(variables.read ? "Marked as read" : "Marked as unread");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      onOpenChange(false);
    },
    onError: (err) => toast.error(`Failed to update: ${err.message}`),
  });

  const snoozeMutation = useMutation({
    ...trpc.threads.snooze.mutationOptions(),
    onSuccess: () => {
      toast.success("Thread snoozed");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      onOpenChange(false);
      setShowSnoozePicker(false);
      navigate({ to: "/dashboard/email" });
    },
    onError: (err) => toast.error(`Failed to snooze: ${err.message}`),
  });

  const deleteMutation = useMutation({
    ...trpc.threads.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Thread deleted");
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      onOpenChange(false);
      navigate({ to: "/dashboard/email" });
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message}`),
  });

  // Get current thread data if we're on a thread page
  const { data: currentThread } = useQuery({
    ...trpc.threads.getById.queryOptions({ threadId: currentThreadId ?? "" }),
    enabled: !!currentThreadId && open,
  });

  // Detect mode from query prefix
  useEffect(() => {
    if (query.startsWith("?") || query.toLowerCase().startsWith("ask ")) {
      setMode("ask");
    } else if (query.startsWith(">") || query.toLowerCase().startsWith("go ")) {
      setMode("navigate");
    } else if (query.startsWith("!") || query.toLowerCase().startsWith("do ")) {
      setMode("action");
    } else {
      setMode("search");
    }
  }, [query]);

  // Clean query for searching
  const cleanQuery = query
    .replace(/^[?!>]/, "")
    .replace(/^(ask|go|do)\s+/i, "")
    .trim();

  // Search query - uses semantic search across messages, threads, and claims
  const { data: searchResults, isLoading: isSearching } = useQuery({
    ...trpc.search.search.queryOptions({
      organizationId,
      query: cleanQuery,
      limit: 10,
      types: ["thread", "message", "claim"],
    }),
    enabled: mode === "search" && cleanQuery.length > 2 && open && !!organizationId,
  });

  // Ask AI mutation - uses knowledge agent for Q&A with citations
  const askAIMutation = useMutation({
    ...trpc.search.ask.mutationOptions(),
    onSuccess: (data) => {
      // Map API response to our AIResponse type
      const mappedResponse: AIResponse = {
        answer: data.answer,
        confidence: data.confidence,
        citations: (data.citations ?? []).map((c: { id: string; text: string; sourceThreadId?: string; subject?: string }) => ({
          id: c.id,
          text: c.text,
          source: c.subject ?? "Email",
          threadId: c.sourceThreadId,
        })),
        followUpQuestions: [],
      };
      setAiResponse(mappedResponse);
      setIsAskingAI(false);
    },
    onError: () => {
      setIsAskingAI(false);
    },
  });

  // Handle navigation - use React Router for instant nav
  const handleNavigate = useCallback(
    (path: string) => {
      onOpenChange(false);
      navigate({ to: path });
    },
    [navigate, onOpenChange]
  );

  // Handle ask AI
  const handleAskAI = useCallback(() => {
    if (cleanQuery.length < 3 || !organizationId) return;
    setIsAskingAI(true);
    setAiResponse(null);
    askAIMutation.mutate({ organizationId, question: cleanQuery });
  }, [cleanQuery, organizationId, askAIMutation]);

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      setQuery("");
      setAiResponse(null);
      setMode("search");
      setSelectedIndex(0);
      setShowSnoozePicker(false);
      setThinkingSteps([]);
      // Keep conversation history so users can reference past questions when reopening
      // setConversationHistory([]);
    }
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Keyboard handling
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab to cycle modes
      if (e.key === "Tab") {
        e.preventDefault();
        const currentIndex = MODES.indexOf(mode);
        if (e.shiftKey) {
          const prevIndex = (currentIndex - 1 + MODES.length) % MODES.length;
          setMode(MODES[prevIndex]);
          // Set query prefix based on mode
          setQuery(getModePrefix(MODES[prevIndex]));
        } else {
          const nextIndex = (currentIndex + 1) % MODES.length;
          setMode(MODES[nextIndex]);
          setQuery(getModePrefix(MODES[nextIndex]));
        }
        return;
      }

      // Enter to submit AI query in ask mode
      if (e.key === "Enter" && mode === "ask" && cleanQuery.length > 2 && !isAskingAI) {
        e.preventDefault();
        handleAskAI();
        return;
      }

      // Escape to close
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, mode, cleanQuery, isAskingAI, handleAskAI, onOpenChange]);

  // Navigation items
  const navigationItems = [
    { id: "inbox", label: "Inbox", description: "All your emails", icon: Inbox, path: "/dashboard/email" },
    { id: "unread", label: "Unread", description: "Unread messages", icon: Bell, path: "/dashboard/email?filter=unread" },
    { id: "starred", label: "Starred", description: "Important threads", icon: Star, path: "/dashboard/email?filter=starred" },
    { id: "sent", label: "Sent", description: "Sent messages", icon: Send, path: "/dashboard/email?filter=sent" },
    { id: "commitments", label: "Commitments", description: "Track promises & tasks", icon: CheckCircle2, path: "/dashboard/commitments" },
    { id: "decisions", label: "Decisions", description: "Decision history", icon: BookOpen, path: "/dashboard/decisions" },
    { id: "contacts", label: "Contacts", description: "Relationship intelligence", icon: Users, path: "/dashboard/contacts" },
    { id: "settings", label: "Settings", description: "Account settings", icon: Settings, path: "/dashboard/settings" },
  ];

  // Quick actions (shown when no query)
  const quickActions = [
    { id: "go-inbox", label: "Go to Inbox", description: "View your emails", icon: Inbox, shortcut: "G I", action: () => handleNavigate("/dashboard/email") },
    { id: "go-commitments", label: "View Commitments", description: "See tracked commitments", icon: CheckCircle2, shortcut: "G C", action: () => handleNavigate("/dashboard/commitments") },
    { id: "go-decisions", label: "View Decisions", description: "Browse decision history", icon: BookOpen, shortcut: "G D", action: () => handleNavigate("/dashboard/decisions") },
    { id: "go-contacts", label: "View Contacts", description: "Relationship intelligence", icon: Users, shortcut: "G R", action: () => handleNavigate("/dashboard/contacts") },
  ];

  // ==========================================================================
  // ACTION HANDLERS
  // ==========================================================================

  const handleArchive = useCallback(() => {
    if (!currentThreadId) {
      toast.error("No thread selected. Navigate to a thread first.");
      return;
    }
    archiveMutation.mutate({ threadId: currentThreadId });
  }, [currentThreadId, archiveMutation]);

  const handleStar = useCallback((star: boolean) => {
    if (!currentThreadId) {
      toast.error("No thread selected. Navigate to a thread first.");
      return;
    }
    starMutation.mutate({ threadId: currentThreadId, starred: star });
  }, [currentThreadId, starMutation]);

  const handleMarkRead = useCallback((read: boolean) => {
    if (!currentThreadId) {
      toast.error("No thread selected. Navigate to a thread first.");
      return;
    }
    markReadMutation.mutate({ threadId: currentThreadId, read });
  }, [currentThreadId, markReadMutation]);

  const handleSnooze = useCallback((until: Date) => {
    if (!currentThreadId) {
      toast.error("No thread selected. Navigate to a thread first.");
      return;
    }
    snoozeMutation.mutate({ threadId: currentThreadId, until });
  }, [currentThreadId, snoozeMutation]);

  const handleDelete = useCallback(() => {
    if (!currentThreadId) {
      toast.error("No thread selected. Navigate to a thread first.");
      return;
    }
    deleteMutation.mutate({ threadId: currentThreadId });
  }, [currentThreadId, deleteMutation]);

  const handleCompose = useCallback(() => {
    if (!primaryAccountId) {
      toast.error("No email account connected. Please connect an account first.");
      return;
    }
    setComposeReplyThreadId(null);
    setShowCompose(true);
    onOpenChange(false);
  }, [primaryAccountId, onOpenChange]);

  const handleReply = useCallback(() => {
    if (!primaryAccountId) {
      toast.error("No email account connected. Please connect an account first.");
      return;
    }
    if (!currentThreadId) {
      toast.error("No thread selected. Navigate to a thread first.");
      return;
    }
    setComposeReplyThreadId(currentThreadId);
    setShowCompose(true);
    onOpenChange(false);
  }, [primaryAccountId, currentThreadId, onOpenChange]);

  // Snooze duration options
  const snoozeOptions = [
    { label: "Later today", getDate: () => { const d = new Date(); d.setHours(d.getHours() + 3); return d; } },
    { label: "Tomorrow", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
    { label: "Next week", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d; } },
    { label: "In 2 weeks", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 14); d.setHours(9, 0, 0, 0); return d; } },
    { label: "Next month", getDate: () => { const d = new Date(); d.setMonth(d.getMonth() + 1); d.setHours(9, 0, 0, 0); return d; } },
  ];

  // Determine if current thread is starred/read
  const isStarred = currentThread?.thread?.isStarred ?? false;
  const isRead = currentThread?.thread?.isRead ?? true;

  // Action items - fully functional with thread context
  const actionItems = [
    {
      id: "compose",
      label: "Compose Email",
      description: "Start a new conversation",
      icon: Mail,
      implemented: true,
      requiresThread: false,
      action: handleCompose,
      shortcut: "C",
    },
    {
      id: "reply",
      label: "Reply to Thread",
      description: currentThreadId ? "Reply to current thread" : "Select a thread first",
      icon: Reply,
      implemented: true,
      requiresThread: true,
      action: handleReply,
      shortcut: "R",
    },
    {
      id: "archive",
      label: "Archive Thread",
      description: currentThreadId ? "Move to archive" : "Select a thread first",
      icon: Archive,
      implemented: true,
      requiresThread: true,
      action: handleArchive,
      loading: archiveMutation.isPending,
    },
    {
      id: "star",
      label: isStarred ? "Remove Star" : "Star Thread",
      description: currentThreadId ? (isStarred ? "Remove star from thread" : "Mark as important") : "Select a thread first",
      icon: isStarred ? StarOff : Star,
      implemented: true,
      requiresThread: true,
      action: () => handleStar(!isStarred),
      loading: starMutation.isPending,
    },
    {
      id: "read",
      label: isRead ? "Mark as Unread" : "Mark as Read",
      description: currentThreadId ? (isRead ? "Mark thread as unread" : "Mark thread as read") : "Select a thread first",
      icon: isRead ? EyeOff : Eye,
      implemented: true,
      requiresThread: true,
      action: () => handleMarkRead(!isRead),
      loading: markReadMutation.isPending,
    },
    {
      id: "snooze",
      label: "Snooze Thread",
      description: currentThreadId ? "Remind me later" : "Select a thread first",
      icon: Clock,
      implemented: true,
      requiresThread: true,
      action: () => setShowSnoozePicker(true),
      loading: snoozeMutation.isPending,
    },
    {
      id: "delete",
      label: "Delete Thread",
      description: currentThreadId ? "Move to trash" : "Select a thread first",
      icon: Trash2,
      implemented: true,
      requiresThread: true,
      action: handleDelete,
      loading: deleteMutation.isPending,
      danger: true,
    },
  ];

  // Filter items based on query
  const filteredNavItems = cleanQuery
    ? navigationItems.filter(
        (item) =>
          item.label.toLowerCase().includes(cleanQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(cleanQuery.toLowerCase())
      )
    : navigationItems;

  const filteredActions = cleanQuery
    ? actionItems.filter(
        (item) =>
          item.label.toLowerCase().includes(cleanQuery.toLowerCase()) ||
          item.description.toLowerCase().includes(cleanQuery.toLowerCase())
      )
    : actionItems;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-2xl border-0 bg-background/98 backdrop-blur-xl w-[800px] max-w-[90vw] gap-0">
        <DialogTitle className="sr-only">Command Bar</DialogTitle>
        <Command
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
          shouldFilter={false}
          loop
        >
          {/* Input Area */}
          <div className="flex items-center border-b px-4 py-3">
            <div className="mr-3 flex items-center gap-2">
              <ModeIcon mode={mode} />
            </div>
            <Command.Input
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder={getPlaceholder(mode)}
              className="flex-1 h-12 text-lg bg-transparent outline-hidden placeholder:text-muted-foreground/60"
            />
            {mode === "ask" && cleanQuery.length > 2 && (
              <Button
                size="sm"
                onClick={handleAskAI}
                disabled={isAskingAI}
                className="ml-3 shrink-0"
              >
                {isAskingAI ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Ask AI
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center gap-1 px-4 py-2 border-b bg-muted/30">
            {MODES.map((m, index) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setQuery(getModePrefix(m));
                  inputRef.current?.focus();
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <ModeIcon mode={m} size="sm" />
                <span className="capitalize">{m}</span>
                <kbd className="ml-1 text-[10px] opacity-60">{index + 1}</kbd>
              </button>
            ))}
            <div className="ml-auto text-xs text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-muted">Tab</kbd> to switch
            </div>
          </div>

          {/* Results Area */}
          <Command.List
            ref={listRef}
            className="max-h-[500px] overflow-y-auto overflow-x-hidden scroll-py-2"
          >
            <AnimatePresence mode="wait">
              {/* Loading State for Search */}
              {isSearching && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-6"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Searching your emails...
                    </span>
                  </div>
                  <div className="space-y-3">
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-3/4" />
                  </div>
                </motion.div>
              )}

              {/* Conversational AI Thinking State */}
              {isAskingAI && thinkingSteps.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-6"
                >
                  <ThinkingIndicator steps={thinkingSteps} />
                </motion.div>
              )}

              {/* AI Response */}
              {aiResponse && mode === "ask" && !isAskingAI && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="p-4 border-b"
                >
                  <AIResponseView
                    response={aiResponse}
                    onCitationClick={(threadId) => {
                      if (threadId) {
                        handleNavigate(`/dashboard/email/thread/${threadId}`);
                      }
                    }}
                    onFollowUp={(q) => setQuery(`? ${q}`)}
                  />
                </motion.div>
              )}

              {/* Search Results */}
              {mode === "search" && !isSearching && searchResults?.results && searchResults.results.length > 0 && (
                <Command.Group heading="Search Results">
                  {searchResults.results.map((result) => {
                    // Map API response to display format
                    const threadId = (result.metadata?.threadId as string) ?? result.id;
                    const title = (result.metadata?.subject as string) ??
                                  (result.metadata?.threadSubject as string) ??
                                  result.content?.slice(0, 60) ?? "Untitled";
                    const snippet = result.content?.slice(0, 150) ?? "";

                    return (
                      <CommandItem
                        key={result.id}
                        onSelect={() => {
                          if (result.type === "thread") {
                            handleNavigate(`/dashboard/email/thread/${result.id}`);
                          } else if (threadId) {
                            handleNavigate(`/dashboard/email/thread/${threadId}`);
                          }
                        }}
                      >
                        <ResultIcon type={result.type} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{title}</span>
                            <ConfidenceBadge confidence={result.score} />
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-1">
                            {snippet}
                          </p>
                        </div>
                      </CommandItem>
                    );
                  })}
                </Command.Group>
              )}

              {/* Navigate Mode */}
              {mode === "navigate" && !isSearching && (
                <Command.Group heading="Navigate To">
                  {filteredNavItems.map((item) => (
                    <CommandItem
                      key={item.id}
                      onSelect={() => handleNavigate(item.path)}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <span className="font-medium">{item.label}</span>
                        <p className="text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </CommandItem>
                  ))}
                </Command.Group>
              )}

              {/* Action Mode */}
              {mode === "action" && !isSearching && !showSnoozePicker && (
                <Command.Group heading={currentThreadId ? `Actions for "${currentThread?.thread?.subject?.slice(0, 30) ?? 'Thread'}..."` : "Actions"}>
                  {!currentThreadId && (
                    <div className="px-4 py-2 mb-2 bg-amber-500/10 border border-amber-500/20 rounded-lg mx-2">
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        Navigate to a thread to enable thread actions
                      </p>
                    </div>
                  )}
                  {filteredActions.length > 0 ? (
                    filteredActions.map((item) => {
                      const isDisabled = !item.implemented || (item.requiresThread && !currentThreadId);
                      const isLoading = 'loading' in item && item.loading;
                      const isDanger = 'danger' in item && item.danger;

                      return (
                        <CommandItem
                          key={item.id}
                          onSelect={() => {
                            if (isDisabled || isLoading) return;
                            item.action();
                          }}
                        >
                          <div className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-lg border bg-background shrink-0",
                            isDisabled && "opacity-50",
                            isDanger && "border-red-500/30 bg-red-500/5"
                          )}>
                            {isLoading ? (
                              <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                              <item.icon className={cn("h-5 w-5", isDanger && "text-red-500")} />
                            )}
                          </div>
                          <div className="flex-1">
                            <span className={cn(
                              "font-medium",
                              isDisabled && "text-muted-foreground",
                              isDanger && "text-red-500"
                            )}>
                              {item.label}
                            </span>
                            <p className="text-sm text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                          {!item.implemented ? (
                            <Badge variant="outline" className="text-xs">Soon</Badge>
                          ) : item.requiresThread && !currentThreadId ? (
                            <Badge variant="outline" className="text-xs text-amber-500">Needs thread</Badge>
                          ) : (
                            <Zap className={cn("h-4 w-4", isDanger ? "text-red-500" : "text-amber-500")} />
                          )}
                        </CommandItem>
                      );
                    })
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No actions match your search
                    </div>
                  )}
                </Command.Group>
              )}

              {/* Snooze Picker */}
              {mode === "action" && showSnoozePicker && (
                <Command.Group heading="Snooze Until">
                  <div className="px-4 py-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setShowSnoozePicker(false)}
                      className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      ← Back to actions
                    </button>
                  </div>
                  {snoozeOptions.map((option) => (
                    <CommandItem
                      key={option.label}
                      onSelect={() => handleSnooze(option.getDate())}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background shrink-0">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <span className="font-medium">{option.label}</span>
                        <p className="text-sm text-muted-foreground">
                          {option.getDate().toLocaleDateString(undefined, {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </Command.Group>
              )}

              {/* Quick Actions (No Query) */}
              {!query && mode === "search" && (
                <>
                  <Command.Group heading="Quick Actions">
                    {quickActions.map((action) => (
                      <CommandItem key={action.id} onSelect={action.action}>
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
                          <action.icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <span className="font-medium">{action.label}</span>
                          <p className="text-sm text-muted-foreground">
                            {action.description}
                          </p>
                        </div>
                        {action.shortcut && (
                          <kbd className="hidden sm:flex h-6 items-center gap-1 rounded border bg-muted px-2 font-mono text-xs">
                            {action.shortcut}
                          </kbd>
                        )}
                      </CommandItem>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Tips">
                    <div className="px-4 py-3 text-sm text-muted-foreground space-y-1">
                      <p>
                        <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs">?</kbd> Ask AI a question about your emails
                      </p>
                      <p>
                        <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs">{">"}</kbd> Navigate to any page
                      </p>
                      <p>
                        <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs">!</kbd> Execute an action
                      </p>
                    </div>
                  </Command.Group>
                </>
              )}

              {/* Empty State */}
              {mode === "search" &&
                !isSearching &&
                cleanQuery.length > 2 &&
                (!searchResults?.results || searchResults.results.length === 0) && (
                  <div className="py-12 text-center">
                    <Search className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-sm text-muted-foreground">
                      No results found for "{cleanQuery}"
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Try asking AI: <button
                        type="button"
                        onClick={() => setQuery(`? ${cleanQuery}`)}
                        className="text-primary hover:underline"
                      >
                        ? {cleanQuery}
                      </button>
                    </p>
                  </div>
                )}
            </AnimatePresence>
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground bg-muted/30">
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-background border">↵</kbd>
                <span>select</span>
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-background border">↑↓</kbd>
                <span>navigate</span>
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-background border">Tab</kbd>
                <span>switch mode</span>
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 rounded bg-background border">Esc</kbd>
                <span>close</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-purple-500" />
              <span>AI-powered search</span>
            </div>
          </div>
        </Command>
      </DialogContent>
    </Dialog>

    {/* Compose Dialog */}
    {organizationId && primaryAccountId && (
      <ComposeDialog
        open={showCompose}
        onOpenChange={setShowCompose}
        organizationId={organizationId}
        accountId={primaryAccountId}
        replyToThreadId={composeReplyThreadId ?? undefined}
      />
    )}
    </>
  );
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

function CommandItem({
  children,
  onSelect,
  className,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-3 px-4 py-3 cursor-pointer rounded-lg mx-2 my-0.5",
        "aria-selected:bg-accent aria-selected:text-accent-foreground",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
        "hover:bg-accent/50 transition-colors",
        className
      )}
    >
      {children as any}
    </Command.Item>
  );
}

function ModeIcon({ mode, size = "md" }: { mode: CommandMode; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  switch (mode) {
    case "ask":
      return <Sparkles className={cn(sizeClass, "text-purple-500")} />;
    case "navigate":
      return <ArrowRight className={cn(sizeClass, "text-blue-500")} />;
    case "action":
      return <Zap className={cn(sizeClass, "text-amber-500")} />;
    default:
      return <Search className={cn(sizeClass, "text-muted-foreground")} />;
  }
}

function ResultIcon({ type }: { type: string }) {
  const iconClass = "h-5 w-5";
  const wrapperClass = "flex h-10 w-10 items-center justify-center rounded-lg border bg-background shrink-0";

  switch (type) {
    case "thread":
      return (
        <div className={wrapperClass}>
          <MessageSquare className={iconClass} />
        </div>
      );
    case "message":
      return (
        <div className={cn(wrapperClass, "border-sky-500/30 bg-sky-500/5")}>
          <FileText className={cn(iconClass, "text-sky-500")} />
        </div>
      );
    case "claim":
      return (
        <div className={cn(wrapperClass, "border-purple-500/30 bg-purple-500/5")}>
          <Sparkles className={cn(iconClass, "text-purple-500")} />
        </div>
      );
    case "commitment":
      return (
        <div className={cn(wrapperClass, "border-blue-500/30 bg-blue-500/5")}>
          <CheckCircle2 className={cn(iconClass, "text-blue-500")} />
        </div>
      );
    case "decision":
      return (
        <div className={cn(wrapperClass, "border-amber-500/30 bg-amber-500/5")}>
          <BookOpen className={cn(iconClass, "text-amber-500")} />
        </div>
      );
    case "contact":
      return (
        <div className={cn(wrapperClass, "border-green-500/30 bg-green-500/5")}>
          <Users className={cn(iconClass, "text-green-500")} />
        </div>
      );
    default:
      return (
        <div className={wrapperClass}>
          <FileText className={iconClass} />
        </div>
      );
  }
}

// Thinking indicator with animated steps
function ThinkingIndicator({ steps }: { steps: ThinkingStep[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/10 shrink-0">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
          >
            <Sparkles className="h-5 w-5 text-purple-500" />
          </motion.div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-purple-500">Thinking...</span>
          </div>
          <div className="space-y-2">
            {steps.map((step) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3"
              >
                {step.status === "complete" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : step.status === "active" ? (
                  <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                )}
                <span
                  className={cn(
                    "text-sm",
                    step.status === "complete" && "text-muted-foreground",
                    step.status === "active" && "text-foreground font-medium",
                    step.status === "pending" && "text-muted-foreground/50"
                  )}
                >
                  {step.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Conversational AI response with inline citations
function AIResponseView({
  response,
  onCitationClick,
  onFollowUp,
}: {
  response: AIResponse;
  onCitationClick: (threadId?: string) => void;
  onFollowUp: (question: string) => void;
}) {
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(new Set());

  // Parse answer to find inline citation markers and replace with clickable links
  const renderAnswerWithCitations = () => {
    // If no citations, just return the answer
    if (response.citations.length === 0) {
      return <p className="text-sm leading-relaxed whitespace-pre-wrap">{response.answer}</p>;
    }

    // Simple citation injection: append numbered citations at the end of sentences if we have sources
    const parts: React.ReactNode[] = [];
    const sentences = response.answer.split(/(?<=[.!?])\s+/);

    sentences.forEach((sentence, idx) => {
      const citationForSentence = response.citations[idx % response.citations.length];
      parts.push(
        <span key={idx}>
          {sentence}{" "}
          {citationForSentence && idx < response.citations.length && (
            <InlineCitation
              index={idx + 1}
              citation={citationForSentence}
              isExpanded={expandedCitations.has(citationForSentence.id)}
              onToggle={() => {
                setExpandedCitations((prev) => {
                  const next = new Set(prev);
                  if (next.has(citationForSentence.id)) {
                    next.delete(citationForSentence.id);
                  } else {
                    next.add(citationForSentence.id);
                  }
                  return next;
                });
              }}
              onClick={() => onCitationClick(citationForSentence.threadId)}
            />
          )}
        </span>
      );
    });

    return <div className="text-sm leading-relaxed">{parts}</div>;
  };

  return (
    <div className="space-y-4">
      {/* Conversational Answer */}
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 shrink-0">
          <Sparkles className="h-5 w-5 text-purple-500" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold bg-gradient-to-r from-purple-500 to-blue-500 bg-clip-text text-transparent">
              Memory Assistant
            </span>
            <ConfidenceBadge confidence={response.confidence} />
          </div>
          {renderAnswerWithCitations()}
        </div>
      </div>

      {/* Source Summary - Collapsible */}
      {response.citations.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="ml-14"
        >
          <details className="group">
            <summary className="flex items-center gap-2 cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                <span>
                  Based on {response.citations.length} source{response.citations.length !== 1 ? "s" : ""}
                </span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 space-y-2">
              {response.citations.map((citation, i) => (
                <button
                  key={citation.id}
                  type="button"
                  onClick={() => onCitationClick(citation.threadId)}
                  className="flex items-start gap-3 w-full text-left p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 hover:border-purple-500/30 transition-all"
                >
                  <span className="flex items-center justify-center h-5 w-5 rounded-md bg-purple-500/10 text-purple-500 text-[10px] font-bold shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{citation.source}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      "{citation.text}"
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </button>
              ))}
            </div>
          </details>
        </motion.div>
      )}

      {/* Follow-up Questions - More conversational style */}
      {response.followUpQuestions && response.followUpQuestions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="ml-14 pt-2"
        >
          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Continue the conversation
          </p>
          <div className="flex flex-wrap gap-2">
            {response.followUpQuestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onFollowUp(q)}
                className={cn(
                  "text-sm px-3 py-1.5 rounded-full border",
                  "bg-background hover:bg-purple-500/5 hover:border-purple-500/30",
                  "transition-all duration-200",
                  "text-left max-w-xs truncate"
                )}
              >
                {q}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Inline citation component
function InlineCitation({
  index,
  citation,
  isExpanded,
  onToggle,
  onClick,
}: {
  index: number;
  citation: { id: string; text: string; source: string; threadId?: string };
  isExpanded: boolean;
  onToggle: () => void;
  onClick: () => void;
}) {
  return (
    <span className="inline-flex items-center group">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "inline-flex items-center justify-center h-4 w-4 rounded-sm text-[10px] font-bold",
          "bg-purple-500/10 text-purple-600 hover:bg-purple-500/20",
          "transition-colors cursor-pointer align-super ml-0.5"
        )}
      >
        {index}
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.span
            initial={{ opacity: 0, scale: 0.9, width: 0 }}
            animate={{ opacity: 1, scale: 1, width: "auto" }}
            exit={{ opacity: 0, scale: 0.9, width: 0 }}
            className="inline-flex items-center ml-1 overflow-hidden"
          >
            <button
              type="button"
              onClick={onClick}
              className="text-xs text-purple-600 hover:text-purple-700 hover:underline truncate max-w-[200px]"
            >
              {citation.source}
            </button>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const level = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const colors = {
    high: "bg-green-500/10 text-green-600 border-green-500/30",
    medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    low: "bg-red-500/10 text-red-600 border-red-500/30",
  };

  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", colors[level])}>
      {Math.round(confidence * 100)}%
    </span>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function getModePrefix(mode: CommandMode): string {
  switch (mode) {
    case "ask":
      return "? ";
    case "navigate":
      return "> ";
    case "action":
      return "! ";
    default:
      return "";
  }
}

function getPlaceholder(mode: CommandMode): string {
  switch (mode) {
    case "ask":
      return "Ask a question about your emails...";
    case "navigate":
      return "Navigate to...";
    case "action":
      return "Execute an action...";
    default:
      return "Search emails, commitments, decisions...";
  }
}

// Generate follow-up questions based on the original query and answer
function generateFollowUpQuestions(originalQuery: string, answer: string): string[] {
  const questions: string[] = [];
  const queryLower = originalQuery.toLowerCase();
  const answerLower = answer.toLowerCase();

  // Detect question patterns and generate relevant follow-ups
  if (queryLower.includes("when") || queryLower.includes("date")) {
    questions.push("What else happened around that time?");
    questions.push("Who else was involved?");
  }

  if (queryLower.includes("who") || queryLower.includes("person")) {
    questions.push("What commitments do they have with me?");
    questions.push("When did we last communicate?");
  }

  if (queryLower.includes("project") || queryLower.includes("deal")) {
    questions.push("What are the key milestones?");
    questions.push("Who are the stakeholders?");
  }

  if (queryLower.includes("commitment") || queryLower.includes("promise")) {
    questions.push("Are there any overdue items?");
    questions.push("What's the timeline?");
  }

  if (queryLower.includes("decision")) {
    questions.push("What led to this decision?");
    questions.push("Who approved it?");
  }

  // Detect context from the answer
  if (answerLower.includes("meeting") || answerLower.includes("call")) {
    questions.push("What was discussed in the meeting?");
  }

  if (answerLower.includes("deadline") || answerLower.includes("due")) {
    questions.push("What are my upcoming deadlines?");
  }

  if (answerLower.includes("agreed") || answerLower.includes("confirmed")) {
    questions.push("Is there anything pending on this?");
  }

  // Generic follow-ups if we don't have enough
  if (questions.length < 2) {
    questions.push("Tell me more about this");
    questions.push("What should I do next?");
  }

  // Return max 3 unique questions
  return [...new Set(questions)].slice(0, 3);
}
