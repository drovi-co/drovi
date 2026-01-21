// =============================================================================
// COMPOSE PROVIDER
// =============================================================================
//
// Central context for multi-source compose functionality.
// Provides shared state and actions for composing messages across
// Email, Slack, WhatsApp, and other sources.
//

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

// =============================================================================
// TYPES
// =============================================================================

export type SourceType = "email" | "slack" | "whatsapp";

export interface Recipient {
  email: string;
  name?: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  content: string; // Base64 encoded
}

// Email-specific state
export interface EmailComposeState {
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
}

// Slack-specific state (future)
export interface SlackComposeState {
  channelId: string;
  channelName?: string;
  threadTs?: string; // For thread replies
}

// WhatsApp-specific state (future)
export interface WhatsAppComposeState {
  phoneNumber: string;
  contactName?: string;
}

// Union of all source-specific states
export type SourceSpecificState =
  | { type: "email"; data: EmailComposeState }
  | { type: "slack"; data: SlackComposeState }
  | { type: "whatsapp"; data: WhatsAppComposeState };

// Main compose state
export interface ComposeState {
  // Common fields
  sourceType: SourceType;
  sourceAccountId: string;
  body: string;
  attachments: Attachment[];

  // Reply context (optional)
  replyTo?: {
    conversationId: string;
    messageId?: string;
  };

  // Draft management
  draftId: string | null;
  hasUnsavedChanges: boolean;

  // Source-specific state
  email: EmailComposeState;
  slack: SlackComposeState;
  whatsapp: WhatsAppComposeState;
}

// Actions available to compose components
export interface ComposeActions {
  // Source management
  setSourceType: (type: SourceType) => void;
  setSourceAccountId: (id: string) => void;

  // Common actions
  setBody: (body: string) => void;
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;

  // Email-specific actions
  setEmailTo: (recipients: Recipient[]) => void;
  setEmailCc: (recipients: Recipient[]) => void;
  setEmailBcc: (recipients: Recipient[]) => void;
  setEmailSubject: (subject: string) => void;

  // Slack-specific actions (future)
  setSlackChannel: (channelId: string, channelName?: string) => void;
  setSlackThread: (threadTs?: string) => void;

  // WhatsApp-specific actions (future)
  setWhatsAppPhone: (phoneNumber: string, contactName?: string) => void;

  // Draft management
  setDraftId: (id: string | null) => void;
  markAsChanged: () => void;
  markAsSaved: () => void;

  // Reply context
  setReplyContext: (conversationId: string, messageId?: string) => void;
  clearReplyContext: () => void;

  // Reset
  reset: () => void;
}

// Context type
interface ComposeContextValue {
  state: ComposeState;
  actions: ComposeActions;
}

// =============================================================================
// INITIAL STATE
// =============================================================================

const initialEmailState: EmailComposeState = {
  to: [],
  cc: [],
  bcc: [],
  subject: "",
};

const initialSlackState: SlackComposeState = {
  channelId: "",
  channelName: undefined,
  threadTs: undefined,
};

const initialWhatsAppState: WhatsAppComposeState = {
  phoneNumber: "",
  contactName: undefined,
};

const createInitialState = (
  sourceType: SourceType = "email",
  sourceAccountId = ""
): ComposeState => ({
  sourceType,
  sourceAccountId,
  body: "",
  attachments: [],
  replyTo: undefined,
  draftId: null,
  hasUnsavedChanges: false,
  email: { ...initialEmailState },
  slack: { ...initialSlackState },
  whatsapp: { ...initialWhatsAppState },
});

// =============================================================================
// CONTEXT
// =============================================================================

const ComposeContext = createContext<ComposeContextValue | null>(null);

// =============================================================================
// PROVIDER
// =============================================================================

interface ComposeProviderProps {
  children: ReactNode;
  initialSourceType?: SourceType;
  initialSourceAccountId?: string;
  initialEmailState?: Partial<EmailComposeState>;
  initialBody?: string;
  replyToConversationId?: string;
  replyToMessageId?: string;
}

export function ComposeProvider({
  children,
  initialSourceType = "email",
  initialSourceAccountId = "",
  initialEmailState: initialEmail,
  initialBody = "",
  replyToConversationId,
  replyToMessageId,
}: ComposeProviderProps) {
  const [state, setState] = useState<ComposeState>(() => {
    const initial = createInitialState(
      initialSourceType,
      initialSourceAccountId
    );

    // Apply initial email state if provided
    if (initialEmail) {
      initial.email = { ...initial.email, ...initialEmail };
    }

    // Apply initial body
    if (initialBody) {
      initial.body = initialBody;
    }

    // Apply reply context
    if (replyToConversationId) {
      initial.replyTo = {
        conversationId: replyToConversationId,
        messageId: replyToMessageId,
      };
    }

    return initial;
  });

  // ==========================================================================
  // ACTIONS
  // ==========================================================================

  const setSourceType = useCallback((type: SourceType) => {
    setState((prev) => ({ ...prev, sourceType: type }));
  }, []);

  const setSourceAccountId = useCallback((id: string) => {
    setState((prev) => ({ ...prev, sourceAccountId: id }));
  }, []);

  const setBody = useCallback((body: string) => {
    setState((prev) => ({ ...prev, body, hasUnsavedChanges: true }));
  }, []);

  const addAttachment = useCallback((attachment: Attachment) => {
    setState((prev) => ({
      ...prev,
      attachments: [...prev.attachments, attachment],
      hasUnsavedChanges: true,
    }));
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((a) => a.id !== id),
      hasUnsavedChanges: true,
    }));
  }, []);

  const clearAttachments = useCallback(() => {
    setState((prev) => ({ ...prev, attachments: [], hasUnsavedChanges: true }));
  }, []);

  // Email actions
  const setEmailTo = useCallback((recipients: Recipient[]) => {
    setState((prev) => ({
      ...prev,
      email: { ...prev.email, to: recipients },
      hasUnsavedChanges: true,
    }));
  }, []);

  const setEmailCc = useCallback((recipients: Recipient[]) => {
    setState((prev) => ({
      ...prev,
      email: { ...prev.email, cc: recipients },
      hasUnsavedChanges: true,
    }));
  }, []);

  const setEmailBcc = useCallback((recipients: Recipient[]) => {
    setState((prev) => ({
      ...prev,
      email: { ...prev.email, bcc: recipients },
      hasUnsavedChanges: true,
    }));
  }, []);

  const setEmailSubject = useCallback((subject: string) => {
    setState((prev) => ({
      ...prev,
      email: { ...prev.email, subject },
      hasUnsavedChanges: true,
    }));
  }, []);

  // Slack actions
  const setSlackChannel = useCallback(
    (channelId: string, channelName?: string) => {
      setState((prev) => ({
        ...prev,
        slack: { ...prev.slack, channelId, channelName },
        hasUnsavedChanges: true,
      }));
    },
    []
  );

  const setSlackThread = useCallback((threadTs?: string) => {
    setState((prev) => ({
      ...prev,
      slack: { ...prev.slack, threadTs },
      hasUnsavedChanges: true,
    }));
  }, []);

  // WhatsApp actions
  const setWhatsAppPhone = useCallback(
    (phoneNumber: string, contactName?: string) => {
      setState((prev) => ({
        ...prev,
        whatsapp: { ...prev.whatsapp, phoneNumber, contactName },
        hasUnsavedChanges: true,
      }));
    },
    []
  );

  // Draft management
  const setDraftId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, draftId: id }));
  }, []);

  const markAsChanged = useCallback(() => {
    setState((prev) => ({ ...prev, hasUnsavedChanges: true }));
  }, []);

  const markAsSaved = useCallback(() => {
    setState((prev) => ({ ...prev, hasUnsavedChanges: false }));
  }, []);

  // Reply context
  const setReplyContext = useCallback(
    (conversationId: string, messageId?: string) => {
      setState((prev) => ({
        ...prev,
        replyTo: { conversationId, messageId },
      }));
    },
    []
  );

  const clearReplyContext = useCallback(() => {
    setState((prev) => ({ ...prev, replyTo: undefined }));
  }, []);

  // Reset
  const reset = useCallback(() => {
    setState(createInitialState(initialSourceType, initialSourceAccountId));
  }, [initialSourceType, initialSourceAccountId]);

  // ==========================================================================
  // CONTEXT VALUE
  // ==========================================================================

  const actions: ComposeActions = useMemo(
    () => ({
      setSourceType,
      setSourceAccountId,
      setBody,
      addAttachment,
      removeAttachment,
      clearAttachments,
      setEmailTo,
      setEmailCc,
      setEmailBcc,
      setEmailSubject,
      setSlackChannel,
      setSlackThread,
      setWhatsAppPhone,
      setDraftId,
      markAsChanged,
      markAsSaved,
      setReplyContext,
      clearReplyContext,
      reset,
    }),
    [
      setSourceType,
      setSourceAccountId,
      setBody,
      addAttachment,
      removeAttachment,
      clearAttachments,
      setEmailTo,
      setEmailCc,
      setEmailBcc,
      setEmailSubject,
      setSlackChannel,
      setSlackThread,
      setWhatsAppPhone,
      setDraftId,
      markAsChanged,
      markAsSaved,
      setReplyContext,
      clearReplyContext,
      reset,
    ]
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return (
    <ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>
  );
}

// =============================================================================
// HOOK
// =============================================================================

export function useCompose(): ComposeContextValue {
  const context = useContext(ComposeContext);
  if (!context) {
    throw new Error("useCompose must be used within a ComposeProvider");
  }
  return context;
}

// =============================================================================
// UTILITY HOOKS
// =============================================================================

/** Hook to get just the compose state */
export function useComposeState(): ComposeState {
  const { state } = useCompose();
  return state;
}

/** Hook to get just the compose actions */
export function useComposeActions(): ComposeActions {
  const { actions } = useCompose();
  return actions;
}

/** Hook to get email-specific state */
export function useEmailCompose() {
  const { state, actions } = useCompose();
  return {
    ...state.email,
    body: state.body,
    attachments: state.attachments,
    setTo: actions.setEmailTo,
    setCc: actions.setEmailCc,
    setBcc: actions.setEmailBcc,
    setSubject: actions.setEmailSubject,
    setBody: actions.setBody,
    addAttachment: actions.addAttachment,
    removeAttachment: actions.removeAttachment,
  };
}

/** Hook to check if compose has content */
export function useHasComposeContent(): boolean {
  const { state } = useCompose();

  switch (state.sourceType) {
    case "email":
      return (
        state.email.to.length > 0 ||
        state.email.subject.length > 0 ||
        state.body.length > 0 ||
        state.attachments.length > 0
      );
    case "slack":
      return state.slack.channelId.length > 0 || state.body.length > 0;
    case "whatsapp":
      return state.whatsapp.phoneNumber.length > 0 || state.body.length > 0;
    default:
      return false;
  }
}
