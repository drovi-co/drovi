// =============================================================================
// CALENDAR ADAPTER
// =============================================================================
//
// Converts calendar events to generic ConversationInput format for
// multi-source intelligence processing. Calendar events are treated as
// conversations where:
// - The event description is the message content
// - Attendees are participants
// - Accepting an event = commitment to attend
//

import type {
  CalendarConversation,
  ConversationInput,
  MessageInput,
  Participant,
  SourceAdapter,
} from "../types/content";

// =============================================================================
// CALENDAR-SPECIFIC INPUT TYPES
// =============================================================================

/**
 * Calendar event attendee.
 */
export interface CalendarAttendeeData {
  email: string;
  name?: string;
  responseStatus: "needsAction" | "accepted" | "declined" | "tentative";
  organizer?: boolean;
  self?: boolean;
  optional?: boolean;
}

/**
 * Conference/video call data.
 */
export interface CalendarConferenceData {
  type: "hangoutsMeet" | "teams" | "zoom" | "other";
  conferenceId?: string;
  entryPoints: Array<{
    entryPointType: "video" | "phone" | "more" | "sip";
    uri: string;
    label?: string;
    pin?: string;
  }>;
  notes?: string;
}

/**
 * Recurrence rule for recurring events.
 */
export interface CalendarRecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  until?: Date;
  count?: number;
  byDay?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
}

/**
 * Calendar event from calendar client.
 * Matches the CalendarEvent type from calendar-client/types.ts.
 */
export interface CalendarEventData {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  visibility: "default" | "public" | "private" | "confidential";
  organizer: CalendarAttendeeData;
  attendees: CalendarAttendeeData[];
  recurrence?: CalendarRecurrenceRule;
  conferenceData?: CalendarConferenceData;
  htmlLink?: string;
  recurringEventId?: string;
  originalStartTime?: Date;
  canEdit: boolean;
  canDelete: boolean;
  selfResponseStatus?: "needsAction" | "accepted" | "declined" | "tentative";
  created: Date;
  updated: Date;
  provider: "gmail" | "outlook";
}

/**
 * Calendar info for context.
 */
export interface CalendarInfoData {
  id: string;
  name: string;
  description?: string;
  primary: boolean;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  timeZone: string;
  provider: "gmail" | "outlook";
}

// =============================================================================
// CALENDAR ADAPTER IMPLEMENTATION
// =============================================================================

/**
 * Calendar adapter for converting calendar events to generic format.
 *
 * Calendar events are treated as single-message conversations where:
 * - The organizer is the "sender"
 * - The event details form the message body
 * - Attendees accepting = commitments to attend
 */
export const calendarAdapter: SourceAdapter<CalendarEventData, never> = {
  sourceType: "calendar",

  /**
   * Convert calendar event to generic ConversationInput.
   */
  toConversation(
    event: CalendarEventData,
    sourceId: string,
    userEmail: string
  ): CalendarConversation {
    // Build structured event body
    const bodyParts: string[] = [];

    // Title and time
    bodyParts.push(`📅 ${event.title}`);
    bodyParts.push("");

    // Time info
    if (event.isAllDay) {
      bodyParts.push(
        `All day: ${event.start.toLocaleDateString()}`
      );
    } else {
      bodyParts.push(
        `Time: ${event.start.toLocaleString()} - ${event.end.toLocaleTimeString()}`
      );
    }

    // Location
    if (event.location) {
      bodyParts.push(`Location: ${event.location}`);
    }

    // Conference link
    if (event.conferenceData) {
      const videoEntry = event.conferenceData.entryPoints.find(
        (e) => e.entryPointType === "video"
      );
      if (videoEntry) {
        bodyParts.push(`Video: ${videoEntry.uri}`);
      }
    }

    // Attendees summary
    if (event.attendees.length > 0) {
      bodyParts.push("");
      bodyParts.push(`Attendees (${event.attendees.length}):`);
      for (const attendee of event.attendees.slice(0, 10)) {
        const status = getAttendeeStatusEmoji(attendee.responseStatus);
        const name = attendee.name ?? attendee.email;
        bodyParts.push(`  ${status} ${name}`);
      }
      if (event.attendees.length > 10) {
        bodyParts.push(`  ... and ${event.attendees.length - 10} more`);
      }
    }

    // Description
    if (event.description) {
      bodyParts.push("");
      bodyParts.push("Description:");
      bodyParts.push(event.description);
    }

    const bodyText = bodyParts.join("\n");

    // Build participant list
    const participantIds = [
      event.organizer.email,
      ...event.attendees.map((a) => a.email),
    ].filter((email, index, arr) => arr.indexOf(email) === index);

    // Determine conversation type
    const conversationType = event.recurrence ? "recurring_event" : "event";

    return {
      id: event.id,
      externalId: event.id,
      sourceId,
      sourceType: "calendar",
      organizationId: "", // Will be set by caller
      conversationType,
      title: event.title,
      participantIds,
      userIdentifier: userEmail,
      messages: [
        {
          id: `${event.id}-event`,
          externalId: event.id,
          senderId: event.organizer.email,
          senderName: event.organizer.name,
          senderEmail: event.organizer.email,
          isFromUser: event.organizer.email === userEmail,
          subject: event.title,
          bodyText,
          sentAt: event.created,
          receivedAt: event.created,
          messageIndex: 0,
        },
      ],
      metadata: {
        eventId: event.id,
        calendarId: event.calendarId,
        location: event.location,
        conferenceUrl: getConferenceUrl(event.conferenceData),
        start: event.start,
        end: event.end,
        isAllDay: event.isAllDay,
        recurrenceRule: event.recurrence
          ? formatRecurrenceRule(event.recurrence)
          : undefined,
        status: event.status,
        organizer: {
          email: event.organizer.email,
          name: event.organizer.name,
        },
        attendees: event.attendees.map((a) => ({
          email: a.email,
          name: a.name,
          status: mapResponseStatusToMetadata(a.responseStatus),
          isOrganizer: a.organizer,
        })),
      },
    };
  },

  /**
   * Calendar events don't have multiple messages, so this is a no-op.
   */
  toMessage(_raw: never, _messageIndex: number): MessageInput {
    throw new Error("Calendar events do not have separate messages");
  },

  /**
   * Extract participant from attendee data.
   */
  toParticipant(raw: unknown): Participant {
    if (
      typeof raw === "object" &&
      raw !== null &&
      "email" in raw &&
      typeof (raw as { email: unknown }).email === "string"
    ) {
      const attendee = raw as CalendarAttendeeData;
      return {
        id: attendee.email,
        email: attendee.email,
        name: attendee.name,
        metadata: {
          responseStatus: attendee.responseStatus,
          isOrganizer: attendee.organizer,
          isOptional: attendee.optional,
        },
      };
    }

    throw new Error("Invalid calendar attendee data");
  },

  /**
   * Get display name for calendar source.
   */
  getSourceDisplayName(_conversation: ConversationInput): string {
    return "Calendar";
  },

  /**
   * Get deep link URL to calendar event.
   */
  getSourceUrl(
    conversation: ConversationInput,
    _messageId?: string
  ): string | undefined {
    const metadata = conversation.metadata as
      | CalendarConversation["metadata"]
      | undefined;

    // For Google Calendar
    if (metadata?.eventId) {
      // Google Calendar event URL format
      return `https://calendar.google.com/calendar/event?eid=${encodeEventId(metadata.eventId)}`;
    }

    return undefined;
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Map calendar API response status to metadata format.
 * Calendar API uses "needsAction", but our type expects "needs_action".
 */
function mapResponseStatusToMetadata(
  status: CalendarAttendeeData["responseStatus"]
): "accepted" | "declined" | "tentative" | "needs_action" {
  switch (status) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "tentative":
      return "tentative";
    case "needsAction":
    default:
      return "needs_action";
  }
}

/**
 * Get emoji for attendee response status.
 */
function getAttendeeStatusEmoji(
  status: CalendarAttendeeData["responseStatus"]
): string {
  switch (status) {
    case "accepted":
      return "✅";
    case "declined":
      return "❌";
    case "tentative":
      return "❓";
    case "needsAction":
    default:
      return "⏳";
  }
}

/**
 * Get video conference URL from conference data.
 */
function getConferenceUrl(
  conferenceData: CalendarConferenceData | undefined
): string | undefined {
  if (!conferenceData) return undefined;

  const videoEntry = conferenceData.entryPoints.find(
    (e) => e.entryPointType === "video"
  );

  return videoEntry?.uri;
}

/**
 * Format recurrence rule to human-readable string.
 */
function formatRecurrenceRule(rule: CalendarRecurrenceRule): string {
  const parts: string[] = [];

  // Frequency
  const freq = rule.frequency.charAt(0).toUpperCase() + rule.frequency.slice(1);
  if (rule.interval > 1) {
    parts.push(`Every ${rule.interval} ${freq.toLowerCase()}s`);
  } else {
    parts.push(freq);
  }

  // Days
  if (rule.byDay && rule.byDay.length > 0) {
    parts.push(`on ${rule.byDay.join(", ")}`);
  }

  // End condition
  if (rule.until) {
    parts.push(`until ${rule.until.toLocaleDateString()}`);
  } else if (rule.count) {
    parts.push(`for ${rule.count} occurrences`);
  }

  return parts.join(" ");
}

/**
 * Encode event ID for Google Calendar URL.
 * Google uses base64 encoding for event IDs in URLs.
 */
function encodeEventId(eventId: string): string {
  // In browser/Node environment
  if (typeof btoa !== "undefined") {
    return btoa(eventId);
  }
  // Fallback - return as-is
  return eventId;
}

// =============================================================================
// COMMITMENT EXTRACTION HELPERS
// =============================================================================

/**
 * Extract commitment data from a calendar event.
 * When someone accepts a calendar event, they're making a commitment to attend.
 */
export interface CalendarCommitment {
  /** The attendee who made the commitment */
  debtor: {
    email: string;
    name?: string;
  };
  /** The event organizer (creditor of the commitment) */
  creditor: {
    email: string;
    name?: string;
  };
  /** What they committed to */
  title: string;
  /** Description of the commitment */
  description: string;
  /** When the commitment is due (event start time) */
  dueDate: Date;
  /** Commitment status based on response */
  status: "pending" | "accepted" | "declined" | "tentative";
  /** Confidence based on response status */
  confidence: number;
  /** Source event ID */
  eventId: string;
  /** Calendar ID */
  calendarId: string;
}

/**
 * Extract commitments from a calendar event.
 * Each attendee who accepted = commitment to attend.
 */
export function extractCommitmentsFromEvent(
  event: CalendarEventData,
  userEmail: string
): CalendarCommitment[] {
  const commitments: CalendarCommitment[] = [];

  // Skip cancelled events
  if (event.status === "cancelled") {
    return commitments;
  }

  for (const attendee of event.attendees) {
    // Skip the organizer (they created the event, not committed to it)
    if (attendee.organizer) continue;

    // Only create commitments for attendees with a response
    if (attendee.responseStatus === "needsAction") continue;

    const commitment: CalendarCommitment = {
      debtor: {
        email: attendee.email,
        name: attendee.name,
      },
      creditor: {
        email: event.organizer.email,
        name: event.organizer.name,
      },
      title: `Attend: ${event.title}`,
      description: buildCommitmentDescription(event, attendee),
      dueDate: event.start,
      status: mapResponseToStatus(attendee.responseStatus),
      confidence: mapResponseToConfidence(attendee.responseStatus),
      eventId: event.id,
      calendarId: event.calendarId,
    };

    commitments.push(commitment);
  }

  // Also check if the user (as organizer) has commitments to host
  if (event.organizer.email === userEmail && event.attendees.length > 0) {
    const acceptedAttendees = event.attendees.filter(
      (a) => a.responseStatus === "accepted" && !a.organizer
    );

    const firstAttendee = acceptedAttendees[0];
    if (acceptedAttendees.length > 0 && firstAttendee) {
      commitments.push({
        debtor: {
          email: userEmail,
          name: event.organizer.name,
        },
        creditor: {
          email: firstAttendee.email,
          name: firstAttendee.name,
        },
        title: `Host: ${event.title}`,
        description: `Host meeting with ${acceptedAttendees.length} confirmed attendee(s)`,
        dueDate: event.start,
        status: "accepted",
        confidence: 0.95,
        eventId: event.id,
        calendarId: event.calendarId,
      });
    }
  }

  return commitments;
}

/**
 * Build description for calendar commitment.
 */
function buildCommitmentDescription(
  event: CalendarEventData,
  attendee: CalendarAttendeeData
): string {
  const parts: string[] = [];

  // Basic info
  parts.push(
    `${attendee.name ?? attendee.email} ${attendee.responseStatus} invitation to "${event.title}"`
  );

  // Time
  if (event.isAllDay) {
    parts.push(`All day event on ${event.start.toLocaleDateString()}`);
  } else {
    parts.push(`Scheduled for ${event.start.toLocaleString()}`);
  }

  // Location
  if (event.location) {
    parts.push(`Location: ${event.location}`);
  }

  return parts.join(". ");
}

/**
 * Map calendar response status to commitment status.
 */
function mapResponseToStatus(
  responseStatus: CalendarAttendeeData["responseStatus"]
): CalendarCommitment["status"] {
  switch (responseStatus) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "tentative":
      return "tentative";
    case "needsAction":
    default:
      return "pending";
  }
}

/**
 * Map calendar response to confidence score.
 */
function mapResponseToConfidence(
  responseStatus: CalendarAttendeeData["responseStatus"]
): number {
  switch (responseStatus) {
    case "accepted":
      return 0.95; // High confidence - explicit acceptance
    case "declined":
      return 0.95; // High confidence - explicit decline
    case "tentative":
      return 0.6; // Medium confidence - might attend
    case "needsAction":
    default:
      return 0.3; // Low confidence - no response yet
  }
}

/**
 * Check if an event has upcoming commitments that need tracking.
 */
export function hasUpcomingCommitments(event: CalendarEventData): boolean {
  // Only track future events
  if (event.start < new Date()) return false;

  // Skip cancelled events
  if (event.status === "cancelled") return false;

  // Only track events with attendees
  if (event.attendees.length === 0) return false;

  // Check if any attendees have responded
  return event.attendees.some(
    (a) => a.responseStatus !== "needsAction" && !a.organizer
  );
}

// =============================================================================
// SINGLE EVENT COMMITMENT (One commitment per event, not per attendee)
// =============================================================================

/**
 * Single commitment data for a calendar event.
 * ONE commitment per event that summarizes the attendance status.
 */
export interface CalendarEventCommitment {
  /** Event title */
  title: string;
  /** Description with attendance summary */
  description: string;
  /** When the event is scheduled (commitment due date) */
  dueDate: Date;
  /** Overall commitment status */
  status: "pending" | "confirmed" | "cancelled";
  /** Confidence based on attendance confirmations */
  confidence: number;
  /** Source event ID - used as unique key for upsert */
  eventId: string;
  /** Calendar ID */
  calendarId: string;
  /** Is the user the organizer? */
  isOrganizer: boolean;
  /** Attendance summary */
  attendance: {
    total: number;
    accepted: number;
    declined: number;
    tentative: number;
    pending: number;
  };
  /** Organizer info */
  organizer: {
    email: string;
    name?: string;
  };
  /** User's response status (if they're an attendee) */
  userResponseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
}

/**
 * Extract a SINGLE commitment from a calendar event.
 * This replaces extractCommitmentsFromEvent for cases where we want
 * one commitment per event that gets UPDATED, not multiple per attendee.
 *
 * @param event The calendar event
 * @param userEmail The current user's email
 * @returns Single commitment or null if event shouldn't create a commitment
 */
export function extractSingleEventCommitment(
  event: CalendarEventData,
  userEmail: string
): CalendarEventCommitment | null {
  // Skip cancelled events - they should cancel existing commitment
  if (event.status === "cancelled") {
    return {
      title: `Cancelled: ${event.title}`,
      description: "This event has been cancelled.",
      dueDate: event.start,
      status: "cancelled",
      confidence: 1.0,
      eventId: event.id,
      calendarId: event.calendarId,
      isOrganizer: event.organizer.email === userEmail,
      attendance: {
        total: event.attendees.length,
        accepted: 0,
        declined: 0,
        tentative: 0,
        pending: 0,
      },
      organizer: {
        email: event.organizer.email,
        name: event.organizer.name,
      },
    };
  }

  // Skip events with no attendees (personal events without invitees)
  if (event.attendees.length === 0) {
    return null;
  }

  // Calculate attendance summary
  const attendance = {
    total: event.attendees.filter((a) => !a.organizer).length,
    accepted: event.attendees.filter(
      (a) => !a.organizer && a.responseStatus === "accepted"
    ).length,
    declined: event.attendees.filter(
      (a) => !a.organizer && a.responseStatus === "declined"
    ).length,
    tentative: event.attendees.filter(
      (a) => !a.organizer && a.responseStatus === "tentative"
    ).length,
    pending: event.attendees.filter(
      (a) => !a.organizer && a.responseStatus === "needsAction"
    ).length,
  };

  // Determine if user is organizer or attendee
  const isOrganizer = event.organizer.email === userEmail;
  const userAttendee = event.attendees.find((a) => a.email === userEmail);

  // Build title based on user's role
  const title = isOrganizer
    ? `Host: ${event.title}`
    : `Attend: ${event.title}`;

  // Build description with attendance summary
  const descriptionParts: string[] = [];

  if (isOrganizer) {
    descriptionParts.push(
      `Meeting with ${attendance.total} invitee${attendance.total !== 1 ? "s" : ""}`
    );
    if (attendance.accepted > 0) {
      descriptionParts.push(`${attendance.accepted} confirmed`);
    }
    if (attendance.tentative > 0) {
      descriptionParts.push(`${attendance.tentative} tentative`);
    }
    if (attendance.declined > 0) {
      descriptionParts.push(`${attendance.declined} declined`);
    }
    if (attendance.pending > 0) {
      descriptionParts.push(`${attendance.pending} awaiting response`);
    }
  } else {
    const statusText = userAttendee
      ? `Your response: ${userAttendee.responseStatus}`
      : "You are invited";
    descriptionParts.push(statusText);
    descriptionParts.push(`Organized by ${event.organizer.name ?? event.organizer.email}`);
    if (attendance.accepted > 0) {
      descriptionParts.push(`${attendance.accepted}/${attendance.total} attending`);
    }
  }

  // Add time/location info
  if (event.isAllDay) {
    descriptionParts.push(`All day on ${event.start.toLocaleDateString()}`);
  } else {
    descriptionParts.push(`${event.start.toLocaleString()}`);
  }

  if (event.location) {
    descriptionParts.push(`at ${event.location}`);
  } else if (event.conferenceData) {
    descriptionParts.push("via video call");
  }

  // Determine overall status
  let status: "pending" | "confirmed" | "cancelled" = "pending";
  let confidence = 0.5;

  if (isOrganizer) {
    // Organizer: confirmed if at least one person accepted
    if (attendance.accepted > 0) {
      status = "confirmed";
      confidence = 0.9;
    } else if (attendance.total === attendance.declined) {
      status = "cancelled"; // Everyone declined
      confidence = 0.95;
    }
  } else {
    // Attendee: based on their own response
    if (userAttendee?.responseStatus === "accepted") {
      status = "confirmed";
      confidence = 0.95;
    } else if (userAttendee?.responseStatus === "declined") {
      status = "cancelled";
      confidence = 0.95;
    } else if (userAttendee?.responseStatus === "tentative") {
      status = "pending";
      confidence = 0.6;
    }
  }

  return {
    title,
    description: descriptionParts.join(". "),
    dueDate: event.start,
    status,
    confidence,
    eventId: event.id,
    calendarId: event.calendarId,
    isOrganizer,
    attendance,
    organizer: {
      email: event.organizer.email,
      name: event.organizer.name,
    },
    userResponseStatus: userAttendee?.responseStatus,
  };
}

/**
 * Get a unique identifier for a calendar event commitment.
 * Used to avoid duplicate commitments.
 */
export function getCommitmentKey(
  eventId: string,
  attendeeEmail: string
): string {
  return `calendar:${eventId}:${attendeeEmail}`;
}
