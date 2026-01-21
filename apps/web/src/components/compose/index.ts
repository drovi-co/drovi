// =============================================================================
// COMPOSE MODULE EXPORTS
// =============================================================================
//
// Central export point for the multi-source compose system.
//

// Main dialog
export { ComposeDialog } from "./compose-dialog";
// Provider and context
export {
  type Attachment,
  type ComposeActions,
  ComposeProvider,
  type ComposeState,
  type EmailComposeState,
  type Recipient,
  type SlackComposeState,
  type SourceType,
  useCompose,
  useComposeActions,
  useComposeState,
  useEmailCompose,
  useHasComposeContent,
  type WhatsAppComposeState,
} from "./compose-provider";
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
export {
  type Recipient as RecipientFieldRecipient,
  RecipientField,
} from "./recipient-field";
// Shared components
export {
  AIAssistPanel,
  extractSubjectFromBody,
  replacePlaceholders,
} from "./shared/ai-assist-panel";
export {
  ATTACHMENT_LIMITS,
  AttachmentButton,
  AttachmentList,
  AttachmentZone,
  formatFileSize,
  getFileIcon,
} from "./shared/attachment-zone";
// Source-specific components
export { EmailCompose, StandaloneEmailFields } from "./sources/email-compose";
export {
  SOURCE_CONFIGS,
  SourceIndicator,
  SourceSelector,
} from "./sources/source-selector";
