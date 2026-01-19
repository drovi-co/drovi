// =============================================================================
// TASK COMPONENTS BARREL EXPORT
// =============================================================================

// Types and constants
export * from "./task-types";

// Kanban board
export { TaskKanbanBoard, KanbanCard } from "./task-kanban-board";

// Dropdowns
export {
  TaskStatusDropdown,
  TaskStatusBadge,
} from "./task-status-dropdown";

export {
  TaskPriorityDropdown,
  TaskPriorityIndicator,
} from "./task-priority-dropdown";

export {
  TaskAssigneeDropdown,
  TaskAssigneeAvatar,
} from "./task-assignee-dropdown";

// Labels
export {
  TaskLabelBadge,
  TaskLabelPicker,
  TaskLabelsDisplay,
} from "./task-labels";

// Activity feed
export {
  TaskActivityFeed,
  CompactActivityFeed,
} from "./task-activity-feed";

// Virtualized list (for performance)
export { TaskVirtualList } from "./task-virtual-list";
