// =============================================================================
// TASK COMPONENTS BARREL EXPORT
// =============================================================================

// Activity feed
export {
  CompactActivityFeed,
  TaskActivityFeed,
} from "./task-activity-feed";
export {
  TaskAssigneeAvatar,
  TaskAssigneeDropdown,
} from "./task-assignee-dropdown";
// Kanban board
export { KanbanCard, TaskKanbanBoard } from "./task-kanban-board";
// Labels
export {
  TaskLabelBadge,
  TaskLabelPicker,
  TaskLabelsDisplay,
} from "./task-labels";
export {
  TaskPriorityDropdown,
  TaskPriorityIndicator,
} from "./task-priority-dropdown";
// Dropdowns
export {
  TaskStatusBadge,
  TaskStatusDropdown,
} from "./task-status-dropdown";
// Types and constants
export * from "./task-types";

// Virtualized list (for performance)
export { TaskVirtualList } from "./task-virtual-list";
