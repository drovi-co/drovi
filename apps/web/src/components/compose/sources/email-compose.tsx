// =============================================================================
// EMAIL COMPOSE
// =============================================================================
//
// Email-specific compose fields: To, Cc, Bcc, Subject.
// Integrates with compose-provider for state management.
//

import { ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useCompose } from "../compose-provider";
import { type Recipient, RecipientField } from "../recipient-field";

// =============================================================================
// TYPES
// =============================================================================

interface EmailComposeProps {
  /** Organization ID for contact search */
  organizationId: string;
  /** Whether to show Cc/Bcc by default */
  showCcBccByDefault?: boolean;
  /** Optional callback when recipients change */
  onRecipientsChange?: (
    to: Recipient[],
    cc: Recipient[],
    bcc: Recipient[]
  ) => void;
  /** Custom class name */
  className?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function EmailCompose({
  organizationId,
  showCcBccByDefault = false,
  onRecipientsChange,
  className,
}: EmailComposeProps) {
  const { state, actions } = useCompose();
  const [showCcBcc, setShowCcBcc] = useState(
    showCcBccByDefault ||
      state.email.cc.length > 0 ||
      state.email.bcc.length > 0
  );

  // Handlers that sync with provider
  const handleToChange = useCallback(
    (recipients: Recipient[]) => {
      actions.setEmailTo(recipients);
      onRecipientsChange?.(recipients, state.email.cc, state.email.bcc);
    },
    [actions, onRecipientsChange, state.email.cc, state.email.bcc]
  );

  const handleCcChange = useCallback(
    (recipients: Recipient[]) => {
      actions.setEmailCc(recipients);
      onRecipientsChange?.(state.email.to, recipients, state.email.bcc);
    },
    [actions, onRecipientsChange, state.email.to, state.email.bcc]
  );

  const handleBccChange = useCallback(
    (recipients: Recipient[]) => {
      actions.setEmailBcc(recipients);
      onRecipientsChange?.(state.email.to, state.email.cc, recipients);
    },
    [actions, onRecipientsChange, state.email.to, state.email.cc]
  );

  const handleSubjectChange = useCallback(
    (subject: string) => {
      actions.setEmailSubject(subject);
    },
    [actions]
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {/* To Field */}
      <RecipientField
        label="To"
        onRecipientsChange={handleToChange}
        organizationId={organizationId}
        recipients={state.email.to}
      />

      {/* CC/BCC Toggle */}
      {!showCcBcc && (
        <button
          className="flex items-center gap-1 border-b px-4 py-2 text-muted-foreground text-sm hover:bg-muted/30"
          onClick={() => setShowCcBcc(true)}
          type="button"
        >
          <ChevronDown className="h-3 w-3" />
          Add Cc/Bcc
        </button>
      )}

      {/* CC Field */}
      {showCcBcc && (
        <RecipientField
          label="Cc"
          onRecipientsChange={handleCcChange}
          organizationId={organizationId}
          recipients={state.email.cc}
        />
      )}

      {/* BCC Field */}
      {showCcBcc && (
        <RecipientField
          label="Bcc"
          onRecipientsChange={handleBccChange}
          organizationId={organizationId}
          recipients={state.email.bcc}
        />
      )}

      {/* Subject */}
      <div className="border-b px-4 py-3">
        <Input
          className="border-0 p-0 text-base shadow-none focus-visible:ring-0"
          onChange={(e) => handleSubjectChange(e.target.value)}
          placeholder="Subject"
          value={state.email.subject}
        />
      </div>
    </div>
  );
}

// =============================================================================
// STANDALONE EMAIL FIELDS (for use outside provider)
// =============================================================================

interface StandaloneEmailFieldsProps {
  /** Organization ID for contact search */
  organizationId: string;
  /** Current recipients */
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  /** Callbacks */
  onToChange: (recipients: Recipient[]) => void;
  onCcChange: (recipients: Recipient[]) => void;
  onBccChange: (recipients: Recipient[]) => void;
  onSubjectChange: (subject: string) => void;
  /** Whether to show Cc/Bcc by default */
  showCcBccByDefault?: boolean;
  /** Custom class name */
  className?: string;
}

export function StandaloneEmailFields({
  organizationId,
  to,
  cc,
  bcc,
  subject,
  onToChange,
  onCcChange,
  onBccChange,
  onSubjectChange,
  showCcBccByDefault = false,
  className,
}: StandaloneEmailFieldsProps) {
  const [showCcBcc, setShowCcBcc] = useState(
    showCcBccByDefault || cc.length > 0 || bcc.length > 0
  );

  return (
    <div className={cn("flex flex-col", className)}>
      {/* To Field */}
      <RecipientField
        label="To"
        onRecipientsChange={onToChange}
        organizationId={organizationId}
        recipients={to}
      />

      {/* CC/BCC Toggle */}
      {!showCcBcc && (
        <button
          className="flex items-center gap-1 border-b px-4 py-2 text-muted-foreground text-sm hover:bg-muted/30"
          onClick={() => setShowCcBcc(true)}
          type="button"
        >
          <ChevronDown className="h-3 w-3" />
          Add Cc/Bcc
        </button>
      )}

      {/* CC Field */}
      {showCcBcc && (
        <RecipientField
          label="Cc"
          onRecipientsChange={onCcChange}
          organizationId={organizationId}
          recipients={cc}
        />
      )}

      {/* BCC Field */}
      {showCcBcc && (
        <RecipientField
          label="Bcc"
          onRecipientsChange={onBccChange}
          organizationId={organizationId}
          recipients={bcc}
        />
      )}

      {/* Subject */}
      <div className="border-b px-4 py-3">
        <Input
          className="border-0 p-0 text-base shadow-none focus-visible:ring-0"
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder="Subject"
          value={subject}
        />
      </div>
    </div>
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export type { EmailComposeProps, StandaloneEmailFieldsProps };
