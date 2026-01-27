// =============================================================================
// COLLABORATION COMPONENTS
// =============================================================================
//
// Export all collaboration UI components for team features.
//

// Presence provider (wrap app with this for real-time presence)
export { PresenceProvider, ConnectionStatus } from "./presence-provider";

// Presence indicators
export {
  PresenceIndicator,
  PresenceAvatar,
  AvatarStack,
  type PresenceStatus,
} from "./presence-indicator";

// Resource viewers
export {
  WhoIsViewing,
  WhoIsViewingBadge,
  TypingIndicator,
} from "./who-is-viewing";

// Mention input
export {
  MentionInput,
  type MentionInputRef,
  type MentionSuggestion,
  type MentionData,
} from "./mention-input";

// Comments
export { CommentThread } from "./comment-thread";

// Activity feed
export { ActivityFeed, ActivitySidebar } from "./activity-feed";

// Delegation / Assignment
export {
  DelegationDialog,
  QuickAssignButton,
  type DelegationType,
} from "./delegation-dialog";

// Team presence panel
export {
  TeamPresencePanel,
  OnlineUsersBadge,
} from "./team-presence-panel";

// List item viewers (for list views)
export {
  useListViewers,
  ListItemViewers,
} from "./list-item-viewers";
