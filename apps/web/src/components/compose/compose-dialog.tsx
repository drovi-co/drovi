// =============================================================================
// COMPOSE DIALOG
// =============================================================================
//
// Main compose dialog component. Supports email composition with AI assistance,
// attachments, and pre-send contradiction checking.
//
// This is the entry point for compose functionality. It uses:
// - StandaloneEmailFields for email-specific fields (To, Cc, Bcc, Subject)
// - AIAssistPanel for AI-powered drafting
// - AttachmentList for displaying attachments
// - ContradictionWarning for pre-send safety checks
//

import { env } from "@memorystack/env/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Paperclip, Send, Shield, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/utils/trpc";

import {
  type ContradictionCheckResult,
  ContradictionWarning,
} from "./contradiction-warning";
import type { Recipient } from "./recipient-field";
import { AIAssistPanel } from "./shared/ai-assist-panel";
import {
  ATTACHMENT_LIMITS,
  type Attachment,
  AttachmentList,
} from "./shared/attachment-zone";
import { StandaloneEmailFields } from "./sources/email-compose";

// =============================================================================
// API HELPERS
// =============================================================================

const API_BASE = env.VITE_SERVER_URL;

async function sendEmail(data: {
  organizationId: string;
  accountId: string;
  to: Recipient[];
  cc?: Recipient[];
  bcc?: Recipient[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  replyToThreadId?: string;
  inReplyToMessageId?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
    content: string;
  }>;
}) {
  const response = await fetch(`${API_BASE}/api/compose/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to send email");
  }

  return response.json();
}

async function saveDraft(data: {
  organizationId: string;
  accountId: string;
  to: Recipient[];
  cc?: Recipient[];
  bcc?: Recipient[];
  subject: string;
  bodyText?: string;
  draftId?: string;
  replyToThreadId?: string;
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
    content: string;
  }>;
}) {
  const response = await fetch(`${API_BASE}/api/compose/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to save draft");
  }

  return response.json();
}

async function deleteDraft(data: {
  organizationId: string;
  accountId: string;
  draftId: string;
}) {
  const response = await fetch(
    `${API_BASE}/api/compose/draft/${data.accountId}/${data.draftId}?organizationId=${data.organizationId}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete draft");
  }

  return response.json();
}

// =============================================================================
// TYPES
// =============================================================================

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  accountId: string;
  /** Reply context - prefills recipients and subject */
  replyToThreadId?: string;
  /** Optional initial recipients */
  initialTo?: Recipient[];
  /** Optional initial subject */
  initialSubject?: string;
  /** Optional initial body (for forwarding) */
  initialBody?: string;
}

// =============================================================================
// COMPOSE DIALOG
// =============================================================================

export function ComposeDialog({
  open,
  onOpenChange,
  organizationId,
  accountId,
  replyToThreadId,
  initialTo = [],
  initialSubject = "",
  initialBody = "",
}: ComposeDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Form state
  const [to, setTo] = useState<Recipient[]>(initialTo);
  const [cc, setCc] = useState<Recipient[]>([]);
  const [bcc, setBcc] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // AI Assist state
  const [aiPopoverOpen, setAiPopoverOpen] = useState(false);

  // Pre-send contradiction check state
  const [contradictionResult, setContradictionResult] =
    useState<ContradictionCheckResult | null>(null);
  const [showContradictionWarning, setShowContradictionWarning] =
    useState(false);
  const [isCheckingContradictions, setIsCheckingContradictions] =
    useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch reply context if replying
  const { data: replyContext } = useQuery({
    ...trpc.compose.getReplyContext.queryOptions({
      organizationId,
      threadId: replyToThreadId ?? "",
    }),
    enabled: !!replyToThreadId,
  });

  // Apply reply context when loaded
  useEffect(() => {
    if (replyContext) {
      setTo(replyContext.toRecipients);
      setCc(replyContext.ccRecipients);
      setSubject(replyContext.subject ?? "");
    }
  }, [replyContext]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        if (!replyToThreadId) {
          setTo(initialTo);
          setCc([]);
          setBcc([]);
          setSubject(initialSubject);
          setBody(initialBody);
          setAttachments([]);
          setDraftId(null);
          setHasUnsavedChanges(false);
        }
      }, 200);
      return () => clearTimeout(timer);
    }
    if (open && initialSubject) {
      setSubject(initialSubject);
    }
    if (open && initialBody) {
      setBody(initialBody);
    }
  }, [open, replyToThreadId, initialTo, initialSubject, initialBody]);

  // Track unsaved changes
  useEffect(() => {
    const hasContent =
      to.length > 0 ||
      subject.length > 0 ||
      body.length > 0 ||
      attachments.length > 0;
    setHasUnsavedChanges(hasContent);
  }, [to, subject, body, attachments]);

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: sendEmail,
    onSuccess: () => {
      toast.success("Email sent");
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to send: ${error.message}`);
    },
  });

  // Save draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: saveDraft,
    onSuccess: (data: { draftId: string }) => {
      setDraftId(data.draftId);
      toast.success("Draft saved");
    },
    onError: (error: Error) => {
      toast.error(`Failed to save draft: ${error.message}`);
    },
  });

  // Delete draft mutation
  const deleteDraftMutation = useMutation({
    mutationFn: deleteDraft,
    onSuccess: () => {
      setDraftId(null);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete draft: ${error.message}`);
    },
  });

  // Pre-send contradiction check mutation
  const checkDraftMutation = useMutation(
    trpc.risk.checkDraft.mutationOptions({
      onSuccess: (data) => {
        const result: ContradictionCheckResult = {
          ...data,
          riskLevel: data.riskLevel as "low" | "medium" | "high" | "critical",
          timestamp: new Date(data.timestamp),
          contradictions: data.contradictions.map((c) => ({
            ...c,
            conflictingDate: new Date(c.conflictingDate),
          })),
        };
        setContradictionResult(result);
        setIsCheckingContradictions(false);

        if (data.contradictions.length > 0) {
          setShowContradictionWarning(true);
        } else {
          performSend();
        }
      },
      onError: (error) => {
        setIsCheckingContradictions(false);
        toast.error(
          `Contradiction check failed: ${error.message}. Proceeding with send.`
        );
        performSend();
      },
    })
  );

  // Handle file selection
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) {
        return;
      }

      const limits = ATTACHMENT_LIMITS.email;
      const currentTotalSize = attachments.reduce((sum, a) => sum + a.size, 0);

      for (const file of Array.from(files)) {
        if (file.size > limits.maxFileSize) {
          toast.error(`File "${file.name}" exceeds maximum size of 25MB`);
          continue;
        }

        if (currentTotalSize + file.size > limits.maxTotalSize) {
          toast.error("Total attachment size exceeds 50MB limit");
          break;
        }

        if (attachments.some((a) => a.filename === file.name)) {
          toast.error(`File "${file.name}" is already attached`);
          continue;
        }

        try {
          const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64 = result.split(",")[1];
              resolve(base64 ?? "");
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const newAttachment: Attachment = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            content,
          };

          setAttachments((prev) => [...prev, newAttachment]);
        } catch {
          toast.error(`Failed to read file "${file.name}"`);
        }
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [attachments]
  );

  // Remove attachment
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Open file picker
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // The actual send function (called after contradiction check passes)
  const performSend = useCallback(() => {
    sendMutation.mutate({
      organizationId,
      accountId,
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject,
      bodyText: body,
      replyToThreadId: replyToThreadId ?? undefined,
      inReplyToMessageId: replyContext?.inReplyToMessageId,
      attachments:
        attachments.length > 0
          ? attachments.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              size: a.size,
              content: a.content,
            }))
          : undefined,
    });
  }, [
    to,
    cc,
    bcc,
    subject,
    body,
    attachments,
    organizationId,
    accountId,
    replyToThreadId,
    replyContext,
    sendMutation,
  ]);

  // Handle send - first check for contradictions, then send
  const handleSend = useCallback(() => {
    if (to.length === 0) {
      toast.error("Please add at least one recipient");
      return;
    }

    if (!subject.trim()) {
      toast.error("Please enter a subject");
      return;
    }

    setShowContradictionWarning(false);
    setContradictionResult(null);
    setIsCheckingContradictions(true);

    checkDraftMutation.mutate({
      organizationId,
      accountId,
      content: body,
      subject,
      recipients: to.map((r) => ({ email: r.email, name: r.name })),
      threadId: replyToThreadId,
    });
  }, [
    to,
    subject,
    body,
    organizationId,
    accountId,
    replyToThreadId,
    checkDraftMutation,
  ]);

  // Handle save draft
  const handleSaveDraft = useCallback(() => {
    saveDraftMutation.mutate({
      organizationId,
      accountId,
      to: to.length > 0 ? to : [{ email: "draft@example.com" }],
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject: subject || "(No subject)",
      bodyText: body,
      draftId: draftId ?? undefined,
      replyToThreadId: replyToThreadId ?? undefined,
      attachments:
        attachments.length > 0
          ? attachments.map((a) => ({
              filename: a.filename,
              mimeType: a.mimeType,
              size: a.size,
              content: a.content,
            }))
          : undefined,
    });
  }, [
    to,
    cc,
    bcc,
    subject,
    body,
    attachments,
    organizationId,
    accountId,
    draftId,
    replyToThreadId,
    saveDraftMutation,
  ]);

  // Handle discard
  const handleDiscard = useCallback(() => {
    if (draftId) {
      deleteDraftMutation.mutate({
        organizationId,
        accountId,
        draftId,
      });
    } else {
      onOpenChange(false);
    }
  }, [draftId, organizationId, accountId, deleteDraftMutation, onOpenChange]);

  // Handle close
  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Handle AI body change
  const handleBodyChange = useCallback((newBody: string) => {
    setBody(newBody);
  }, []);

  // Handle AI subject change
  const handleSubjectChange = useCallback((newSubject: string) => {
    setSubject(newSubject);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setAiPopoverOpen(true);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        handleSaveDraft();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        if (aiPopoverOpen) {
          setAiPopoverOpen(false);
        } else {
          handleClose();
        }
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, aiPopoverOpen, handleSend, handleSaveDraft, handleClose]);

  return (
    <Dialog onOpenChange={handleClose} open={open}>
      <DialogContent
        className="flex h-[85vh] max-h-[900px] w-[800px] max-w-[90vw] flex-col gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle className="font-medium text-base">
            {replyToThreadId
              ? "Reply"
              : initialSubject?.startsWith("Fwd:") ||
                  initialSubject?.startsWith("FW:")
                ? "Forward"
                : "New Message"}
          </DialogTitle>
          <div className="flex items-center gap-1">
            <Button
              className="h-8 w-8"
              disabled={deleteDraftMutation.isPending}
              onClick={handleDiscard}
              size="icon"
              variant="ghost"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Email-specific fields (To, Cc, Bcc, Subject) */}
        <StandaloneEmailFields
          bcc={bcc}
          cc={cc}
          onBccChange={setBcc}
          onCcChange={setCc}
          onSubjectChange={setSubject}
          onToChange={setTo}
          organizationId={organizationId}
          showCcBccByDefault={cc.length > 0 || bcc.length > 0}
          subject={subject}
          to={to}
        />

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          <Textarea
            className="min-h-0 flex-1 resize-none border-0 p-0 shadow-none focus-visible:ring-0"
            onChange={(e) => setBody(e.target.value)}
            placeholder="Compose your email... (Tip: Hit Cmd+J for AI assistance)"
            ref={bodyRef}
            value={body}
          />

          {/* Attachments Display */}
          {attachments.length > 0 && (
            <AttachmentList
              attachments={attachments}
              className="mt-3"
              onRemove={handleRemoveAttachment}
              sourceType="email"
            />
          )}
        </div>

        {/* Hidden file input */}
        <input
          accept="*/*"
          className="hidden"
          multiple
          onChange={handleFileSelect}
          ref={fileInputRef}
          type="file"
        />

        {/* Contradiction Warning - Pre-send safety check */}
        {(showContradictionWarning || isCheckingContradictions) && (
          <div className="border-t bg-muted/30 px-4 py-3">
            <ContradictionWarning
              isLoading={isCheckingContradictions}
              onDismiss={() => {
                setShowContradictionWarning(false);
                setContradictionResult(null);
              }}
              onEditDraft={() => {
                setShowContradictionWarning(false);
                bodyRef.current?.focus();
              }}
              onProceedAnyway={() => {
                setShowContradictionWarning(false);
                performSend();
              }}
              onViewThread={(threadId) => {
                navigate({
                  to: "/dashboard/email/thread/$threadId",
                  params: { threadId },
                });
                onOpenChange(false);
              }}
              result={contradictionResult}
            />
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              className="gap-2"
              disabled={
                sendMutation.isPending ||
                isCheckingContradictions ||
                to.length === 0
              }
              onClick={handleSend}
            >
              {isCheckingContradictions ? (
                <>
                  <Shield className="h-4 w-4 animate-pulse" />
                  Checking...
                </>
              ) : sendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send
                </>
              )}
            </Button>
            <Button
              disabled={saveDraftMutation.isPending}
              onClick={handleSaveDraft}
              size="sm"
              variant="ghost"
            >
              {saveDraftMutation.isPending ? "Saving..." : "Save Draft"}
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <AIAssistPanel
              body={body}
              onBodyChange={handleBodyChange}
              onOpenChange={setAiPopoverOpen}
              onSubjectChange={handleSubjectChange}
              open={aiPopoverOpen}
              organizationId={organizationId}
              recipientName={to[0]?.name ?? to[0]?.email?.split("@")[0]}
              replyToThreadId={replyToThreadId}
              sourceType="email"
              subject={subject}
            />
            <Button
              className="h-8 w-8"
              onClick={handleAttachClick}
              size="icon"
              title="Attach files"
              variant="ghost"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Keyboard shortcuts hint */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t bg-muted/30 px-4 py-2 text-muted-foreground text-xs">
          <span>
            <kbd className="rounded border bg-background px-1">⌘↵</kbd> send
          </span>
          <span>
            <kbd className="rounded border bg-background px-1">⌘J</kbd> AI
            assist
          </span>
          <span>
            <kbd className="rounded border bg-background px-1">⌘⇧D</kbd> save
            draft
          </span>
          <span>
            <kbd className="rounded border bg-background px-1">Esc</kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
