import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/utils/trpc";
import { env } from "@memorystack/env/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// =============================================================================
// AI SETTINGS & PLACEHOLDER REPLACEMENT
// =============================================================================

interface AISettings {
  title?: string;
  company?: string;
  department?: string;
  signature?: string;
  preferredTone?: "formal" | "casual" | "professional" | "friendly";
  signOff?: string;
  phone?: string;
  linkedinUrl?: string;
  calendarBookingLink?: string;
  workingHours?: {
    timezone: string;
    start: string;
    end: string;
    workDays: number[];
  };
  userName?: string | null;
  userEmail?: string | null;
}

/**
 * Extracts subject line from AI draft text.
 * Handles formats like "Subject: Foo" at the start of the body.
 */
function extractSubjectFromBody(body: string): { subject: string | null; cleanBody: string } {
  const lines = body.split("\n");
  const subjectLine = lines[0];

  // Check for "Subject:" prefix (case insensitive)
  const subjectMatch = subjectLine?.match(/^Subject:\s*(.+)$/i);
  if (subjectMatch?.[1]) {
    // Remove the subject line from body
    const cleanBody = lines.slice(1).join("\n").replace(/^\n+/, "");
    return { subject: subjectMatch[1].trim(), cleanBody };
  }

  return { subject: null, cleanBody: body };
}

/**
 * Generate suggested availability slots based on working hours settings.
 * Returns 3 time slots for the next few available work days.
 */
function generateAvailabilitySlots(workingHours?: AISettings["workingHours"]): string[] {
  if (!workingHours) {
    // Default availability if no settings
    const today = new Date();
    const slots: string[] = [];

    for (let i = 1; i <= 7 && slots.length < 3; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dayOfWeek = date.getDay();

      // Default to weekdays only
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
        const dateStr = date.toLocaleDateString("en-US", { month: "long", day: "numeric" });

        // Suggest morning, mid-day, and afternoon slots
        const times = ["10:00 AM", "2:00 PM", "4:00 PM"];
        const timeIdx = slots.length % 3;
        slots.push(`${dayName}, ${dateStr} at ${times[timeIdx]}`);
      }
    }

    return slots;
  }

  const { start, end, workDays } = workingHours;
  const today = new Date();
  const slots: string[] = [];

  // Parse working hours
  const [startHour] = start.split(":").map(Number);
  const [endHour] = end.split(":").map(Number);

  // Generate suggested times within working hours
  const suggestedHours = [
    startHour + 1, // 1 hour after start
    Math.floor((startHour + endHour) / 2), // Mid-day
    endHour - 2, // 2 hours before end
  ].filter((h) => h >= (startHour ?? 9) && h < (endHour ?? 17));

  // Find next available work days
  for (let i = 1; i <= 14 && slots.length < 3; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dayOfWeek = date.getDay();

    if (workDays.includes(dayOfWeek)) {
      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = date.toLocaleDateString("en-US", { month: "long", day: "numeric" });

      // Pick a suggested time
      const hourIdx = slots.length % suggestedHours.length;
      const hour = suggestedHours[hourIdx] ?? 10;
      const timeStr = hour >= 12
        ? `${hour === 12 ? 12 : hour - 12}:00 PM`
        : `${hour}:00 AM`;

      slots.push(`${dayName}, ${dateStr} at ${timeStr}`);
    }
  }

  return slots;
}

/**
 * Replace placeholder text with actual user settings values.
 */
function replacePlaceholders(text: string, settings: AISettings): string {
  let result = text;

  // Name placeholders
  if (settings.userName) {
    result = result.replace(/\[Your Name\]/gi, settings.userName);
    result = result.replace(/\[Your Full Name\]/gi, settings.userName);
    result = result.replace(/\[Name\]/gi, settings.userName);
  }

  // Title/Role placeholders
  if (settings.title) {
    result = result.replace(/\[Your Title\]/gi, settings.title);
    result = result.replace(/\[Your Role\]/gi, settings.title);
    result = result.replace(/\[Your Role\/Title\]/gi, settings.title);
    result = result.replace(/\[Your Position\]/gi, settings.title);
    result = result.replace(/\[Title\]/gi, settings.title);
    result = result.replace(/\[Role\]/gi, settings.title);
  }

  // Company placeholders
  if (settings.company) {
    result = result.replace(/\[Your Company\]/gi, settings.company);
    result = result.replace(/\[Company Name\]/gi, settings.company);
    result = result.replace(/\[Company\]/gi, settings.company);
  }

  // Department placeholders
  if (settings.department) {
    result = result.replace(/\[Your Department\]/gi, settings.department);
    result = result.replace(/\[Department\]/gi, settings.department);
  }

  // Phone placeholders
  if (settings.phone) {
    result = result.replace(/\[Your Phone\]/gi, settings.phone);
    result = result.replace(/\[Phone Number\]/gi, settings.phone);
    result = result.replace(/\[Phone\]/gi, settings.phone);
  }

  // Email placeholders
  if (settings.userEmail) {
    result = result.replace(/\[Your Email\]/gi, settings.userEmail);
    result = result.replace(/\[Email\]/gi, settings.userEmail);
  }

  // LinkedIn placeholders
  if (settings.linkedinUrl) {
    result = result.replace(/\[LinkedIn URL\]/gi, settings.linkedinUrl);
    result = result.replace(/\[Your LinkedIn\]/gi, settings.linkedinUrl);
    result = result.replace(/\[LinkedIn\]/gi, settings.linkedinUrl);
  }

  // Calendar booking link placeholders
  if (settings.calendarBookingLink) {
    result = result.replace(/\[Calendar Link\]/gi, settings.calendarBookingLink);
    result = result.replace(/\[Booking Link\]/gi, settings.calendarBookingLink);
    result = result.replace(/\[Calendly\]/gi, settings.calendarBookingLink);
    result = result.replace(/\[Schedule Link\]/gi, settings.calendarBookingLink);
  }

  // Sign-off placeholder - replace if user has one configured
  if (settings.signOff) {
    // Common AI-generated sign-off placeholders
    result = result.replace(/\[Your Sign-off\]/gi, settings.signOff);
    result = result.replace(/Best regards,?\n?\[Your Name\]/gi,
      `${settings.signOff},\n${settings.userName ?? "[Your Name]"}`);
  }

  // Signature placeholder - insert full signature
  if (settings.signature) {
    result = result.replace(/\[Your Signature\]/gi, settings.signature);
    result = result.replace(/\[Signature\]/gi, settings.signature);
  }

  // Availability placeholders - replace [Day, Date] at [Time] patterns
  // Look for patterns like "- [Day, Date] at [Time]"
  const availabilityPattern = /- \[Day,?\s*Date\]\s*at\s*\[Time\]/gi;
  const matches = result.match(availabilityPattern);

  if (matches && matches.length > 0) {
    const slots = generateAvailabilitySlots(settings.workingHours);

    // Replace each placeholder with actual availability
    let matchIndex = 0;
    result = result.replace(availabilityPattern, () => {
      const slot = slots[matchIndex % slots.length];
      matchIndex++;
      return slot ? `- ${slot}` : "- [Please check my calendar for availability]";
    });
  }

  return result;
}
import {
  ChevronDown,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
  FileIcon,
  ImageIcon,
  FileText,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type Recipient, RecipientField } from "./recipient-field";
import { Badge } from "@/components/ui/badge";

// =============================================================================
// ATTACHMENT TYPES & HELPERS
// =============================================================================

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string; // Base64 encoded
}

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25MB per file
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.includes("pdf") || mimeType.includes("document")) return FileText;
  return FileIcon;
}

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

  // Form state
  const [to, setTo] = useState<Recipient[]>(initialTo);
  const [cc, setCc] = useState<Recipient[]>([]);
  const [bcc, setBcc] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Attachment state
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // AI Assist state
  const [aiPopoverOpen, setAiPopoverOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch reply context if replying
  const { data: replyContext } = useQuery({
    ...trpc.compose.getReplyContext.queryOptions({
      organizationId,
      threadId: replyToThreadId ?? "",
    }),
    enabled: !!replyToThreadId,
  });

  // Fetch AI settings for placeholder replacement
  const { data: aiSettings } = useQuery({
    ...trpc.user.getAISettings.queryOptions(),
  });

  // Apply reply context when loaded
  useEffect(() => {
    if (replyContext) {
      setTo(replyContext.toRecipients);
      setCc(replyContext.ccRecipients);
      setSubject(replyContext.subject ?? "");
      // Don't prefill body with quoted content - keep it clean for typing
      if (replyContext.ccRecipients.length > 0) {
        setShowCcBcc(true);
      }
    }
  }, [replyContext]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      // Only reset after a delay to allow close animation
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
          setShowCcBcc(false);
        }
      }, 200);
      return () => clearTimeout(timer);
    }
    // When dialog opens with initial values (forward), apply them
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
      to.length > 0 || subject.length > 0 || body.length > 0 || attachments.length > 0;
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

  // AI Generate Draft mutation (for replies with thread context)
  const generateDraftMutation = useMutation({
    ...trpc.drafts.generateDraft.mutationOptions(),
    onSuccess: (data) => {
      let draftBody = data.draft.body;

      // Extract subject if provided in the draft
      if (data.draft.subject && !subject) {
        setSubject(data.draft.subject);
      }

      // Also check if subject is embedded in the body text
      const { subject: extractedSubject, cleanBody } = extractSubjectFromBody(draftBody);
      if (extractedSubject && !subject) {
        setSubject(extractedSubject);
        draftBody = cleanBody;
      }

      // Replace placeholders with user settings
      if (aiSettings) {
        draftBody = replacePlaceholders(draftBody, aiSettings);
      }

      setBody(draftBody);
      setAiPopoverOpen(false);
      setAiPrompt("");
      toast.success("Draft generated with AI");
    },
    onError: (error: Error) => {
      toast.error(`AI generation failed: ${error.message}`);
    },
  });

  // AI Refine Draft mutation (for new messages or editing existing)
  const refineDraftMutation = useMutation({
    ...trpc.drafts.refineDraft.mutationOptions(),
    onSuccess: (data) => {
      let draftBody = data.refinedBody;

      // Check if subject is embedded in the body text
      const { subject: extractedSubject, cleanBody } = extractSubjectFromBody(draftBody);
      if (extractedSubject && !subject) {
        setSubject(extractedSubject);
        draftBody = cleanBody;
      }

      // Replace placeholders with user settings
      if (aiSettings) {
        draftBody = replacePlaceholders(draftBody, aiSettings);
      }

      setBody(draftBody);
      setAiPopoverOpen(false);
      setAiPrompt("");
      toast.success("Draft refined with AI");
    },
    onError: (error: Error) => {
      toast.error(`AI refinement failed: ${error.message}`);
    },
  });

  // Handle file selection
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const currentTotalSize = attachments.reduce((sum, a) => sum + a.size, 0);

    for (const file of Array.from(files)) {
      // Check individual file size
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error(`File "${file.name}" exceeds maximum size of 25MB`);
        continue;
      }

      // Check total size
      if (currentTotalSize + file.size > MAX_TOTAL_SIZE) {
        toast.error("Total attachment size exceeds 50MB limit");
        break;
      }

      // Check for duplicates
      if (attachments.some((a) => a.filename === file.name)) {
        toast.error(`File "${file.name}" is already attached`);
        continue;
      }

      // Read file as base64
      try {
        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove data URL prefix (e.g., "data:application/pdf;base64,")
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

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [attachments]);

  // Remove attachment
  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Open file picker
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle send
  const handleSend = useCallback(() => {
    if (to.length === 0) {
      toast.error("Please add at least one recipient");
      return;
    }

    if (!subject.trim()) {
      toast.error("Please enter a subject");
      return;
    }

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
      attachments: attachments.length > 0
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

  // Handle save draft
  const handleSaveDraft = useCallback(() => {
    saveDraftMutation.mutate({
      organizationId,
      accountId,
      to: to.length > 0 ? to : [{ email: "draft@example.com" }], // Placeholder for empty drafts
      cc: cc.length > 0 ? cc : undefined,
      bcc: bcc.length > 0 ? bcc : undefined,
      subject: subject || "(No subject)",
      bodyText: body,
      draftId: draftId ?? undefined,
      replyToThreadId: replyToThreadId ?? undefined,
      attachments: attachments.length > 0
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

  // Handle close with unsaved changes warning
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      // For now, just close. Could add a confirmation dialog
      onOpenChange(false);
    } else {
      onOpenChange(false);
    }
  }, [hasUnsavedChanges, onOpenChange]);

  // Handle AI assist
  const handleAiAssist = useCallback(() => {
    if (!aiPrompt.trim()) {
      toast.error("Please enter what you want to write");
      return;
    }

    const recipientName = to[0]?.name ?? to[0]?.email?.split("@")[0] ?? undefined;

    if (replyToThreadId) {
      // Use generateDraft for replies - has full thread context
      generateDraftMutation.mutate({
        organizationId,
        threadId: replyToThreadId,
        userIntent: aiPrompt,
        options: {
          tone: "professional",
          includeGreeting: true,
          includeSignoff: true,
        },
      });
    } else {
      // Use refineDraft for new messages
      refineDraftMutation.mutate({
        organizationId,
        originalDraft: body || `Subject: ${subject}\n\nWrite an email about: ${aiPrompt}`,
        feedback: aiPrompt,
        recipientName,
      });
    }
  }, [
    aiPrompt,
    to,
    body,
    subject,
    organizationId,
    replyToThreadId,
    generateDraftMutation,
    refineDraftMutation,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Enter = Send
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
        return;
      }

      // Cmd/Ctrl + J = AI Assist
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        setAiPopoverOpen(true);
        setTimeout(() => aiInputRef.current?.focus(), 100);
        return;
      }

      // Cmd/Ctrl + Shift + D = Save Draft
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        handleSaveDraft();
        return;
      }

      // Escape = Close popover or dialog
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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="w-[800px] max-w-[90vw] h-[85vh] max-h-[900px] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-base font-medium">
            {replyToThreadId ? "Reply" : initialSubject?.startsWith("Fwd:") || initialSubject?.startsWith("FW:") ? "Forward" : "New Message"}
          </DialogTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleDiscard}
              disabled={deleteDraftMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Recipients */}
        <RecipientField
          label="To"
          recipients={to}
          onRecipientsChange={setTo}
          organizationId={organizationId}
        />

        {/* CC/BCC Toggle */}
        {!showCcBcc && (
          <button
            type="button"
            onClick={() => setShowCcBcc(true)}
            className="flex items-center gap-1 border-b px-4 py-2 text-muted-foreground text-sm hover:bg-muted/30"
          >
            <ChevronDown className="h-3 w-3" />
            Add Cc/Bcc
          </button>
        )}

        {/* CC Field */}
        {showCcBcc && (
          <RecipientField
            label="Cc"
            recipients={cc}
            onRecipientsChange={setCc}
            organizationId={organizationId}
          />
        )}

        {/* BCC Field */}
        {showCcBcc && (
          <RecipientField
            label="Bcc"
            recipients={bcc}
            onRecipientsChange={setBcc}
            organizationId={organizationId}
          />
        )}

        {/* Subject */}
        <div className="border-b px-4 py-3">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="border-0 p-0 text-base shadow-none focus-visible:ring-0"
          />
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 p-4 overflow-hidden flex flex-col">
          <Textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Compose your email... (Tip: Hit Cmd+J for AI assistance)"
            className="flex-1 min-h-0 resize-none border-0 p-0 shadow-none focus-visible:ring-0"
          />

          {/* Attachments Display */}
          {attachments.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => {
                  const IconComponent = getFileIcon(attachment.mimeType);
                  return (
                    <Badge
                      key={attachment.id}
                      variant="secondary"
                      className="flex items-center gap-1.5 py-1.5 px-2.5 text-xs"
                    >
                      <IconComponent className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="max-w-[150px] truncate">{attachment.filename}</span>
                      <span className="text-muted-foreground">({formatFileSize(attachment.size)})</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(attachment.id)}
                        className="ml-1 hover:bg-muted rounded p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Total: {formatFileSize(attachments.reduce((sum, a) => sum + a.size, 0))}
              </p>
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="*/*"
        />

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSend}
              disabled={sendMutation.isPending || to.length === 0}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {sendMutation.isPending ? "Sending..." : "Send"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSaveDraft}
              disabled={saveDraftMutation.isPending}
            >
              {saveDraftMutation.isPending ? "Saving..." : "Save Draft"}
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Popover open={aiPopoverOpen} onOpenChange={setAiPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="AI Assist (Cmd+J)"
                >
                  {generateDraftMutation.isPending || refineDraftMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">AI Assist</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {replyToThreadId
                      ? "Describe how you want to reply and AI will draft it based on the conversation context."
                      : "Describe what you want to write and AI will draft it for you."}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      ref={aiInputRef}
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder={
                        replyToThreadId
                          ? "e.g., Accept the meeting but suggest Tuesday instead"
                          : "e.g., Introduce myself and ask for a meeting"
                      }
                      className="flex-1 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleAiAssist();
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={handleAiAssist}
                      disabled={generateDraftMutation.isPending || refineDraftMutation.isPending}
                    >
                      {generateDraftMutation.isPending || refineDraftMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Generate"
                      )}
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleAttachClick}
              title="Attach files"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Keyboard shortcuts hint */}
        <div className="border-t bg-muted/30 px-4 py-2 text-muted-foreground text-xs flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <kbd className="rounded border bg-background px-1">⌘↵</kbd> send
          </span>
          <span>
            <kbd className="rounded border bg-background px-1">⌘J</kbd> AI assist
          </span>
          <span>
            <kbd className="rounded border bg-background px-1">⌘⇧D</kbd> save draft
          </span>
          <span>
            <kbd className="rounded border bg-background px-1">Esc</kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
