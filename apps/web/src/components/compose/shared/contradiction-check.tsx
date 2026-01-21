// =============================================================================
// CONTRADICTION CHECK (Re-exports)
// =============================================================================
//
// Re-exports contradiction checking components for use in compose flows.
// The actual implementations are in separate files at the compose root level.
//

export {
  ContradictionWarning,
  type Contradiction,
  type ContradictionCheckResult,
} from "../contradiction-warning";

export {
  ContradictionAlert,
  type Contradiction as ContradictionAlertItem,
  type ContradictionAlertProps,
} from "../contradiction-alert";
