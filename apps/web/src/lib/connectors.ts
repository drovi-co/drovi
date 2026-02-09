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
  descriptionKey: string;
  category: ConnectorCategory;
}

export const CONNECTOR_CATALOG: ConnectorMeta[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: Mail,
    color: "#EA4335",
    descriptionKey: "connectors.gmail.description",
    category: "email",
  },
  {
    id: "outlook",
    name: "Outlook",
    icon: Mail,
    color: "#0078D4",
    descriptionKey: "connectors.outlook.description",
    category: "email",
  },
  {
    id: "slack",
    name: "Slack",
    icon: Hash,
    color: "#4A154B",
    descriptionKey: "connectors.slack.description",
    category: "messaging",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    icon: Users,
    color: "#6264A7",
    descriptionKey: "connectors.teams.description",
    category: "messaging",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    icon: MessageCircle,
    color: "#25D366",
    descriptionKey: "connectors.whatsapp.description",
    category: "messaging",
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    icon: Calendar,
    color: "#4285F4",
    descriptionKey: "connectors.googleCalendar.description",
    category: "calendar",
  },
  {
    id: "notion",
    name: "Notion",
    icon: FileText,
    color: "#000000",
    descriptionKey: "connectors.notion.description",
    category: "knowledge",
  },
  {
    id: "google_docs",
    name: "Google Docs",
    icon: FileText,
    color: "#4285F4",
    descriptionKey: "connectors.googleDocs.description",
    category: "knowledge",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    icon: Target,
    color: "#FF7A59",
    descriptionKey: "connectors.hubspot.description",
    category: "crm",
  },
];

export const CONNECTOR_META_BY_ID = new Map(
  CONNECTOR_CATALOG.map((connector) => [connector.id, connector])
);

export function getConnectorMeta(connectorId: string): ConnectorMeta | undefined {
  return CONNECTOR_META_BY_ID.get(connectorId);
}
