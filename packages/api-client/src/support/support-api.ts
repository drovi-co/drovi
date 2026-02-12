import type { ApiClient } from "../http/client";

import type {
  SupportTicketCreated,
  SupportTicketDetailResponse,
  SupportTicketListItem,
} from "./models";

export function createSupportApi(client: ApiClient) {
  return {
    async createTicket(params: {
      subject: string;
      message: string;
      messageHtml?: string;
      route?: string;
      locale?: string;
      diagnostics?: Record<string, unknown>;
    }): Promise<SupportTicketCreated> {
      return client.requestJson<SupportTicketCreated>("/support/tickets", {
        method: "POST",
        body: {
          subject: params.subject,
          message: params.message,
          message_html: params.messageHtml,
          route: params.route,
          locale: params.locale,
          diagnostics: params.diagnostics ?? {},
        },
        allowRetry: false,
      });
    },

    async listTickets(): Promise<{ tickets: SupportTicketListItem[] }> {
      return client.requestJson<{ tickets: SupportTicketListItem[] }>(
        "/support/tickets"
      );
    },

    async getTicket(ticketId: string): Promise<SupportTicketDetailResponse> {
      return client.requestJson<SupportTicketDetailResponse>(
        `/support/tickets/${encodeURIComponent(ticketId)}`
      );
    },

    async updateTicket(params: {
      ticketId: string;
      status?: "open" | "pending" | "closed";
      priority?: "low" | "normal" | "high";
      assignee_email?: string | null;
    }): Promise<{ status: string }> {
      return client.requestJson<{ status: string }>(
        `/support/tickets/${encodeURIComponent(params.ticketId)}`,
        {
          method: "PATCH",
          body: {
            status: params.status,
            priority: params.priority,
            assignee_email: params.assignee_email,
          },
          allowRetry: false,
        }
      );
    },

    async addMessage(params: {
      ticketId: string;
      message: string;
      message_html?: string | null;
      visibility?: "external" | "internal";
      locale?: string;
    }): Promise<{ status: string; message_id: string }> {
      return client.requestJson<{ status: string; message_id: string }>(
        `/support/tickets/${encodeURIComponent(params.ticketId)}/messages`,
        {
          method: "POST",
          body: {
            message: params.message,
            message_html: params.message_html,
            visibility: params.visibility ?? "external",
            locale: params.locale,
          },
          allowRetry: false,
        }
      );
    },
  };
}
