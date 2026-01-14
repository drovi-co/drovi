// =============================================================================
// DASHBOARDS COMPONENTS INDEX
// =============================================================================

export { CommitmentCard, type CommitmentCardData } from "./commitment-card";
export { CommitmentDetailSheet, type CommitmentDetailData } from "./commitment-detail-sheet";
export { CommitmentTimeline } from "./commitment-timeline";
export { CommitmentHistoryTimeline, CompactTimeline } from "./commitment-history-timeline";
export type { TimelineEvent, TimelineEventType, CommitmentHistoryTimelineProps } from "./commitment-history-timeline";
export { DecisionCard, type DecisionCardData } from "./decision-card";
export { DecisionDetailSheet, type DecisionDetailData } from "./decision-detail-sheet";
export { ContactCard, type ContactCardData } from "./contact-card";
export {
  StatCard,
  StatsGrid,
  CommitmentStats,
  DecisionStats,
  ContactStats,
} from "./stats-cards";
export {
  CommitmentTrendChart,
  DecisionCategoryChart,
  RelationshipHealthChart,
  CommunicationVolumeChart,
  Sparkline,
  generateSampleCommitmentTrendData,
  generateSampleCommunicationData,
} from "./analytics-charts";
