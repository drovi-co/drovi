import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  refreshGmailToken,
  refreshOutlookToken,
} from "@memorystack/auth/providers";
import { db } from "@memorystack/db";
import {
  commitment,
  conversation,
  member,
  relatedConversation,
  sourceAccount,
} from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// TOKEN DECRYPTION
// =============================================================================

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_VERSION = "v1";

/**
 * Get the encryption key from environment.
 */
function getEncryptionKey(): Buffer {
  const keyString = env.TOKEN_ENCRYPTION_KEY;

  if (!keyString) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  }

  // If key is base64 encoded, decode it
  if (keyString.length === 44 && keyString.endsWith("=")) {
    const decoded = Buffer.from(keyString, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  }

  const keyBuffer = Buffer.from(keyString, "utf-8");
  if (keyBuffer.length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 characters");
  }

  return keyBuffer.subarray(0, 32);
}

/**
 * Check if a string is an encrypted token.
 */
function isEncryptedToken(maybeEncrypted: string): boolean {
  return maybeEncrypted.startsWith(`${KEY_VERSION}:`);
}

/**
 * Decrypt a stored token.
 */
function decryptToken(encrypted: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted token format");
  }

  const [version, ivBase64, authTagBase64, ciphertextBase64] = parts;
  if (version !== KEY_VERSION) {
    throw new Error(`Unsupported token encryption version: ${version}`);
  }

  if (!(ivBase64 && authTagBase64 && ciphertextBase64)) {
    throw new Error("Invalid encrypted token format: missing components");
  }

  const iv = Buffer.from(ivBase64, "base64url");
  const authTag = Buffer.from(authTagBase64, "base64url");
  const ciphertext = Buffer.from(ciphertextBase64, "base64url");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid encrypted token format: bad lengths");
  }

  const key = getEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

/**
 * Safely decrypt a token (handles both encrypted and plaintext).
 */
function safeDecryptToken(maybeEncrypted: string): string {
  if (!isEncryptedToken(maybeEncrypted)) {
    return maybeEncrypted;
  }
  return decryptToken(maybeEncrypted);
}

/**
 * Encrypt a token for storage.
 * Format: version:iv:authTag:ciphertext
 */
function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    KEY_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

/**
 * Check if token encryption is configured.
 */
function isTokenEncryptionConfigured(): boolean {
  return Boolean(env.TOKEN_ENCRYPTION_KEY);
}

/**
 * Safely encrypt a token (returns plaintext if encryption not configured).
 */
function safeEncryptToken(plaintext: string): string {
  if (!isTokenEncryptionConfigured()) {
    return plaintext;
  }
  return encryptToken(plaintext);
}

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const dateSchema = z.coerce.date();

const attendeeSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  optional: z.boolean().optional(),
});

const recurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().min(1).default(1),
  until: dateSchema.optional(),
  count: z.number().optional(),
  byDay: z.array(z.string()).optional(),
  byMonthDay: z.array(z.number()).optional(),
  byMonth: z.array(z.number()).optional(),
});

const reminderSchema = z.object({
  method: z.enum(["email", "popup"]),
  minutes: z.number().min(0).max(40_320), // Max 4 weeks
});

// =============================================================================
// TYPES
// =============================================================================

interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  status: "confirmed" | "tentative" | "cancelled";
  visibility: "public" | "private" | "default";
  organizer: {
    email: string;
    name?: string;
    responseStatus: string;
  };
  attendees: Array<{
    email: string;
    name?: string;
    responseStatus: string;
    organizer?: boolean;
    self?: boolean;
  }>;
  conferenceData?: {
    type: string;
    entryPoints: Array<{ type: string; uri: string }>;
  };
  htmlLink?: string;
  created: Date;
  updated: Date;
  // Calendar colors
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

interface CalendarInfo {
  id: string;
  name: string;
  description?: string;
  primary: boolean;
  accessRole: string;
  backgroundColor?: string;
  timeZone: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Verify user is a member of the organization
 */
async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<void> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization.",
    });
  }
}

/**
 * Get email account and verify access.
 * Automatically refreshes token if expired or about to expire.
 */
async function getAccountWithAccess(
  userId: string,
  accountId: string
): Promise<{
  id: string;
  provider: "gmail" | "outlook";
  email: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}> {
  const account = await db.query.sourceAccount.findFirst({
    where: eq(sourceAccount.id, accountId),
    columns: {
      id: true,
      provider: true,
      externalId: true,
      accessToken: true,
      refreshToken: true,
      tokenExpiresAt: true,
      organizationId: true,
    },
  });

  if (!account) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Email account not found",
    });
  }

  // Verify tokens exist
  if (!account.accessToken || !account.refreshToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Account is missing OAuth tokens. Please reconnect your account.",
    });
  }

  // Verify user has access to this account's organization
  await verifyOrgMembership(userId, account.organizationId);

  // Decrypt tokens from database
  let accessToken = safeDecryptToken(account.accessToken);
  const refreshToken = safeDecryptToken(account.refreshToken);
  let tokenExpiresAt = account.tokenExpiresAt ?? new Date();
  const provider = account.provider as "gmail" | "outlook";

  // Check if token is expired or about to expire (within 5 minutes)
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (tokenExpiresAt < fiveMinutesFromNow) {
    try {
      // Refresh the token using decrypted refresh token
      if (provider === "gmail") {
        const refreshed = await refreshGmailToken(refreshToken);
        accessToken = refreshed.accessToken;
        tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
      } else {
        const refreshed = await refreshOutlookToken(refreshToken);
        accessToken = refreshed.accessToken;
        tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
      }

      // Store the refreshed token encrypted
      await db
        .update(sourceAccount)
        .set({
          accessToken: safeEncryptToken(accessToken),
          tokenExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, accountId));
    } catch (error) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: `Failed to refresh ${provider} token. Please reconnect your account.`,
        cause: error,
      });
    }
  }

  return {
    id: account.id,
    provider,
    email: account.externalId,
    accessToken,
    refreshToken,
    tokenExpiresAt,
  };
}

/**
 * Make Google Calendar API request
 */
async function googleCalendarRequest<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "Calendar authentication failed. Please reconnect your account.",
      });
    }
    if (response.status === 403) {
      // Check if this is a scope/permission issue
      if (
        errorText.includes("insufficientPermissions") ||
        errorText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Calendar access not granted. Please disconnect and reconnect your email account to grant calendar permissions.",
        });
      }
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied to calendar resource.",
      });
    }
    if (response.status === 404) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Calendar resource not found",
      });
    }
    if (response.status === 429) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Calendar API quota exceeded. Please try again later.",
      });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Calendar API error: ${errorText}`,
    });
  }

  // Handle empty responses (e.g., DELETE)
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

/**
 * Make Microsoft Graph Calendar API request
 */
async function graphCalendarRequest<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 401) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "Calendar authentication failed. Please reconnect your account.",
      });
    }
    if (response.status === 403) {
      // Check if this is a scope/permission issue
      if (
        errorText.includes("Authorization_RequestDenied") ||
        errorText.includes("insufficient privileges")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Calendar access not granted. Please disconnect and reconnect your email account to grant calendar permissions.",
        });
      }
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied to calendar resource.",
      });
    }
    if (response.status === 404) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Calendar resource not found",
      });
    }
    if (response.status === 429) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Calendar API quota exceeded. Please try again later.",
      });
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Calendar API error: ${errorText}`,
    });
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

/**
 * Convert Google Calendar event to standard format
 */
/**
 * Get the UTC offset for a timezone at a specific date.
 * Returns offset in minutes (e.g., +60 for UTC+01:00)
 */
function getTimezoneOffsetMinutes(timeZone: string, dateTime: string): number {
  try {
    // Create a date in the target timezone
    const date = new Date(dateTime);

    // Format in the target timezone to get the offset
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    });

    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");

    if (tzPart?.value) {
      // Parse offset like "GMT+01:00" or "GMT-05:00"
      const match = tzPart.value.match(/GMT([+-])(\d{2}):(\d{2})/);
      if (match?.[1] && match[2] && match[3]) {
        const sign = match[1] === "+" ? 1 : -1;
        const hours = Number.parseInt(match[2], 10);
        const minutes = Number.parseInt(match[3], 10);
        return sign * (hours * 60 + minutes);
      }
    }

    // Fallback: use browser's Intl to get offset
    const utcDate = new Date(`${dateTime}Z`);
    const localStr = utcDate.toLocaleString("en-US", { timeZone });
    const localDate = new Date(localStr);
    return Math.round((localDate.getTime() - utcDate.getTime()) / 60_000);
  } catch {
    // Default to UTC if timezone lookup fails
    return 0;
  }
}

/**
 * Parse Google Calendar dateTime string properly.
 * Google can return either:
 * - "2024-01-14T11:20:00+02:00" (with timezone offset)
 * - "2024-01-14T11:20:00" (without timezone, need to use timeZone field)
 */
function parseGoogleDateTime(
  dateTime: string | undefined,
  date: string | undefined,
  timeZone: string | undefined
): Date {
  if (!dateTime) {
    // All-day event - use the date field
    // Parse as local midnight
    if (date) {
      const [yearStr, monthStr, dayStr] = date.split("-");
      const year = Number(yearStr) || 2000;
      const month = Number(monthStr) || 1;
      const day = Number(dayStr) || 1;
      return new Date(year, month - 1, day);
    }
    return new Date();
  }

  // Check if dateTime already has timezone info (+ or - followed by time offset, or ends with Z)
  const hasTimezone =
    /[+-]\d{2}:\d{2}$/.test(dateTime) || dateTime.endsWith("Z");

  if (hasTimezone) {
    // Already has timezone info, parse directly
    return new Date(dateTime);
  }

  // No timezone in dateTime - use the timeZone field to interpret
  // The dateTime is in the event's local timezone
  if (timeZone) {
    // Get the offset for this timezone
    const offsetMinutes = getTimezoneOffsetMinutes(timeZone, dateTime);

    // Parse the datetime parts manually
    const [datePart = "", timePart = "00:00:00"] = dateTime.split("T");
    const [yearStr, monthStr, dayStr] = datePart.split("-");
    const year = Number(yearStr) || 2000;
    const month = Number(monthStr) || 1;
    const day = Number(dayStr) || 1;
    const [hoursStr, minutesStr, secondsStr = "0"] = timePart.split(":");
    const hours = Number.parseInt(hoursStr || "0", 10);
    const minutes = Number.parseInt(minutesStr || "0", 10);
    const seconds = Number.parseInt(secondsStr, 10);

    // Create UTC date by subtracting the timezone offset
    const utcMs =
      Date.UTC(year, month - 1, day, hours, minutes, seconds) -
      offsetMinutes * 60 * 1000;

    return new Date(utcMs);
  }

  // Last resort: parse as-is and let JS handle it (will use local timezone)
  return new Date(dateTime);
}

function convertGoogleEvent(
  event: Record<string, unknown>,
  calendarId: string
): CalendarEvent {
  const start = event.start as Record<string, string> | undefined;
  const end = event.end as Record<string, string> | undefined;
  const organizer = event.organizer as Record<string, string> | undefined;
  const attendees = (event.attendees as Record<string, unknown>[]) || [];
  const conferenceData = event.conferenceData as
    | Record<string, unknown>
    | undefined;

  const isAllDay = !start?.dateTime;
  const startDate = parseGoogleDateTime(
    start?.dateTime,
    start?.date,
    start?.timeZone
  );
  const endDate = parseGoogleDateTime(end?.dateTime, end?.date, end?.timeZone);

  // Google Calendar color ID to hex color mapping
  const googleColorMap: Record<
    string,
    { background: string; foreground: string }
  > = {
    "1": { background: "#a4bdfc", foreground: "#1d1d1d" }, // Lavender
    "2": { background: "#7ae7bf", foreground: "#1d1d1d" }, // Sage
    "3": { background: "#dbadff", foreground: "#1d1d1d" }, // Grape
    "4": { background: "#ff887c", foreground: "#1d1d1d" }, // Flamingo
    "5": { background: "#fbd75b", foreground: "#1d1d1d" }, // Banana
    "6": { background: "#ffb878", foreground: "#1d1d1d" }, // Tangerine
    "7": { background: "#46d6db", foreground: "#1d1d1d" }, // Peacock
    "8": { background: "#e1e1e1", foreground: "#1d1d1d" }, // Graphite
    "9": { background: "#5484ed", foreground: "#ffffff" }, // Blueberry
    "10": { background: "#51b749", foreground: "#ffffff" }, // Basil
    "11": { background: "#dc2127", foreground: "#ffffff" }, // Tomato
  };

  const colorId = event.colorId as string | undefined;
  const eventColor = colorId ? googleColorMap[colorId] : undefined;

  return {
    id: event.id as string,
    calendarId,
    title: (event.summary as string) || "(No title)",
    description: event.description as string | undefined,
    location: event.location as string | undefined,
    start: startDate,
    end: endDate,
    isAllDay,
    status:
      (event.status as "confirmed" | "tentative" | "cancelled") || "confirmed",
    visibility:
      (event.visibility as "public" | "private" | "default") || "default",
    colorId,
    backgroundColor: eventColor?.background,
    foregroundColor: eventColor?.foreground,
    organizer: {
      email: organizer?.email || "",
      name: organizer?.displayName,
      responseStatus: "accepted",
    },
    attendees: attendees.map((a) => ({
      email: a.email as string,
      name: a.displayName as string | undefined,
      responseStatus: a.responseStatus as string,
      organizer: a.organizer as boolean | undefined,
      self: a.self as boolean | undefined,
    })),
    conferenceData: conferenceData
      ? {
          type:
            (
              (conferenceData.conferenceSolution as Record<string, unknown>)
                ?.key as Record<string, string>
            )?.type || "other",
          entryPoints: (
            (conferenceData.entryPoints as Record<string, string>[]) || []
          )
            .filter((ep) => ep.entryPointType && ep.uri)
            .map((ep) => ({
              type: ep.entryPointType as string,
              uri: ep.uri as string,
            })),
        }
      : undefined,
    htmlLink: event.htmlLink as string | undefined,
    created: new Date(event.created as string),
    updated: new Date(event.updated as string),
  };
}

/**
 * Convert Outlook event to standard format
 */
function convertOutlookEvent(
  event: Record<string, unknown>,
  calendarId: string,
  calendarColor?: string
): CalendarEvent {
  const start = event.start as Record<string, string> | undefined;
  const end = event.end as Record<string, string> | undefined;
  const organizer = event.organizer as Record<string, unknown> | undefined;
  const attendees = (event.attendees as Record<string, unknown>[]) || [];
  const onlineMeeting = event.onlineMeeting as
    | Record<string, string>
    | undefined;

  const isAllDay = event.isAllDay as boolean;
  const startDate = new Date(start?.dateTime || "");
  const endDate = new Date(end?.dateTime || "");

  const organizerEmail = organizer?.emailAddress as
    | Record<string, string>
    | undefined;

  // Outlook category to color mapping (common Outlook category colors)
  const outlookCategoryColors: Record<
    string,
    { background: string; foreground: string }
  > = {
    "Red category": { background: "#e74856", foreground: "#ffffff" },
    "Orange category": { background: "#ff8c00", foreground: "#ffffff" },
    "Yellow category": { background: "#ffab45", foreground: "#1d1d1d" },
    "Green category": { background: "#44a047", foreground: "#ffffff" },
    "Blue category": { background: "#4a90d9", foreground: "#ffffff" },
    "Purple category": { background: "#8764b8", foreground: "#ffffff" },
  };

  // Get color from categories or fall back to calendar color
  const categories = (event.categories as string[]) || [];
  const firstCategory = categories[0];
  const categoryColor = firstCategory
    ? outlookCategoryColors[firstCategory]
    : undefined;

  // Use category color, then calendar color, then undefined for default
  const backgroundColor = categoryColor?.background || calendarColor;
  const foregroundColor =
    categoryColor?.foreground || (calendarColor ? "#ffffff" : undefined);

  return {
    id: event.id as string,
    calendarId,
    title: (event.subject as string) || "(No title)",
    description:
      (event.bodyPreview as string) ||
      (event.body as Record<string, string>)?.content,
    location: (event.location as Record<string, string>)?.displayName,
    start: startDate,
    end: endDate,
    isAllDay,
    status: event.isCancelled ? "cancelled" : "confirmed",
    visibility:
      (event.sensitivity as string) === "private" ? "private" : "default",
    colorId: firstCategory,
    backgroundColor,
    foregroundColor,
    organizer: {
      email: organizerEmail?.address || "",
      name: organizerEmail?.name,
      responseStatus: "accepted",
    },
    attendees: attendees.map((a) => {
      const email = a.emailAddress as Record<string, string>;
      return {
        email: email?.address || "",
        name: email?.name,
        responseStatus:
          (a.status as Record<string, string>)?.response || "none",
        organizer: (a.type as string) === "organizer",
      };
    }),
    conferenceData: onlineMeeting?.joinUrl
      ? {
          type: "teams",
          entryPoints: [{ type: "video", uri: onlineMeeting.joinUrl }],
        }
      : undefined,
    htmlLink: event.webLink as string | undefined,
    created: new Date(event.createdDateTime as string),
    updated: new Date(event.lastModifiedDateTime as string),
  };
}

// =============================================================================
// CALENDAR ROUTER
// =============================================================================

export const calendarRouter = router({
  // ===========================================================================
  // CALENDAR OPERATIONS
  // ===========================================================================

  /**
   * List user's calendars
   */
  listCalendars: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }): Promise<CalendarInfo[]> => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      if (account.provider === "gmail") {
        const data = await googleCalendarRequest<{
          items: Record<string, unknown>[];
        }>("/users/me/calendarList", account.accessToken);

        return data.items.map((cal) => ({
          id: cal.id as string,
          name: (cal.summary as string) || "Calendar",
          description: cal.description as string | undefined,
          primary: cal.primary as boolean,
          accessRole: (cal.accessRole as string) || "reader",
          backgroundColor: cal.backgroundColor as string | undefined,
          timeZone: (cal.timeZone as string) || "UTC",
        }));
      }

      // Outlook
      const data = await graphCalendarRequest<{
        value: Record<string, unknown>[];
      }>("/me/calendars", account.accessToken);

      return data.value.map((cal) => ({
        id: cal.id as string,
        name: (cal.name as string) || "Calendar",
        description: undefined,
        primary: cal.isDefaultCalendar as boolean,
        accessRole: cal.canEdit ? "owner" : "reader",
        backgroundColor: (cal.hexColor as string) || undefined,
        timeZone: "UTC",
      }));
    }),

  /**
   * List events in a date range
   */
  listEvents: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        calendarId: z.string().optional(),
        timeMin: dateSchema,
        timeMax: dateSchema,
        maxResults: z.number().max(500).optional(),
        singleEvents: z.boolean().optional(),
        query: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      const calendarId = input.calendarId || "primary";

      if (account.provider === "gmail") {
        // First fetch the calendar's color
        let calendarColor: string | undefined;
        try {
          const calendarInfo = await googleCalendarRequest<
            Record<string, unknown>
          >(
            `/users/me/calendarList/${encodeURIComponent(calendarId)}`,
            account.accessToken
          );
          calendarColor = calendarInfo.backgroundColor as string | undefined;
        } catch {
          // Calendar info not critical, continue without it
        }

        const params = new URLSearchParams({
          timeMin: input.timeMin.toISOString(),
          timeMax: input.timeMax.toISOString(),
          maxResults: String(input.maxResults || 250),
          singleEvents: String(input.singleEvents ?? true),
          orderBy: "startTime",
        });

        if (input.query) {
          params.set("q", input.query);
        }

        const data = await googleCalendarRequest<{
          items: Record<string, unknown>[];
          nextPageToken?: string;
        }>(
          `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
          account.accessToken
        );

        return {
          items: data.items.map((e) => {
            const event = convertGoogleEvent(e, calendarId);
            // Apply calendar color if event doesn't have its own color
            if (!event.backgroundColor && calendarColor) {
              event.backgroundColor = calendarColor;
              event.foregroundColor = "#ffffff";
            }
            return event;
          }),
          nextPageToken: data.nextPageToken,
        };
      }

      // Outlook
      const params = new URLSearchParams({
        $filter: `start/dateTime ge '${input.timeMin.toISOString()}' and end/dateTime le '${input.timeMax.toISOString()}'`,
        $orderby: "start/dateTime",
        $top: String(input.maxResults || 250),
      });

      if (input.query) {
        params.set("$search", `"${input.query}"`);
      }

      const path =
        calendarId === "primary"
          ? `/me/events?${params}`
          : `/me/calendars/${encodeURIComponent(calendarId)}/events?${params}`;

      const data = await graphCalendarRequest<{
        value: Record<string, unknown>[];
        "@odata.nextLink"?: string;
      }>(path, account.accessToken);

      return {
        items: data.value.map((e) => convertOutlookEvent(e, calendarId)),
        nextPageToken: data["@odata.nextLink"],
      };
    }),

  /**
   * Get a single event
   */
  getEvent: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        calendarId: z.string(),
        eventId: z.string(),
      })
    )
    .query(async ({ ctx, input }): Promise<CalendarEvent | null> => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      try {
        if (account.provider === "gmail") {
          const event = await googleCalendarRequest<Record<string, unknown>>(
            `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
            account.accessToken
          );
          return convertGoogleEvent(event, input.calendarId);
        }

        // Outlook
        const event = await graphCalendarRequest<Record<string, unknown>>(
          `/me/events/${encodeURIComponent(input.eventId)}`,
          account.accessToken
        );
        return convertOutlookEvent(event, input.calendarId);
      } catch (err) {
        if (err instanceof TRPCError && err.code === "NOT_FOUND") {
          return null;
        }
        throw err;
      }
    }),

  /**
   * Create a new event
   */
  createEvent: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        calendarId: z.string().optional(),
        title: z.string().min(1).max(1000),
        description: z.string().max(8000).optional(),
        location: z.string().max(500).optional(),
        start: dateSchema,
        end: dateSchema,
        isAllDay: z.boolean().optional(),
        attendees: z.array(attendeeSchema).optional(),
        recurrence: recurrenceSchema.optional(),
        reminders: z.array(reminderSchema).optional(),
        addConference: z.boolean().optional(),
        visibility: z.enum(["default", "public", "private"]).optional(),
        sendUpdates: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }): Promise<CalendarEvent> => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      const calendarId = input.calendarId || "primary";

      if (account.provider === "gmail") {
        const body: Record<string, unknown> = {
          summary: input.title,
          description: input.description,
          location: input.location,
          visibility: input.visibility,
        };

        if (input.isAllDay) {
          body.start = { date: input.start.toISOString().split("T")[0] };
          body.end = { date: input.end.toISOString().split("T")[0] };
        } else {
          body.start = { dateTime: input.start.toISOString() };
          body.end = { dateTime: input.end.toISOString() };
        }

        if (input.attendees) {
          body.attendees = input.attendees.map((a) => ({
            email: a.email,
            displayName: a.name,
            optional: a.optional,
          }));
        }

        if (input.addConference) {
          body.conferenceData = {
            createRequest: { requestId: crypto.randomUUID() },
          };
        }

        const params = new URLSearchParams();
        if (input.addConference) {
          params.set("conferenceDataVersion", "1");
        }
        if (input.sendUpdates) {
          params.set("sendUpdates", "all");
        }

        const event = await googleCalendarRequest<Record<string, unknown>>(
          `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
          account.accessToken,
          { method: "POST", body: JSON.stringify(body) }
        );

        return convertGoogleEvent(event, calendarId);
      }

      // Outlook
      const body: Record<string, unknown> = {
        subject: input.title,
        body: { contentType: "text", content: input.description || "" },
        location: input.location ? { displayName: input.location } : undefined,
        isAllDay: input.isAllDay,
        sensitivity: input.visibility === "private" ? "private" : "normal",
      };

      if (input.isAllDay) {
        body.start = { dateTime: input.start.toISOString(), timeZone: "UTC" };
        body.end = { dateTime: input.end.toISOString(), timeZone: "UTC" };
      } else {
        body.start = { dateTime: input.start.toISOString(), timeZone: "UTC" };
        body.end = { dateTime: input.end.toISOString(), timeZone: "UTC" };
      }

      if (input.attendees) {
        body.attendees = input.attendees.map((a) => ({
          emailAddress: { address: a.email, name: a.name },
          type: a.optional ? "optional" : "required",
        }));
      }

      if (input.addConference) {
        body.isOnlineMeeting = true;
        body.onlineMeetingProvider = "teamsForBusiness";
      }

      const path =
        calendarId === "primary"
          ? "/me/events"
          : `/me/calendars/${encodeURIComponent(calendarId)}/events`;

      const event = await graphCalendarRequest<Record<string, unknown>>(
        path,
        account.accessToken,
        { method: "POST", body: JSON.stringify(body) }
      );

      return convertOutlookEvent(event, calendarId);
    }),

  /**
   * Update an existing event
   */
  updateEvent: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        eventId: z.string(),
        calendarId: z.string().optional(),
        title: z.string().min(1).max(1000).optional(),
        description: z.string().max(8000).optional(),
        location: z.string().max(500).optional(),
        start: dateSchema.optional(),
        end: dateSchema.optional(),
        isAllDay: z.boolean().optional(),
        attendees: z.array(attendeeSchema).optional(),
        recurrence: recurrenceSchema.optional(),
        reminders: z.array(reminderSchema).optional(),
        visibility: z.enum(["default", "public", "private"]).optional(),
        sendUpdates: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }): Promise<CalendarEvent> => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      const calendarId = input.calendarId || "primary";

      if (account.provider === "gmail") {
        const body: Record<string, unknown> = {};

        if (input.title) {
          body.summary = input.title;
        }
        if (input.description !== undefined) {
          body.description = input.description;
        }
        if (input.location !== undefined) {
          body.location = input.location;
        }
        if (input.visibility) {
          body.visibility = input.visibility;
        }

        if (input.start && input.end) {
          if (input.isAllDay) {
            body.start = { date: input.start.toISOString().split("T")[0] };
            body.end = { date: input.end.toISOString().split("T")[0] };
          } else {
            body.start = { dateTime: input.start.toISOString() };
            body.end = { dateTime: input.end.toISOString() };
          }
        }

        if (input.attendees) {
          body.attendees = input.attendees.map((a) => ({
            email: a.email,
            displayName: a.name,
            optional: a.optional,
          }));
        }

        const params = new URLSearchParams();
        if (input.sendUpdates) {
          params.set("sendUpdates", "all");
        }

        const event = await googleCalendarRequest<Record<string, unknown>>(
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}?${params}`,
          account.accessToken,
          { method: "PATCH", body: JSON.stringify(body) }
        );

        return convertGoogleEvent(event, calendarId);
      }

      // Outlook
      const body: Record<string, unknown> = {};

      if (input.title) {
        body.subject = input.title;
      }
      if (input.description !== undefined) {
        body.body = { contentType: "text", content: input.description };
      }
      if (input.location !== undefined) {
        body.location = input.location ? { displayName: input.location } : null;
      }
      if (input.visibility) {
        body.sensitivity =
          input.visibility === "private" ? "private" : "normal";
      }

      if (input.start && input.end) {
        body.isAllDay = input.isAllDay;
        body.start = { dateTime: input.start.toISOString(), timeZone: "UTC" };
        body.end = { dateTime: input.end.toISOString(), timeZone: "UTC" };
      }

      if (input.attendees) {
        body.attendees = input.attendees.map((a) => ({
          emailAddress: { address: a.email, name: a.name },
          type: a.optional ? "optional" : "required",
        }));
      }

      const event = await graphCalendarRequest<Record<string, unknown>>(
        `/me/events/${encodeURIComponent(input.eventId)}`,
        account.accessToken,
        { method: "PATCH", body: JSON.stringify(body) }
      );

      return convertOutlookEvent(event, calendarId);
    }),

  /**
   * Delete an event
   */
  deleteEvent: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        calendarId: z.string(),
        eventId: z.string(),
        sendUpdates: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      if (account.provider === "gmail") {
        const params = input.sendUpdates ? "?sendUpdates=all" : "";
        await googleCalendarRequest(
          `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}${params}`,
          account.accessToken,
          { method: "DELETE" }
        );
      } else {
        await graphCalendarRequest(
          `/me/events/${encodeURIComponent(input.eventId)}`,
          account.accessToken,
          { method: "DELETE" }
        );
      }

      return { success: true };
    }),

  /**
   * Respond to an event invitation
   */
  respondToEvent: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        calendarId: z.string(),
        eventId: z.string(),
        response: z.enum(["accepted", "declined", "tentative"]),
        sendUpdates: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      if (account.provider === "gmail") {
        // For Gmail, we need to get the event first, then patch the attendee status
        const event = await googleCalendarRequest<Record<string, unknown>>(
          `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
          account.accessToken
        );

        const attendees = (event.attendees as Record<string, unknown>[]) || [];
        const updatedAttendees = attendees.map((a) => {
          if (a.self) {
            return { ...a, responseStatus: input.response };
          }
          return a;
        });

        const params = input.sendUpdates ? "?sendUpdates=all" : "";
        await googleCalendarRequest(
          `/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}${params}`,
          account.accessToken,
          {
            method: "PATCH",
            body: JSON.stringify({ attendees: updatedAttendees }),
          }
        );
      } else {
        // Outlook uses specific endpoints for responding
        const responseMap: Record<string, string> = {
          accepted: "accept",
          declined: "decline",
          tentative: "tentativelyAccept",
        };

        await graphCalendarRequest(
          `/me/events/${encodeURIComponent(input.eventId)}/${responseMap[input.response]}`,
          account.accessToken,
          {
            method: "POST",
            body: JSON.stringify({ sendResponse: input.sendUpdates }),
          }
        );
      }

      return { success: true };
    }),

  /**
   * Get free/busy information for calendars
   */
  getFreeBusy: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        emails: z.array(z.string().email()).min(1).max(50),
        timeMin: dateSchema,
        timeMax: dateSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      if (account.provider === "gmail") {
        const body = {
          timeMin: input.timeMin.toISOString(),
          timeMax: input.timeMax.toISOString(),
          items: input.emails.map((email) => ({ id: email })),
        };

        const data = await googleCalendarRequest<{
          calendars: Record<
            string,
            { busy: Array<{ start: string; end: string }> }
          >;
        }>("/freeBusy", account.accessToken, {
          method: "POST",
          body: JSON.stringify(body),
        });

        const result: Record<string, Array<{ start: Date; end: Date }>> = {};
        for (const [email, { busy }] of Object.entries(data.calendars)) {
          result[email] = busy.map((b) => ({
            start: new Date(b.start),
            end: new Date(b.end),
          }));
        }

        return { calendars: result };
      }

      // Outlook - use schedules endpoint
      const body = {
        schedules: input.emails,
        startTime: { dateTime: input.timeMin.toISOString(), timeZone: "UTC" },
        endTime: { dateTime: input.timeMax.toISOString(), timeZone: "UTC" },
        availabilityViewInterval: 30,
      };

      const data = await graphCalendarRequest<{
        value: Array<{
          scheduleId: string;
          scheduleItems: Array<{
            start: { dateTime: string };
            end: { dateTime: string };
          }>;
        }>;
      }>("/me/calendar/getSchedule", account.accessToken, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const result: Record<string, Array<{ start: Date; end: Date }>> = {};
      for (const schedule of data.value) {
        result[schedule.scheduleId] = schedule.scheduleItems.map((item) => ({
          start: new Date(item.start.dateTime),
          end: new Date(item.end.dateTime),
        }));
      }

      return { calendars: result };
    }),

  /**
   * Quick add an event from natural language (Gmail only)
   */
  quickAdd: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        calendarId: z.string().optional(),
        text: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }): Promise<CalendarEvent> => {
      const account = await getAccountWithAccess(
        ctx.session.user.id,
        input.accountId
      );

      if (account.provider !== "gmail") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Quick add is only supported for Google Calendar",
        });
      }

      const calendarId = input.calendarId || "primary";
      const params = new URLSearchParams({
        text: input.text,
      });

      const event = await googleCalendarRequest<Record<string, unknown>>(
        `/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?${params}`,
        account.accessToken,
        { method: "POST" }
      );

      return convertGoogleEvent(event, calendarId);
    }),

  // ===========================================================================
  // UNIFIED INTELLIGENCE OPERATIONS
  // ===========================================================================

  /**
   * List calendar events from the unified conversation table.
   * Returns events with intelligence metadata (summaries, commitments, etc.)
   */
  listUnifiedEvents: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid().optional(),
        timeMin: dateSchema.optional(),
        timeMax: dateSchema.optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        includeRelated: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get user's organizations
      const memberships = await db.query.member.findMany({
        where: eq(member.userId, ctx.session.user.id),
        columns: { organizationId: true },
      });

      const orgIds = memberships.map((m) => m.organizationId);
      if (orgIds.length === 0) {
        return { items: [], total: 0 };
      }

      // Build conditions
      const conditions = [
        inArray(sourceAccount.organizationId, orgIds),
        eq(sourceAccount.type, "calendar"),
      ];

      if (input.accountId) {
        // Find the corresponding source account
        const account = await db.query.sourceAccount.findFirst({
          where: eq(sourceAccount.id, input.accountId),
          columns: { externalId: true, organizationId: true },
        });

        if (account) {
          const calSource = await db.query.sourceAccount.findFirst({
            where: and(
              eq(sourceAccount.organizationId, account.organizationId),
              eq(sourceAccount.type, "calendar"),
              eq(sourceAccount.externalId, account.externalId)
            ),
            columns: { id: true },
          });

          if (calSource) {
            conditions.push(eq(conversation.sourceAccountId, calSource.id));
          }
        }
      }

      // Get calendar conversations
      const events = await db
        .select({
          id: conversation.id,
          externalId: conversation.externalId,
          title: conversation.title,
          snippet: conversation.snippet,
          briefSummary: conversation.briefSummary,
          urgencyScore: conversation.urgencyScore,
          importanceScore: conversation.importanceScore,
          priorityTier: conversation.priorityTier,
          commitmentCount: conversation.commitmentCount,
          hasOpenLoops: conversation.hasOpenLoops,
          openLoopCount: conversation.openLoopCount,
          isRead: conversation.isRead,
          isStarred: conversation.isStarred,
          lastMessageAt: conversation.lastMessageAt,
          firstMessageAt: conversation.firstMessageAt,
          metadata: conversation.metadata,
          createdAt: conversation.createdAt,
          sourceAccountId: conversation.sourceAccountId,
        })
        .from(conversation)
        .innerJoin(
          sourceAccount,
          eq(conversation.sourceAccountId, sourceAccount.id)
        )
        .where(and(...conditions))
        .orderBy(desc(conversation.lastMessageAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(conversation)
        .innerJoin(
          sourceAccount,
          eq(conversation.sourceAccountId, sourceAccount.id)
        )
        .where(and(...conditions));

      const total = countResult[0]?.count ?? 0;

      // Optionally include related threads
      const relatedMap: Map<
        string,
        Array<{ id: string; title: string | null; type: string }>
      > = new Map();

      if (input.includeRelated && events.length > 0) {
        const eventIds = events.map((e) => e.id);

        const relations = await db
          .select({
            conversationId: relatedConversation.conversationId,
            relatedId: relatedConversation.relatedConversationId,
            relationType: relatedConversation.relationType,
            confidence: relatedConversation.confidence,
          })
          .from(relatedConversation)
          .where(
            and(
              inArray(relatedConversation.conversationId, eventIds),
              eq(relatedConversation.isDismissed, false)
            )
          );

        // Get the related conversation titles
        const relatedIds = [...new Set(relations.map((r) => r.relatedId))];
        if (relatedIds.length > 0) {
          const relatedConvos = await db
            .select({
              id: conversation.id,
              title: conversation.title,
              conversationType: conversation.conversationType,
            })
            .from(conversation)
            .where(inArray(conversation.id, relatedIds));

          const convoMap = new Map(relatedConvos.map((c) => [c.id, c]));

          for (const rel of relations) {
            const related = convoMap.get(rel.relatedId);
            if (related) {
              const existing = relatedMap.get(rel.conversationId) ?? [];
              existing.push({
                id: related.id,
                title: related.title,
                type: related.conversationType ?? "unknown",
              });
              relatedMap.set(rel.conversationId, existing);
            }
          }
        }
      }

      return {
        items: events.map((event) => ({
          ...event,
          relatedThreads: relatedMap.get(event.id) ?? [],
        })),
        total,
      };
    }),

  /**
   * Get related email threads for a calendar event.
   */
  getRelatedThreads: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify access to the conversation
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, input.conversationId),
        columns: { id: true, sourceAccountId: true },
      });

      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Calendar event not found",
        });
      }

      // Get source account to verify organization access
      const source = await db.query.sourceAccount.findFirst({
        where: eq(sourceAccount.id, conv.sourceAccountId),
        columns: { organizationId: true },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source account not found",
        });
      }

      await verifyOrgMembership(ctx.session.user.id, source.organizationId);

      // Get related conversations
      const relations = await db
        .select({
          id: relatedConversation.id,
          relatedId: relatedConversation.relatedConversationId,
          relationType: relatedConversation.relationType,
          confidence: relatedConversation.confidence,
          matchReason: relatedConversation.matchReason,
          isDismissed: relatedConversation.isDismissed,
        })
        .from(relatedConversation)
        .where(eq(relatedConversation.conversationId, input.conversationId));

      // Get full conversation data for each related conversation
      const relatedIds = relations.map((r) => r.relatedId);
      if (relatedIds.length === 0) {
        return { relatedThreads: [] };
      }

      const relatedConvos = await db
        .select({
          id: conversation.id,
          externalId: conversation.externalId,
          title: conversation.title,
          snippet: conversation.snippet,
          briefSummary: conversation.briefSummary,
          participantIds: conversation.participantIds,
          lastMessageAt: conversation.lastMessageAt,
          conversationType: conversation.conversationType,
          urgencyScore: conversation.urgencyScore,
          hasOpenLoops: conversation.hasOpenLoops,
        })
        .from(conversation)
        .where(inArray(conversation.id, relatedIds));

      const convoMap = new Map(relatedConvos.map((c) => [c.id, c]));

      return {
        relatedThreads: relations
          .filter((r) => !r.isDismissed)
          .map((r) => ({
            relationId: r.id,
            confidence: r.confidence,
            matchReason: r.matchReason,
            relationType: r.relationType,
            ...convoMap.get(r.relatedId),
          }))
          .filter((r) => r.id), // Filter out any missing conversations
      };
    }),

  /**
   * Dismiss a related thread relationship.
   */
  dismissRelatedThread: protectedProcedure
    .input(
      z.object({
        relationId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get the relation to verify access
      const relation = await db.query.relatedConversation.findFirst({
        where: eq(relatedConversation.id, input.relationId),
        columns: { conversationId: true },
      });

      if (!relation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Relationship not found",
        });
      }

      // Verify access through conversation → source → organization
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, relation.conversationId),
        columns: { sourceAccountId: true },
      });

      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      const source = await db.query.sourceAccount.findFirst({
        where: eq(sourceAccount.id, conv.sourceAccountId),
        columns: { organizationId: true },
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source account not found",
        });
      }

      await verifyOrgMembership(ctx.session.user.id, source.organizationId);

      // Mark as dismissed
      await db
        .update(relatedConversation)
        .set({
          isDismissed: true,
          dismissedAt: new Date(),
          dismissedByUserId: ctx.session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(relatedConversation.id, input.relationId));

      return { success: true };
    }),

  /**
   * Get commitments from calendar events.
   */
  getCalendarCommitments: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid().optional(),
        timeMin: dateSchema.optional(),
        timeMax: dateSchema.optional(),
        status: z.enum(["pending", "completed", "cancelled"]).optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get user's organizations
      const memberships = await db.query.member.findMany({
        where: eq(member.userId, ctx.session.user.id),
        columns: { organizationId: true },
      });

      const orgIds = memberships.map((m) => m.organizationId);
      if (orgIds.length === 0) {
        return { items: [] };
      }

      // Build conditions for commitments from calendar
      const conditions = [
        inArray(commitment.organizationId, orgIds),
        sql`${commitment.metadata}->>'source' = 'calendar'`,
      ];

      if (input.timeMin) {
        conditions.push(gte(commitment.dueDate, input.timeMin));
      }

      if (input.timeMax) {
        conditions.push(lte(commitment.dueDate, input.timeMax));
      }

      if (input.status) {
        conditions.push(eq(commitment.status, input.status));
      }

      // Query commitments
      const commitments = await db
        .select({
          id: commitment.id,
          title: commitment.title,
          description: commitment.description,
          dueDate: commitment.dueDate,
          status: commitment.status,
          confidence: commitment.confidence,
          direction: commitment.direction,
          metadata: commitment.metadata,
          sourceConversationId: commitment.sourceConversationId,
          createdAt: commitment.createdAt,
        })
        .from(commitment)
        .where(and(...conditions))
        .orderBy(commitment.dueDate)
        .limit(input.limit);

      return { items: commitments };
    }),

  /**
   * Get sync status for calendar.
   */
  getSyncStatus: protectedProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get email account to find corresponding calendar source
      const account = await db.query.sourceAccount.findFirst({
        where: eq(sourceAccount.id, input.accountId),
        columns: { externalId: true, organizationId: true },
      });

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Email account not found",
        });
      }

      await verifyOrgMembership(ctx.session.user.id, account.organizationId);

      // Find calendar source account
      const calSource = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.organizationId, account.organizationId),
          eq(sourceAccount.type, "calendar"),
          eq(sourceAccount.externalId, account.externalId)
        ),
        columns: {
          id: true,
          status: true,
          lastSyncAt: true,
          lastSyncStatus: true,
          lastSyncError: true,
          backfillProgress: true,
        },
      });

      if (!calSource) {
        return {
          connected: false,
          status: "not_configured" as const,
          lastSyncAt: null,
          error: null,
        };
      }

      return {
        connected: true,
        status: calSource.status,
        lastSyncAt: calSource.lastSyncAt,
        lastSyncError: calSource.lastSyncError,
        backfillProgress: calSource.backfillProgress,
      };
    }),
});
