// =============================================================================
// CONSOLE COMPONENTS
// =============================================================================
//
// Datadog-like Console UI components for intelligence querying.
//

export {
  ConsoleSearchBar,
  type ConsoleSearchBarProps,
  type ConsoleSearchBarRef,
} from "./search-bar";

export {
  ConsoleDataTable,
  type ConsoleDataTableProps,
} from "./data-table";

export {
  ConsoleDetailPanel,
  type ConsoleDetailPanelProps,
} from "./detail-panel";

export {
  ConsolePieChart,
  GroupedBarChart,
  TimeHistogram,
  TimeseriesChart,
  TopListChart,
  type GroupedData,
  type PieChartProps,
  type TimeHistogramDataPoint,
  type TimeHistogramProps,
  type TimeseriesChartProps,
  type TimeseriesDataPoint,
  type TopListChartProps,
  type TopListItem,
} from "./charts";
