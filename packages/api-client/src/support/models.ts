export interface SupportTicketCreated {
  ticket_id: string;
  status: string;
  created_at: string;
}

export interface SupportTicketListItem {
  id: string;
  organization_id: string;
  subject: string;
  status: "open" | "pending" | "closed" | string;
  priority: "low" | "normal" | "high" | string;
  created_by_email: string;
  assignee_email: string | null;
  created_via: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  message_count: number;
  last_message_preview: string | null;
}

export interface SupportTicketMessageItem {
  id: string;
  direction: "inbound" | "outbound" | string;
  visibility: "external" | "internal" | string;
  author_type: "requester" | "admin" | string;
  author_email: string | null;
  body_text: string;
  body_html: string | null;
  created_at: string;
}

export interface SupportTicketDetailResponse {
  ticket: SupportTicketListItem;
  messages: SupportTicketMessageItem[];
}
