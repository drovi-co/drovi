// =============================================================================
// AI ASSIST PANEL
// =============================================================================
//
// Shared AI assistance UI for composing messages across all sources.
// Supports draft generation, refinement, and placeholder replacement.
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTRPC } from "@/utils/trpc";

import type { SourceType } from "../compose-provider";

// =============================================================================
// TYPES
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

interface AIAssistPanelProps {
  /** Current source type - affects tone suggestions */
  sourceType: SourceType;
  /** Organization ID for API calls */
  organizationId: string;
  /** Current body content */
  body: string;
  /** Current subject (for email) */
  subject?: string;
  /** Reply thread ID (for context-aware generation) */
  replyToThreadId?: string;
  /** First recipient name (for personalization) */
  recipientName?: string;
  /** Callback when AI generates content */
  onBodyChange: (body: string) => void;
  /** Callback when AI suggests a subject */
  onSubjectChange?: (subject: string) => void;
  /** Whether the panel is open */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extracts subject line from AI draft text.
 * Handles formats like "Subject: Foo" at the start of the body.
 */
function extractSubjectFromBody(body: string): {
  subject: string | null;
  cleanBody: string;
} {
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
 */
function generateAvailabilitySlots(
  workingHours?: AISettings["workingHours"]
): string[] {
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
        const dateStr = date.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
        });

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

  const [startHour] = start.split(":").map(Number);
  const [endHour] = end.split(":").map(Number);

  const suggestedHours = [
    startHour + 1,
    Math.floor((startHour + endHour) / 2),
    endHour - 2,
  ].filter((h) => h >= (startHour ?? 9) && h < (endHour ?? 17));

  for (let i = 1; i <= 14 && slots.length < 3; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dayOfWeek = date.getDay();

    if (workDays.includes(dayOfWeek)) {
      const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
      const dateStr = date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      });

      const hourIdx = slots.length % suggestedHours.length;
      const hour = suggestedHours[hourIdx] ?? 10;
      const timeStr =
        hour >= 12 ? `${hour === 12 ? 12 : hour - 12}:00 PM` : `${hour}:00 AM`;

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
    result = result.replace(
      /\[Calendar Link\]/gi,
      settings.calendarBookingLink
    );
    result = result.replace(/\[Booking Link\]/gi, settings.calendarBookingLink);
    result = result.replace(/\[Calendly\]/gi, settings.calendarBookingLink);
    result = result.replace(
      /\[Schedule Link\]/gi,
      settings.calendarBookingLink
    );
  }

  // Sign-off placeholder
  if (settings.signOff) {
    result = result.replace(/\[Your Sign-off\]/gi, settings.signOff);
    result = result.replace(
      /Best regards,?\n?\[Your Name\]/gi,
      `${settings.signOff},\n${settings.userName ?? "[Your Name]"}`
    );
  }

  // Signature placeholder
  if (settings.signature) {
    result = result.replace(/\[Your Signature\]/gi, settings.signature);
    result = result.replace(/\[Signature\]/gi, settings.signature);
  }

  // Availability placeholders
  const availabilityPattern = /- \[Day,?\s*Date\]\s*at\s*\[Time\]/gi;
  const matches = result.match(availabilityPattern);

  if (matches && matches.length > 0) {
    const slots = generateAvailabilitySlots(settings.workingHours);
    let matchIndex = 0;
    result = result.replace(availabilityPattern, () => {
      const slot = slots[matchIndex % slots.length];
      matchIndex++;
      return slot
        ? `- ${slot}`
        : "- [Please check my calendar for availability]";
    });
  }

  return result;
}

/**
 * Get tone suggestion based on source type
 */
function getToneSuggestion(sourceType: SourceType): string {
  switch (sourceType) {
    case "slack":
      return "casual and conversational";
    case "whatsapp":
      return "brief and friendly";
    default:
      return "professional";
  }
}

/**
 * Get placeholder text based on context
 */
function getPlaceholderText(
  sourceType: SourceType,
  hasThread: boolean
): string {
  if (hasThread) {
    switch (sourceType) {
      case "slack":
        return "e.g., Agree and suggest we sync tomorrow";
      case "whatsapp":
        return "e.g., Confirm the time and location";
      default:
        return "e.g., Accept the meeting but suggest Tuesday instead";
    }
  }

  switch (sourceType) {
    case "slack":
      return "e.g., Ask the team about the project status";
    case "whatsapp":
      return "e.g., Check if they're available for a call";
    default:
      return "e.g., Introduce myself and ask for a meeting";
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AIAssistPanel({
  sourceType,
  organizationId,
  body,
  subject,
  replyToThreadId,
  recipientName,
  onBodyChange,
  onSubjectChange,
  open: controlledOpen,
  onOpenChange,
}: AIAssistPanelProps) {
  const trpc = useTRPC();
  const [internalOpen, setInternalOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  // Fetch AI settings for placeholder replacement
  const { data: aiSettings } = useQuery({
    ...trpc.user.getAISettings.queryOptions(),
  });

  // Process AI response
  const processAIResponse = useCallback(
    (draftBody: string, draftSubject?: string) => {
      let processedBody = draftBody;

      // Extract subject if provided in the draft
      if (draftSubject && onSubjectChange && !subject) {
        onSubjectChange(draftSubject);
      }

      // Also check if subject is embedded in the body text
      const { subject: extractedSubject, cleanBody } =
        extractSubjectFromBody(processedBody);
      if (extractedSubject && onSubjectChange && !subject) {
        onSubjectChange(extractedSubject);
        processedBody = cleanBody;
      }

      // Replace placeholders with user settings
      if (aiSettings) {
        processedBody = replacePlaceholders(processedBody, aiSettings);
      }

      onBodyChange(processedBody);
      setIsOpen(false);
      setPrompt("");
    },
    [aiSettings, onBodyChange, onSubjectChange, subject, setIsOpen]
  );

  // AI Generate Draft mutation (for replies with thread context)
  const generateDraftMutation = useMutation(
    trpc.drafts.generateDraft.mutationOptions({
      onSuccess: (data) => {
        processAIResponse(data.draft.body, data.draft.subject);
        toast.success("Draft generated with AI");
      },
      onError: (error) => {
        toast.error(`AI generation failed: ${error.message}`);
      },
    })
  );

  // AI Refine Draft mutation (for new messages or editing existing)
  const refineDraftMutation = useMutation(
    trpc.drafts.refineDraft.mutationOptions({
      onSuccess: (data) => {
        processAIResponse(data.refinedBody);
        toast.success("Draft refined with AI");
      },
      onError: (error) => {
        toast.error(`AI refinement failed: ${error.message}`);
      },
    })
  );

  const isLoading =
    generateDraftMutation.isPending || refineDraftMutation.isPending;

  // Handle AI assist
  const handleAiAssist = useCallback(() => {
    if (!prompt.trim()) {
      toast.error("Please enter what you want to write");
      return;
    }

    if (replyToThreadId) {
      // Use generateDraft for replies - has full thread context
      generateDraftMutation.mutate({
        organizationId,
        threadId: replyToThreadId,
        userIntent: prompt,
        options: {
          tone: getToneSuggestion(sourceType) as
            | "professional"
            | "casual"
            | "friendly",
          includeGreeting: sourceType === "email",
          includeSignoff: sourceType === "email",
        },
      });
    } else {
      // Use refineDraft for new messages
      refineDraftMutation.mutate({
        organizationId,
        originalDraft:
          body ||
          `Subject: ${subject || "New message"}\n\nWrite about: ${prompt}`,
        feedback: prompt,
        recipientName,
      });
    }
  }, [
    prompt,
    body,
    subject,
    organizationId,
    replyToThreadId,
    recipientName,
    sourceType,
    generateDraftMutation,
    refineDraftMutation,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleAiAssist();
      }
    },
    [handleAiAssist]
  );

  return (
    <Popover
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      }}
      open={isOpen}
    >
      <PopoverTrigger asChild>
        <Button
          className="h-8 w-8"
          size="icon"
          title="AI Assist (Cmd+J)"
          variant="ghost"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">AI Assist</span>
          </div>
          <p className="text-muted-foreground text-xs">
            {replyToThreadId
              ? "Describe how you want to reply and AI will draft it based on the conversation context."
              : "Describe what you want to write and AI will draft it for you."}
          </p>
          <div className="flex gap-2">
            <Input
              className="flex-1 text-sm"
              disabled={isLoading}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={getPlaceholderText(sourceType, !!replyToThreadId)}
              ref={inputRef}
              value={prompt}
            />
            <Button
              disabled={isLoading || !prompt.trim()}
              onClick={handleAiAssist}
              size="sm"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Generate"
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export { replacePlaceholders, extractSubjectFromBody };
