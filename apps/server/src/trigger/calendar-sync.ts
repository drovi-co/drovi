// =============================================================================
// CALENDAR SYNC TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for syncing calendar events into the unified conversation
// table. Extracts commitments from calendar events (attendee acceptance).
//
// Calendar events are stored as "conversations" with event details as the
// message body. This enables unified intelligence across all sources.
//

import { randomUUID } from "node:crypto";
import {
  type CalendarEventCommitment,
  type CalendarEventData,
  calendarAdapter,
  extractSingleEventCommitment,
} from "@memorystack/ai";
import { db } from "@memorystack/db";
import {
  commitment,
  conversation,
  emailAccount,
  emailThread,
  message,
  relatedConversation,
  sourceAccount,
} from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import {
  createCalendarClient,
  isCalendarSupported,
} from "../lib/calendar-client";
import { safeDecryptToken } from "../lib/crypto/tokens";
import { log } from "../lib/logger";
import {
  createTaskForCommitmentTask,
  createTaskForConversationTask,
} from "./task-sync";
import { processCommitmentTask } from "./unified-object-processing";

// =============================================================================
// TYPES
// =============================================================================

interface CalendarSyncPayload {
  /** Email account ID (uses email account for calendar access) */
  accountId: string;
  /** How many days back to sync (default: 7) */
  daysBack?: number;
  /** How many days forward to sync (default: 30) */
  daysForward?: number;
  /** Force sync even if recently synced */
  force?: boolean;
}

interface CalendarSyncResult {
  success: boolean;
  accountId: string;
  eventsProcessed: number;
  eventsCreated: number;
  eventsUpdated: number;
  commitmentsCreated: number;
  relatedThreadsLinked: number;
  errors: string[];
}

// =============================================================================
// SYNC CALENDAR EVENTS TASK
// =============================================================================

/**
 * Sync calendar events for an email account into the conversation table.
 * Events are stored as conversations for unified intelligence.
 */
export const syncCalendarEventsTask = task({
  id: "calendar-sync",
  queue: {
    name: "calendar-sync",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 300, // 5 minutes max
  run: async (payload: CalendarSyncPayload): Promise<CalendarSyncResult> => {
    const {
      accountId,
      daysBack = 7,
      daysForward = 30,
      force = false,
    } = payload;

    const result: CalendarSyncResult = {
      success: false,
      accountId,
      eventsProcessed: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      commitmentsCreated: 0,
      relatedThreadsLinked: 0,
      errors: [],
    };

    log.info("Starting calendar sync", {
      accountId,
      daysBack,
      daysForward,
      force,
    });

    try {
      // Get email account (calendar uses same OAuth)
      const account = await db.query.emailAccount.findFirst({
        where: eq(emailAccount.id, accountId),
      });

      if (!account) {
        result.errors.push("Account not found");
        return result;
      }

      // Check if provider supports calendar
      if (!isCalendarSupported(account.provider ?? "")) {
        result.errors.push(
          `Provider ${account.provider} does not support calendar`
        );
        return result;
      }

      // Get or create source account for this calendar
      let calendarSourceAccount = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.organizationId, account.organizationId),
          eq(sourceAccount.type, "calendar"),
          eq(sourceAccount.externalId, account.email)
        ),
      });

      if (!calendarSourceAccount) {
        // Create source account for calendar
        const sourceAccountId = randomUUID();
        await db.insert(sourceAccount).values({
          id: sourceAccountId,
          organizationId: account.organizationId,
          addedByUserId: account.addedByUserId,
          type: "calendar" as const,
          provider: account.provider === "gmail" ? "google" : "microsoft",
          externalId: account.email,
          displayName: `${account.email} Calendar`,
          status: "connected" as const,
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          tokenExpiresAt: account.tokenExpiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        calendarSourceAccount = await db.query.sourceAccount.findFirst({
          where: eq(sourceAccount.id, sourceAccountId),
        });
      }

      if (!calendarSourceAccount) {
        result.errors.push("Failed to create calendar source account");
        return result;
      }

      // Create calendar client
      const calendarClient = createCalendarClient({
        account: {
          id: account.id,
          provider: account.provider ?? "gmail",
          email: account.email,
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          tokenExpiresAt: account.tokenExpiresAt,
        },
        decryptToken: safeDecryptToken,
      });

      // Refresh token if needed
      if (calendarClient.needsRefresh()) {
        log.info("Refreshing calendar tokens", { accountId });
        const newTokens = await calendarClient.refreshToken();

        // Update account with new tokens
        await db
          .update(emailAccount)
          .set({
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
            tokenExpiresAt: newTokens.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(emailAccount.id, accountId));
      }

      // Calculate time range
      const now = new Date();
      const timeMin = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
      const timeMax = new Date(
        now.getTime() + daysForward * 24 * 60 * 60 * 1000
      );

      // Get calendars
      const calendars = await calendarClient.listCalendars();
      log.info("Found calendars", { count: calendars.length });

      // Sync events from each calendar
      for (const calendar of calendars) {
        // Only sync primary and owned calendars
        if (calendar.accessRole !== "owner" && !calendar.primary) {
          continue;
        }

        try {
          const eventsResponse = await calendarClient.listEvents({
            calendarId: calendar.id,
            timeMin,
            timeMax,
            singleEvents: true, // Expand recurring events
            maxResults: 500,
          });

          log.info("Processing calendar events", {
            calendarId: calendar.id,
            eventCount: eventsResponse.items.length,
          });

          for (const event of eventsResponse.items) {
            result.eventsProcessed++;

            try {
              const eventResult = await processCalendarEvent(
                event as unknown as CalendarEventData,
                calendarSourceAccount.id,
                account.organizationId,
                account.email,
                force
              );

              if (eventResult.created) {
                result.eventsCreated++;
              } else if (eventResult.updated) {
                result.eventsUpdated++;
              }

              result.commitmentsCreated += eventResult.commitmentsCreated;
              result.relatedThreadsLinked += eventResult.relatedThreadsLinked;
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              result.errors.push(`Event ${event.id}: ${message}`);
              log.error("Failed to process calendar event", error, {
                eventId: event.id,
              });
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`Calendar ${calendar.id}: ${message}`);
          log.error("Failed to sync calendar", error, {
            calendarId: calendar.id,
          });
        }
      }

      // Update source account sync status
      await db
        .update(sourceAccount)
        .set({
          status: "connected",
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, calendarSourceAccount.id));

      result.success = true;

      log.info("Calendar sync completed", {
        accountId,
        eventsProcessed: result.eventsProcessed,
        eventsCreated: result.eventsCreated,
        eventsUpdated: result.eventsUpdated,
        commitmentsCreated: result.commitmentsCreated,
        relatedThreadsLinked: result.relatedThreadsLinked,
        errors: result.errors.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(message);
      log.error("Calendar sync failed", error, { accountId });
    }

    return result;
  },
});

// =============================================================================
// PROCESS SINGLE EVENT
// =============================================================================

interface ProcessEventResult {
  created: boolean;
  updated: boolean;
  commitmentsCreated: number;
  relatedThreadsLinked: number;
  conversationId?: string;
}

/**
 * Process a single calendar event into the conversation table.
 */
async function processCalendarEvent(
  event: CalendarEventData,
  sourceAccountId: string,
  organizationId: string,
  userEmail: string,
  force: boolean
): Promise<ProcessEventResult> {
  const result: ProcessEventResult = {
    created: false,
    updated: false,
    commitmentsCreated: 0,
    relatedThreadsLinked: 0,
  };

  // Check if event already exists
  const existingConversation = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.sourceAccountId, sourceAccountId),
      eq(conversation.externalId, event.id)
    ),
  });

  // Convert event to conversation format
  const conversationData = calendarAdapter.toConversation(
    event,
    sourceAccountId,
    userEmail
  );

  // Set organization ID
  conversationData.organizationId = organizationId;

  const now = new Date();

  if (existingConversation) {
    // Update existing conversation
    if (
      force ||
      event.updated > (existingConversation.updatedAt ?? new Date(0))
    ) {
      await db
        .update(conversation)
        .set({
          title: conversationData.title,
          snippet: event.title,
          participantIds: conversationData.participantIds,
          lastMessageAt: event.start,
          metadata: conversationData.metadata,
          briefSummary: buildEventBrief(event),
          // Update priority fields (urgency changes based on time until event)
          urgencyScore: calculateEventUrgency(event),
          importanceScore: calculateEventImportance(event),
          priorityTier: determineEventPriority(event),
          updatedAt: now,
        })
        .where(eq(conversation.id, existingConversation.id));

      result.updated = true;
    }
  } else {
    // Create new conversation
    const conversationId = randomUUID();

    const convType = event.recurrence
      ? ("recurring_event" as const)
      : ("event" as const);
    const priority = determineEventPriority(event);

    await db.insert(conversation).values({
      id: conversationId,
      sourceAccountId,
      externalId: event.id,
      conversationType: convType,
      title: conversationData.title,
      snippet: event.title,
      participantIds: conversationData.participantIds,
      messageCount: 1,
      firstMessageAt: event.created,
      lastMessageAt: event.start,
      isRead: true, // Calendar events start as read
      isStarred: false,
      isArchived: event.status === "cancelled",
      briefSummary: buildEventBrief(event),
      urgencyScore: calculateEventUrgency(event),
      importanceScore: calculateEventImportance(event),
      priorityTier: priority,
      metadata: conversationData.metadata,
      createdAt: now,
      updatedAt: now,
    });

    // Create message for the event
    const messageId = randomUUID();
    const msgData = conversationData.messages[0];

    if (msgData) {
      await db.insert(message).values({
        id: messageId,
        conversationId,
        externalId: event.id,
        senderExternalId: event.organizer.email,
        senderName: event.organizer.name,
        senderEmail: event.organizer.email,
        subject: event.title,
        bodyText: msgData.bodyText,
        sentAt: event.created,
        isFromUser: event.organizer.email === userEmail,
        messageIndex: 0,
        metadata: {
          customMetadata: {
            eventStart: event.start,
            eventEnd: event.end,
            isAllDay: event.isAllDay,
            location: event.location,
            conferenceUrl: event.conferenceData?.entryPoints?.find(
              (e) => e.entryPointType === "video"
            )?.uri,
          },
        },
        createdAt: now,
        updatedAt: now,
      });
    }

    result.created = true;
    result.conversationId = conversationId;

    // Trigger task creation for new conversation
    await createTaskForConversationTask.trigger({
      conversationId,
    });
  }

  // Set conversation ID for linking
  const targetConversationId =
    existingConversation?.id ?? result.conversationId;

  // Link to related email threads
  if (targetConversationId) {
    const linkedCount = await linkRelatedEmailThreads(
      event,
      targetConversationId,
      sourceAccountId,
      organizationId
    );
    result.relatedThreadsLinked = linkedCount;
  }

  // Extract SINGLE commitment from calendar event (not per-attendee)
  const eventCommitment = extractSingleEventCommitment(event, userEmail);

  if (eventCommitment) {
    // Check if commitment already exists for this event (using eventId ONLY)
    const existingCommitment = await db.query.commitment.findFirst({
      where: and(
        eq(commitment.organizationId, organizationId),
        eq(commitment.sourceAccountId, sourceAccountId),
        sql`${commitment.metadata}->>'eventId' = ${event.id}`
      ),
    });

    // Determine direction: organizer owns the commitment to host, attendee owns commitment to attend
    const direction: "owed_by_me" | "owed_to_me" = eventCommitment.isOrganizer
      ? "owed_by_me" // I'm hosting, I owe the meeting to attendees
      : "owed_to_me"; // I'm invited, organizer expects me to attend

    // Map the event commitment status to database status
    const dbStatus = mapEventCommitmentStatus(eventCommitment.status);

    if (existingCommitment) {
      // ALWAYS update existing commitment with latest status/attendance
      await db
        .update(commitment)
        .set({
          title: eventCommitment.title,
          description: eventCommitment.description,
          dueDate: eventCommitment.dueDate,
          status: dbStatus,
          confidence: eventCommitment.confidence,
          metadata: {
            eventId: event.id,
            calendarId: event.calendarId,
            isOrganizer: eventCommitment.isOrganizer,
            attendance: eventCommitment.attendance,
            organizerEmail: eventCommitment.organizer.email,
            context: `Calendar event from ${event.calendarId}. ${eventCommitment.attendance.accepted}/${eventCommitment.attendance.total} confirmed.`,
          },
          updatedAt: now,
        })
        .where(eq(commitment.id, existingCommitment.id));

      log.debug("Updated calendar commitment", {
        commitmentId: existingCommitment.id,
        eventId: event.id,
        title: eventCommitment.title,
        status: dbStatus,
        previousStatus: existingCommitment.status,
      });
    } else {
      // Create new commitment for this event
      const commitmentId = randomUUID();

      await db.insert(commitment).values({
        id: commitmentId,
        organizationId,
        direction,
        sourceAccountId,
        sourceConversationId: existingConversation?.id ?? targetConversationId,
        title: eventCommitment.title,
        description: eventCommitment.description,
        dueDate: eventCommitment.dueDate,
        dueDateSource: "explicit" as const,
        status: dbStatus,
        confidence: eventCommitment.confidence,
        metadata: {
          eventId: event.id,
          calendarId: event.calendarId,
          isOrganizer: eventCommitment.isOrganizer,
          attendance: eventCommitment.attendance,
          organizerEmail: eventCommitment.organizer.email,
          context: `Calendar event from ${event.calendarId}. ${eventCommitment.attendance.accepted}/${eventCommitment.attendance.total} confirmed.`,
        },
        createdAt: now,
        updatedAt: now,
      });

      // Trigger task creation for new commitment
      await createTaskForCommitmentTask.trigger({
        commitmentId,
      });

      // Trigger UIO processing for cross-source intelligence
      await processCommitmentTask.trigger({
        organizationId,
        commitment: {
          id: commitmentId,
          title: eventCommitment.title,
          description: eventCommitment.description,
          dueDate: eventCommitment.dueDate,
          confidence: eventCommitment.confidence,
        },
        sourceType: "calendar",
        sourceAccountId,
        conversationId: existingConversation?.id ?? targetConversationId,
        originalCommitmentId: commitmentId,
      });

      result.commitmentsCreated++;

      log.debug("Created calendar commitment", {
        commitmentId,
        eventId: event.id,
        title: eventCommitment.title,
        status: dbStatus,
      });
    }
  }

  return result;
}

// =============================================================================
// RELATED EMAIL THREAD LINKING
// =============================================================================

/**
 * Find and link related email threads to a calendar event.
 * Uses participant matching and subject/title keyword matching.
 */
async function linkRelatedEmailThreads(
  event: CalendarEventData,
  calendarConversationId: string,
  _sourceAccountId: string,
  organizationId: string
): Promise<number> {
  let linkedCount = 0;

  // Get attendee emails for matching
  const attendeeEmails = [
    event.organizer.email,
    ...event.attendees.map((a) => a.email),
  ].filter((email, idx, arr) => arr.indexOf(email) === idx);

  if (attendeeEmails.length === 0) {
    return 0;
  }

  // Extract keywords from event title for subject matching
  const titleKeywords = extractSearchKeywords(event.title);

  // Look for email threads in the organization with matching participants
  // and optionally matching subject keywords
  // Search within a reasonable time window (30 days before/after event creation)
  const searchStartDate = new Date(
    event.created.getTime() - 30 * 24 * 60 * 60 * 1000
  );
  const searchEndDate = new Date(
    event.start.getTime() + 7 * 24 * 60 * 60 * 1000
  );

  // Query for potentially related email threads
  const potentialMatches = await db.query.emailThread.findMany({
    where: and(
      // Within time range
      gte(emailThread.lastMessageAt, searchStartDate),
      lte(emailThread.firstMessageAt, searchEndDate),
      // Not archived
      eq(emailThread.isArchived, false)
    ),
    columns: {
      id: true,
      subject: true,
      participantEmails: true,
      lastMessageAt: true,
      accountId: true,
    },
    limit: 100, // Reasonable limit to avoid performance issues
  });

  // Get the email account to verify organization
  const matchedThreadsInOrg: Array<{
    id: string;
    subject: string;
    participantEmails: string[] | null;
    matchScore: number;
    matchReason: string;
  }> = [];

  for (const thread of potentialMatches) {
    // Get account to verify organization
    const account = await db.query.emailAccount.findFirst({
      where: eq(emailAccount.id, thread.accountId),
      columns: { organizationId: true },
    });

    if (!account || account.organizationId !== organizationId) {
      continue;
    }

    // Calculate match score
    let matchScore = 0;
    const matchReasons: string[] = [];

    // Check participant overlap
    const threadParticipants = thread.participantEmails ?? [];
    const participantOverlap = attendeeEmails.filter((email) =>
      threadParticipants.some((p) => p.toLowerCase() === email.toLowerCase())
    );

    if (participantOverlap.length > 0) {
      // Score based on overlap ratio
      const overlapRatio =
        participantOverlap.length / Math.max(attendeeEmails.length, 1);
      matchScore += overlapRatio * 0.6; // Max 0.6 from participants
      matchReasons.push(`shared_participants:${participantOverlap.length}`);
    }

    // Check subject/title keyword match
    if (thread.subject && titleKeywords.length > 0) {
      const subjectLower = thread.subject.toLowerCase();
      const keywordMatches = titleKeywords.filter((kw) =>
        subjectLower.includes(kw.toLowerCase())
      );

      if (keywordMatches.length > 0) {
        const keywordRatio = keywordMatches.length / titleKeywords.length;
        matchScore += keywordRatio * 0.4; // Max 0.4 from keywords
        matchReasons.push(`subject_match:${keywordMatches.join(",")}`);
      }
    }

    // Only consider threads with meaningful match
    if (matchScore >= 0.3) {
      matchedThreadsInOrg.push({
        id: thread.id,
        subject: thread.subject ?? "",
        participantEmails: thread.participantEmails,
        matchScore,
        matchReason: matchReasons.join(";"),
      });
    }
  }

  // Sort by match score and take top matches
  matchedThreadsInOrg.sort((a, b) => b.matchScore - a.matchScore);
  const topMatches = matchedThreadsInOrg.slice(0, 5); // Limit to top 5 related threads

  // Create related conversation entries
  for (const match of topMatches) {
    // First, check if there's a conversation record for this email thread
    // Email threads should have corresponding conversation records in the unified table
    let emailConversationId: string | null = null;

    // Check if email thread has a corresponding conversation in the conversation table
    // This lookup is based on convention that email conversations reference the thread ID
    const emailConversation = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.externalId, match.id),
        sql`${conversation.conversationType} = 'thread'`
      ),
      columns: { id: true },
    });

    if (emailConversation) {
      emailConversationId = emailConversation.id;
    } else {
      // If no conversation record exists, we'll need to create a link
      // to the email thread differently - for now, skip these
      // In a full implementation, we'd migrate email threads to conversations
      continue;
    }

    // Check if relationship already exists
    const existingRelation = await db.query.relatedConversation.findFirst({
      where: and(
        eq(relatedConversation.conversationId, calendarConversationId),
        eq(relatedConversation.relatedConversationId, emailConversationId),
        eq(relatedConversation.relationType, "calendar_email")
      ),
    });

    if (!existingRelation) {
      const relationId = randomUUID();

      await db.insert(relatedConversation).values({
        id: relationId,
        conversationId: calendarConversationId,
        relatedConversationId: emailConversationId,
        relationType: "calendar_email" as const,
        confidence: match.matchScore,
        matchReason: match.matchReason,
        isAutoDetected: true,
        isDismissed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      linkedCount++;

      log.debug("Linked calendar event to email thread", {
        calendarConversationId,
        emailConversationId,
        matchScore: match.matchScore,
        matchReason: match.matchReason,
      });
    }
  }

  return linkedCount;
}

/**
 * Extract meaningful keywords from text for search matching.
 * Filters out common stop words and short words.
 */
function extractSearchKeywords(text: string): string[] {
  if (!text) return [];

  // Common stop words to filter out
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "about",
    "above",
    "after",
    "again",
    "all",
    "also",
    "am",
    "any",
    "because",
    "before",
    "being",
    "below",
    "between",
    "both",
    "call",
    "catch",
    "re",
    "meeting",
    "call",
    "sync",
    "update",
    "discussion",
    "review",
    "follow",
    "up",
    "weekly",
    "daily",
    "monthly",
  ]);

  // Split into words, filter, and return
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Remove punctuation
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !stopWords.has(word));

  // Return unique keywords
  return [...new Set(words)];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build a brief summary for a calendar event.
 * Shows event title and context, NOT raw date/time (dates are shown separately in the UI).
 */
function buildEventBrief(event: CalendarEventData): string {
  const parts: string[] = [];

  // Event title is the primary info
  if (event.title) {
    parts.push(event.title);
  }

  // Add context about the meeting type
  const contextParts: string[] = [];

  // Attendees info
  const acceptedCount = event.attendees.filter(
    (a) => a.responseStatus === "accepted"
  ).length;
  if (event.attendees.length > 0) {
    contextParts.push(`${acceptedCount}/${event.attendees.length} attending`);
  }

  // Meeting type
  if (event.isAllDay) {
    contextParts.push("All-day");
  }

  // Location or video call
  if (event.conferenceData) {
    contextParts.push("Video call");
  } else if (event.location) {
    // Truncate long locations
    const loc =
      event.location.length > 30
        ? `${event.location.slice(0, 30)}...`
        : event.location;
    contextParts.push(loc);
  }

  // Add organizer if different from title
  if (event.organizer.name && !event.title?.includes(event.organizer.name)) {
    contextParts.push(`Organized by ${event.organizer.name}`);
  }

  // Combine title with context
  if (contextParts.length > 0) {
    parts.push(contextParts.join(" • "));
  }

  return parts.join(" — ");
}

/**
 * Calculate urgency score for a calendar event.
 */
function calculateEventUrgency(event: CalendarEventData): number {
  const now = new Date();
  const hoursUntilEvent =
    (event.start.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Events happening soon are more urgent
  if (hoursUntilEvent < 1) return 1.0;
  if (hoursUntilEvent < 4) return 0.9;
  if (hoursUntilEvent < 24) return 0.7;
  if (hoursUntilEvent < 72) return 0.5;
  return 0.3;
}

/**
 * Calculate importance score for a calendar event.
 */
function calculateEventImportance(event: CalendarEventData): number {
  let score = 0.5;

  // More attendees = more important
  if (event.attendees.length > 10) score += 0.2;
  else if (event.attendees.length > 5) score += 0.15;
  else if (event.attendees.length > 2) score += 0.1;

  // Events with video conference are often more formal
  if (event.conferenceData) score += 0.1;

  // All-day events are often important
  if (event.isAllDay) score += 0.05;

  // Recurring events indicate regular importance
  if (event.recurringEventId) score += 0.05;

  return Math.min(score, 1.0);
}

/**
 * Priority tier type for calendar events.
 */
type PriorityTier = "urgent" | "high" | "medium" | "low";

/**
 * Determine priority tier for a calendar event.
 */
function determineEventPriority(event: CalendarEventData): PriorityTier {
  const urgency = calculateEventUrgency(event);
  const importance = calculateEventImportance(event);
  const combined = (urgency + importance) / 2;

  if (combined >= 0.8) return "urgent";
  if (combined >= 0.6) return "high";
  if (combined >= 0.4) return "medium";
  return "low";
}

/**
 * Map single event commitment status to database status.
 */
type CommitmentStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "overdue"
  | "waiting"
  | "snoozed";

function mapEventCommitmentStatus(
  status: CalendarEventCommitment["status"]
): CommitmentStatus {
  switch (status) {
    case "confirmed":
      return "pending"; // Confirmed attendance but event hasn't happened yet
    case "cancelled":
      return "cancelled";
    case "pending":
    default:
      return "waiting"; // Awaiting responses
  }
}

// =============================================================================
// SCHEDULED SYNC
// =============================================================================

/**
 * Scheduled task to sync calendars for all active accounts.
 * Runs every 15 minutes.
 */
export const syncCalendarSchedule = schedules.task({
  id: "calendar-sync-schedule",
  cron: "*/15 * * * *", // Every 15 minutes
  run: async () => {
    log.info("Starting scheduled calendar sync");

    // Get all active email accounts with calendar support
    const accountsToSync = await db.query.emailAccount.findMany({
      where: eq(emailAccount.status, "active"),
      columns: { id: true, provider: true },
    });

    // Filter to accounts with calendar support
    const calendarAccounts = accountsToSync.filter((a) =>
      isCalendarSupported(a.provider ?? "")
    );

    if (calendarAccounts.length === 0) {
      log.info("No accounts to sync calendars");
      return { scheduled: true, accountsTriggered: 0 };
    }

    // Trigger calendar sync for each account
    for (const account of calendarAccounts) {
      await syncCalendarEventsTask.trigger({
        accountId: account.id,
        daysBack: 1, // Only look back 1 day for scheduled sync
        daysForward: 14, // Look forward 2 weeks
      });
    }

    log.info("Scheduled calendar sync triggered", {
      accountsTriggered: calendarAccounts.length,
    });

    return { scheduled: true, accountsTriggered: calendarAccounts.length };
  },
});

// =============================================================================
// ON-DEMAND SYNC
// =============================================================================

/**
 * On-demand calendar sync for immediate sync.
 */
export const syncCalendarOnDemandTask = task({
  id: "calendar-sync-on-demand",
  queue: {
    name: "calendar-sync-priority",
    concurrencyLimit: 3,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: { accountId: string }): Promise<CalendarSyncResult> => {
    log.info("On-demand calendar sync starting", {
      accountId: payload.accountId,
    });

    // Use the main sync task with default settings
    const result = await syncCalendarEventsTask.triggerAndWait({
      accountId: payload.accountId,
      daysBack: 7,
      daysForward: 30,
      force: true,
    });

    if (result.ok) {
      return result.output;
    }

    return {
      success: false,
      accountId: payload.accountId,
      eventsProcessed: 0,
      eventsCreated: 0,
      eventsUpdated: 0,
      commitmentsCreated: 0,
      relatedThreadsLinked: 0,
      errors: [String(result.error ?? "Unknown error")],
    };
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type { CalendarSyncPayload, CalendarSyncResult };
