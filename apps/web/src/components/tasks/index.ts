// =============================================================================
// TASK COMPONENTS BARREL EXPORT
// =============================================================================

// Activity feed (removed for now)
// Assignee dropdown (removed for now)
// Kanban board
export { KanbanCard, TaskKanbanBoard } from "./task-kanban-board";
// Labels (removed for now)
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
