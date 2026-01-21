// =============================================================================
// CONTRADICTION CHECK (Re-exports)
// =============================================================================
//
// Re-exports contradiction checking components for use in compose flows.
// The actual implementations are in separate files at the compose root level.
//

export {
  type Contradiction as ContradictionAlertItem,
  ContradictionAlert,
  type ContradictionAlertProps,
} from "../contradiction-alert";
export {
  type Contradiction,
  type ContradictionCheckResult,
  ContradictionWarning,
} from "../contradiction-warning";
