// =============================================================================
// COMPOSE MODULE EXPORTS
// =============================================================================
//
// Central export point for the multi-source compose system.
//

// Provider and context
export {
  ComposeProvider,
  useCompose,
  useComposeState,
  useComposeActions,
  useEmailCompose,
  useHasComposeContent,
  type SourceType,
  type Recipient,
  type Attachment,
  type ComposeState,
  type ComposeActions,
  type EmailComposeState,
  type SlackComposeState,
  type WhatsAppComposeState,
} from "./compose-provider";

// Main dialog
export { ComposeDialog } from "./compose-dialog";

// Source-specific components
export { EmailCompose, StandaloneEmailFields } from "./sources/email-compose";
export { SourceSelector, SourceIndicator, SOURCE_CONFIGS } from "./sources/source-selector";

// Shared components
export { AIAssistPanel, replacePlaceholders, extractSubjectFromBody } from "./shared/ai-assist-panel";
export {
  AttachmentZone,
  AttachmentButton,
  AttachmentList,
  ATTACHMENT_LIMITS,
  formatFileSize,
  getFileIcon,
} from "./shared/attachment-zone";

// Contradiction components
export {
  type Contradiction,
  ContradictionAlert,
  type ContradictionAlertProps,
} from "./contradiction-alert";
export {
  type Contradiction as ContradictionDetail,
  type ContradictionCheckResult,
  ContradictionWarning,
} from "./contradiction-warning";

// Recipient field
export { type Recipient as RecipientFieldRecipient, RecipientField } from "./recipient-field";
