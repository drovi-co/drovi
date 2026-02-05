import {
  Calendar,
  FileText,
  Hash,
  Mail,
  MessageCircle,
  Target,
  Users,
} from "lucide-react";

export type ConnectorCategory =
  | "email"
  | "messaging"
  | "calendar"
  | "knowledge"
  | "crm";

export interface ConnectorMeta {
  id: string;
  name: string;
  icon: typeof Mail;
  color: string;
  description: string;
  category: ConnectorCategory;
}

export const CONNECTOR_CATALOG: ConnectorMeta[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: Mail,
    color: "#EA4335",
    description: "Email messages and threads from Gmail",
    category: "email",
  },
  {
    id: "outlook",
    name: "Outlook",
    icon: Mail,
    color: "#0078D4",
    description: "Email messages from Microsoft Outlook",
    category: "email",
  },
  {
    id: "slack",
    name: "Slack",
    icon: Hash,
    color: "#4A154B",
    description: "Messages and channels from Slack workspaces",
    category: "messaging",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    icon: Users,
    color: "#6264A7",
    description: "Chats and channel messages from Teams",
    category: "messaging",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    icon: MessageCircle,
    color: "#25D366",
    description: "Business messages from WhatsApp",
    category: "messaging",
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    icon: Calendar,
    color: "#4285F4",
    description: "Events and meetings from Google Calendar",
    category: "calendar",
  },
  {
    id: "notion",
    name: "Notion",
    icon: FileText,
    color: "#000000",
    description: "Pages and databases from Notion",
    category: "knowledge",
  },
  {
    id: "google_docs",
    name: "Google Docs",
    icon: FileText,
    color: "#4285F4",
    description: "Documents from Google Drive",
    category: "knowledge",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    icon: Target,
    color: "#FF7A59",
    description: "Contacts, deals, and engagements from HubSpot CRM",
    category: "crm",
  },
];

export const CONNECTOR_META_BY_ID = new Map(
  CONNECTOR_CATALOG.map((connector) => [connector.id, connector])
);

export function getConnectorMeta(connectorId: string): ConnectorMeta | undefined {
  return CONNECTOR_META_BY_ID.get(connectorId);
}
