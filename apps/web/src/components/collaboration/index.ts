// =============================================================================
// COLLABORATION COMPONENTS
// =============================================================================
//
// Export all collaboration UI components for team features.
//

// Activity feed
export { ActivityFeed, ActivitySidebar } from "./activity-feed";
// Comments
export { CommentThread } from "./comment-thread";
// Delegation / Assignment
export {
  DelegationDialog,
  type DelegationType,
  QuickAssignButton,
} from "./delegation-dialog";
// List item viewers (for list views)
export {
  ListItemViewers,
  useListViewers,
} from "./list-item-viewers";
// Mention input
export {
  type MentionData,
  MentionInput,
  type MentionInputRef,
  type MentionSuggestion,
} from "./mention-input";
// Presence indicators
export {
  AvatarStack,
  PresenceAvatar,
  PresenceIndicator,
  type PresenceStatus,
} from "./presence-indicator";
// Presence provider (wrap app with this for real-time presence)
export { ConnectionStatus, PresenceProvider } from "./presence-provider";

// Team presence panel
export {
  OnlineUsersBadge,
  TeamPresencePanel,
} from "./team-presence-panel";
// Resource viewers
export {
  TypingIndicator,
  WhoIsViewing,
  WhoIsViewingBadge,
} from "./who-is-viewing";
