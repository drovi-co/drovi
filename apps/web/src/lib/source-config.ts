// =============================================================================
// SOURCE CONFIGURATION
// =============================================================================
//
// Configuration for all supported data sources in the multi-source intelligence
// platform. This defines visual styling, labels, and capabilities for each source.
//

import {
  Calendar,
  FileText,
  Github,
  Hash,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Mic,
} from "lucide-react";

// =============================================================================
// TYPES
// =============================================================================

export type SourceType =
  | "email"
  | "slack"
  | "calendar"
  | "whatsapp"
  | "notion"
  | "google_docs"
  | "google_sheets"
  | "meeting_transcript"
  | "teams"
  | "discord"
  | "linear"
  | "github";

export interface SourceConfig {
  /** Display icon for the source */
  icon: LucideIcon;
  /** Brand color (hex) */
  color: string;
  /** Human-readable label */
  label: string;
  /** Short description */
  description: string;
  /** Whether OAuth is supported */
  hasOAuth: boolean;
  /** Whether this source is available for connection */
  isAvailable: boolean;
  /** Conversation types this source produces */
  conversationTypes: string[];
}

// =============================================================================
// SOURCE CONFIGURATIONS
// =============================================================================

export const sourceConfigs: Record<SourceType, SourceConfig> = {
  email: {
    icon: Mail,
    color: "#EA4335",
    label: "Email",
    description: "Gmail, Outlook, and other email providers",
    hasOAuth: true,
    isAvailable: true,
    conversationTypes: ["thread"],
  },
  slack: {
    icon: Hash,
    color: "#4A154B",
    label: "Slack",
    description: "Channels, DMs, and threads",
    hasOAuth: true,
    isAvailable: true,
    conversationTypes: ["channel", "dm", "group_dm", "slack_thread"],
  },
  calendar: {
    icon: Calendar,
    color: "#4285F4",
    label: "Calendar",
    description: "Google Calendar, Outlook Calendar",
    hasOAuth: true,
    isAvailable: true,
    conversationTypes: ["event"],
  },
  whatsapp: {
    icon: MessageCircle,
    color: "#25D366",
    label: "WhatsApp",
    description: "WhatsApp Business messaging",
    hasOAuth: true,
    isAvailable: true,
    conversationTypes: ["dm", "chat", "group_chat"],
  },
  notion: {
    icon: FileText,
    color: "#000000",
    label: "Notion",
    description: "Pages, databases, and comments",
    hasOAuth: true,
    isAvailable: true,
    conversationTypes: ["page", "database"],
  },
  google_docs: {
    icon: FileText,
    color: "#4285F4",
    label: "Google Docs",
    description: "Documents and comments",
    hasOAuth: true,
    isAvailable: true,
    conversationTypes: ["document"],
  },
  google_sheets: {
    icon: FileText,
    color: "#0F9D58",
    label: "Google Sheets",
    description: "Spreadsheets and comments",
    hasOAuth: true,
    isAvailable: true,
    conversationTypes: ["spreadsheet"],
  },
  meeting_transcript: {
    icon: Mic,
    color: "#FF6B6B",
    label: "Meetings",
    description: "Transcripts from Zoom, Meet, Teams",
    hasOAuth: false,
    isAvailable: false,
    conversationTypes: ["transcript"],
  },
  teams: {
    icon: MessageSquare,
    color: "#6264A7",
    label: "Microsoft Teams",
    description: "Channels, chats, and meetings",
    hasOAuth: true,
    isAvailable: false,
    conversationTypes: ["channel", "chat"],
  },
  discord: {
    icon: MessageCircle,
    color: "#5865F2",
    label: "Discord",
    description: "Servers, channels, and DMs",
    hasOAuth: true,
    isAvailable: false,
    conversationTypes: ["channel", "dm"],
  },
  linear: {
    icon: FileText,
    color: "#5E6AD2",
    label: "Linear",
    description: "Issues and project updates",
    hasOAuth: true,
    isAvailable: false,
    conversationTypes: ["issue", "project"],
  },
  github: {
    icon: Github,
    color: "#181717",
    label: "GitHub",
    description: "Issues, PRs, and discussions",
    hasOAuth: true,
    isAvailable: false,
    conversationTypes: ["issue", "pull_request", "discussion"],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get configuration for a source type.
 */
export function getSourceConfig(sourceType: SourceType): SourceConfig {
  return sourceConfigs[sourceType];
}

/**
 * Get display name for a source type.
 */
export function getSourceLabel(sourceType: SourceType): string {
  return sourceConfigs[sourceType]?.label ?? sourceType;
}

/**
 * Get icon component for a source type.
 */
export function getSourceIcon(sourceType: SourceType): LucideIcon {
  return sourceConfigs[sourceType]?.icon ?? Mail;
}

/**
 * Get brand color for a source type.
 */
export function getSourceColor(sourceType: SourceType): string {
  return sourceConfigs[sourceType]?.color ?? "#6B7280";
}

/**
 * Get all available source types for connection.
 */
export function getAvailableSources(): SourceType[] {
  return (Object.keys(sourceConfigs) as SourceType[]).filter(
    (type) => sourceConfigs[type].isAvailable
  );
}

/**
 * Get all source types that support OAuth.
 */
export function getOAuthSources(): SourceType[] {
  return (Object.keys(sourceConfigs) as SourceType[]).filter(
    (type) => sourceConfigs[type].hasOAuth && sourceConfigs[type].isAvailable
  );
}

/**
 * Check if a source type is available.
 */
export function isSourceAvailable(sourceType: SourceType): boolean {
  return sourceConfigs[sourceType]?.isAvailable ?? false;
}

// =============================================================================
// PRIORITY TIER CONFIGURATION
// =============================================================================

export interface PriorityConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

export const priorityConfigs: Record<string, PriorityConfig> = {
  urgent: {
    label: "Urgent",
    color: "text-red-600",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
  },
  high: {
    label: "High",
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
  },
  medium: {
    label: "Medium",
    color: "text-yellow-600",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-200",
  },
  low: {
    label: "Low",
    color: "text-gray-500",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
  },
};

/**
 * Get priority configuration.
 */
export function getPriorityConfig(priority: string | null): PriorityConfig {
  return priorityConfigs[priority ?? "medium"] ?? priorityConfigs.medium;
}

// =============================================================================
// CONVERSATION TYPE LABELS
// =============================================================================

export const conversationTypeLabels: Record<string, string> = {
  thread: "Email Thread",
  channel: "Channel",
  dm: "Direct Message",
  group_dm: "Group DM",
  slack_thread: "Thread",
  event: "Calendar Event",
  chat: "Chat",
  group: "Group Chat",
  page: "Page",
  database: "Database",
  document: "Document",
  spreadsheet: "Spreadsheet",
  transcript: "Meeting Transcript",
  issue: "Issue",
  pull_request: "Pull Request",
  discussion: "Discussion",
  project: "Project",
};

/**
 * Get human-readable label for a conversation type.
 */
export function getConversationTypeLabel(type: string | null): string {
  return conversationTypeLabels[type ?? ""] ?? type ?? "Conversation";
}
