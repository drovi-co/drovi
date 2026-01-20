// =============================================================================
// WHATSAPP ADAPTER
// =============================================================================
//
// Converts WhatsApp messages to generic ConversationInput format for
// multi-source intelligence processing. WhatsApp conversations map to:
// - Individual chats → dm conversation type
// - Group chats → group_dm conversation type (future)
//
// NOTE: WhatsApp Cloud API doesn't support fetching message history.
// Messages are received via webhooks and stored locally, then processed.
//

import type {
  ConversationInput,
  MessageInput,
  MessageRecipient,
  Participant,
  SourceAdapter,
  WhatsAppConversation,
} from "../types/content";

// =============================================================================
// WHATSAPP-SPECIFIC INPUT TYPES
// =============================================================================

/**
 * WhatsApp contact information from webhook.
 */
export interface WhatsAppContactData {
  waId: string; // WhatsApp ID (phone number without +)
  profileName?: string;
  pushName?: string; // Name from contact's phone
}

/**
 * WhatsApp message from webhook.
 */
export interface WhatsAppMessageData {
  id: string; // WhatsApp Message ID (wam_id)
  from: string; // Sender's WhatsApp ID
  timestamp: string; // Unix timestamp
  type:
    | "text"
    | "image"
    | "audio"
    | "video"
    | "document"
    | "sticker"
    | "location"
    | "contacts"
    | "interactive"
    | "button"
    | "reaction";
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mimeType: string;
    sha256: string;
    caption?: string;
  };
  audio?: {
    id: string;
    mimeType: string;
    sha256?: string;
    voice?: boolean;
  };
  video?: {
    id: string;
    mimeType: string;
    sha256: string;
    caption?: string;
  };
  document?: {
    id: string;
    mimeType: string;
    sha256: string;
    filename?: string;
    caption?: string;
  };
  sticker?: {
    id: string;
    mimeType: string;
    sha256: string;
    animated?: boolean;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  contacts?: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string };
    phones?: Array<{ phone: string; type: string; wa_id?: string }>;
  }>;
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: {
    text: string;
    payload: string;
  };
  reaction?: {
    message_id: string;
    emoji: string;
  };
  context?: {
    from: string;
    id: string;
    forwarded?: boolean;
    frequently_forwarded?: boolean;
  };
  errors?: Array<{
    code: number;
    title: string;
    message: string;
  }>;
}

/**
 * WhatsApp conversation context.
 */
export interface WhatsAppConversationContext {
  phoneNumberId: string;
  displayPhoneNumber: string;
  wabaId: string;
  wabaName: string;
}

/**
 * WhatsApp chat (grouping of messages with a contact).
 */
export interface WhatsAppChatData {
  waId: string; // Contact's WhatsApp ID
  contactName?: string;
  messages: WhatsAppMessageData[];
  context: WhatsAppConversationContext;
}

// =============================================================================
// WHATSAPP ADAPTER IMPLEMENTATION
// =============================================================================

/**
 * WhatsApp adapter for converting WhatsApp data to generic format.
 *
 * WhatsApp chats are 1:1 conversations where:
 * - Each contact forms a separate conversation
 * - Messages are received via webhooks
 * - Replies, reactions, and media are supported
 */
export const whatsappAdapter: SourceAdapter<
  WhatsAppChatData,
  WhatsAppMessageData
> = {
  sourceType: "whatsapp",

  /**
   * Convert WhatsApp chat to generic ConversationInput.
   */
  toConversation(
    data: WhatsAppChatData,
    sourceId: string,
    userIdentifier: string
  ): WhatsAppConversation {
    const { waId, contactName, messages, context } = data;

    // Sort messages by timestamp
    const sortedMessages = [...messages].sort(
      (a, b) =>
        Number.parseInt(a.timestamp, 10) - Number.parseInt(b.timestamp, 10)
    );

    // Build participant list
    const participantIds = [
      waId, // The contact
      context.phoneNumberId, // Our phone number
    ];

    // Title is the contact name or phone number
    const title = contactName ?? formatPhoneNumber(waId);

    return {
      id: `whatsapp_${context.phoneNumberId}_${waId}`,
      externalId: waId,
      sourceId,
      sourceType: "whatsapp",
      organizationId: "", // Will be set by caller
      conversationType: "dm",
      title,
      participantIds,
      userIdentifier,
      messages: sortedMessages.map((msg, index) =>
        whatsappAdapter.toMessage(msg, index)
      ),
      metadata: {
        waId,
        phoneNumberId: context.phoneNumberId,
        displayPhoneNumber: context.displayPhoneNumber,
        wabaId: context.wabaId,
        wabaName: context.wabaName,
        contactName,
      },
    };
  },

  /**
   * Convert WhatsApp message to generic MessageInput.
   */
  toMessage(msg: WhatsAppMessageData, messageIndex: number): MessageInput {
    // Parse timestamp to Date
    const sentAt = new Date(Number.parseInt(msg.timestamp, 10) * 1000);

    // Extract message body text
    const bodyText = getMessageText(msg);

    // Build recipients (for outgoing messages, recipient is the 'to' field)
    const recipients: MessageRecipient[] = [];

    // Reply context available as: msg.context?.id

    return {
      id: msg.id,
      externalId: msg.id,
      senderId: msg.from,
      senderName: undefined, // Will be enriched with contact lookup
      senderEmail: undefined,
      isFromUser: false, // Will be set based on userIdentifier comparison
      recipients,
      subject: undefined, // WhatsApp messages don't have subjects
      bodyText,
      bodyHtml: undefined,
      sentAt,
      receivedAt: sentAt,
      messageIndex,
      hasAttachments: hasMedia(msg),
      metadata: {
        wamId: msg.id,
        messageType: msg.type,
        media: getMediaInfo(msg),
        context: msg.context
          ? {
              replyToMessageId: msg.context.id,
              replyToFrom: msg.context.from,
              isForwarded: msg.context.forwarded,
              isFrequentlyForwarded: msg.context.frequently_forwarded,
            }
          : undefined,
        reaction: msg.reaction,
        location: msg.location,
        contacts: msg.contacts,
        interactive: msg.interactive,
      },
    };
  },

  /**
   * Extract participant from WhatsApp contact data.
   */
  toParticipant(raw: unknown): Participant {
    if (
      typeof raw === "object" &&
      raw !== null &&
      "waId" in raw &&
      typeof (raw as { waId: unknown }).waId === "string"
    ) {
      const contact = raw as WhatsAppContactData;
      return {
        id: contact.waId,
        email: undefined, // WhatsApp doesn't provide email
        name:
          contact.profileName ??
          contact.pushName ??
          formatPhoneNumber(contact.waId),
        avatarUrl: undefined, // Would need separate API call
        metadata: {
          waId: contact.waId,
          pushName: contact.pushName,
        },
      };
    }

    throw new Error("Invalid WhatsApp contact data");
  },

  /**
   * Get display name for WhatsApp source.
   */
  getSourceDisplayName(conversation: ConversationInput): string {
    const metadata = conversation.metadata as WhatsAppConversation["metadata"];
    if (metadata?.contactName) {
      return metadata.contactName;
    }
    if (metadata?.waId) {
      return formatPhoneNumber(metadata.waId);
    }
    return "WhatsApp";
  },

  /**
   * Get deep link URL to WhatsApp conversation.
   */
  getSourceUrl(
    conversation: ConversationInput,
    _messageId?: string
  ): string | undefined {
    const metadata = conversation.metadata as WhatsAppConversation["metadata"];

    if (!metadata?.waId) {
      return undefined;
    }

    // WhatsApp web deep link
    return `https://wa.me/${metadata.waId}`;
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract text content from a WhatsApp message.
 */
function getMessageText(msg: WhatsAppMessageData): string {
  switch (msg.type) {
    case "text":
      return msg.text?.body ?? "";
    case "image":
      return msg.image?.caption ?? "[Image]";
    case "video":
      return msg.video?.caption ?? "[Video]";
    case "audio":
      return msg.audio?.voice ? "[Voice Message]" : "[Audio]";
    case "document":
      return (
        msg.document?.caption ??
        `[Document: ${msg.document?.filename ?? "file"}]`
      );
    case "sticker":
      return "[Sticker]";
    case "location":
      return msg.location?.name ?? msg.location?.address ?? "[Location]";
    case "contacts":
      return `[Contact: ${msg.contacts?.[0]?.name?.formatted_name ?? "Unknown"}]`;
    case "interactive":
      return (
        msg.interactive?.button_reply?.title ??
        msg.interactive?.list_reply?.title ??
        "[Interactive Message]"
      );
    case "button":
      return msg.button?.text ?? "[Button Response]";
    case "reaction":
      return `Reacted with ${msg.reaction?.emoji ?? ""}`;
    default:
      return "[Unknown Message Type]";
  }
}

/**
 * Check if message has media attachments.
 */
function hasMedia(msg: WhatsAppMessageData): boolean {
  return ["image", "video", "audio", "document", "sticker"].includes(msg.type);
}

/**
 * Get media information from message.
 */
function getMediaInfo(
  msg: WhatsAppMessageData
): { id: string; mimeType: string; url?: string } | undefined {
  switch (msg.type) {
    case "image":
      return msg.image
        ? { id: msg.image.id, mimeType: msg.image.mimeType }
        : undefined;
    case "video":
      return msg.video
        ? { id: msg.video.id, mimeType: msg.video.mimeType }
        : undefined;
    case "audio":
      return msg.audio
        ? { id: msg.audio.id, mimeType: msg.audio.mimeType }
        : undefined;
    case "document":
      return msg.document
        ? { id: msg.document.id, mimeType: msg.document.mimeType }
        : undefined;
    case "sticker":
      return msg.sticker
        ? { id: msg.sticker.id, mimeType: msg.sticker.mimeType }
        : undefined;
    default:
      return undefined;
  }
}

/**
 * Format a WhatsApp ID (phone number) for display.
 */
function formatPhoneNumber(waId: string): string {
  // WhatsApp IDs are phone numbers without the + prefix
  // Format: 15551234567 → +1 (555) 123-4567
  if (waId.length === 11 && waId.startsWith("1")) {
    // US number
    return `+1 (${waId.slice(1, 4)}) ${waId.slice(4, 7)}-${waId.slice(7)}`;
  }
  // Generic format
  return `+${waId}`;
}

// =============================================================================
// OUTGOING MESSAGE HELPERS
// =============================================================================

/**
 * WhatsApp outgoing message data.
 */
export interface WhatsAppOutgoingMessage {
  to: string; // Recipient WhatsApp ID
  type: "text" | "template" | "image" | "document";
  text?: { body: string };
  template?: {
    name: string;
    language: { code: string };
    components?: unknown[];
  };
  image?: { id?: string; link?: string; caption?: string };
  document?: {
    id?: string;
    link?: string;
    caption?: string;
    filename?: string;
  };
}

/**
 * Convert outgoing message to MessageInput format.
 */
export function outgoingToMessageInput(
  msg: WhatsAppOutgoingMessage,
  messageId: string,
  phoneNumberId: string,
  timestamp: Date
): MessageInput {
  let bodyText = "";

  switch (msg.type) {
    case "text":
      bodyText = msg.text?.body ?? "";
      break;
    case "template":
      bodyText = `[Template: ${msg.template?.name ?? "unknown"}]`;
      break;
    case "image":
      bodyText = msg.image?.caption ?? "[Image]";
      break;
    case "document":
      bodyText =
        msg.document?.caption ??
        `[Document: ${msg.document?.filename ?? "file"}]`;
      break;
  }

  return {
    id: messageId,
    externalId: messageId,
    senderId: phoneNumberId,
    senderName: undefined,
    senderEmail: undefined,
    isFromUser: true, // Outgoing messages are from our user
    recipients: [{ id: msg.to, type: "to" }],
    subject: undefined,
    bodyText,
    bodyHtml: undefined,
    sentAt: timestamp,
    receivedAt: timestamp,
    messageIndex: 0,
    hasAttachments: ["image", "document"].includes(msg.type),
    metadata: {
      wamId: messageId,
      messageType: msg.type,
      isOutgoing: true,
    },
  };
}
