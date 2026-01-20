import {
  CALENDAR_API_BASE,
  refreshGmailToken as refreshGmailOAuth,
} from "@memorystack/auth/providers";
import {
  CalendarAuthError,
  CalendarNotFoundError,
  CalendarProviderError,
  CalendarQuotaError,
} from "./errors";
import type {
  CalendarClient,
  CalendarEvent,
  CalendarInfo,
  CalendarTokenInfo,
  ConferenceData,
  ConferenceEntryPoint,
  CreateEventInput,
  EventReminder,
  FreeBusyInput,
  FreeBusyResult,
  FreeBusySlot,
  ListEventsInput,
  ListEventsResponse,
  RecurrenceRule,
  UpdateEventInput,
} from "./types";

// =============================================================================
// GOOGLE CALENDAR API RESPONSE TYPES
// =============================================================================

interface GoogleCalendar {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  backgroundColor?: string;
  foregroundColor?: string;
  timeZone?: string;
  selected?: boolean;
}

interface GoogleEventDateTime {
  date?: string; // For all-day events (YYYY-MM-DD)
  dateTime?: string; // For timed events (ISO 8601)
  timeZone?: string;
}

interface GoogleAttendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "accepted" | "declined" | "tentative";
  organizer?: boolean;
  self?: boolean;
  optional?: boolean;
}

interface GoogleConferenceData {
  conferenceId?: string;
  conferenceSolution?: {
    key?: { type?: string };
    name?: string;
    iconUri?: string;
  };
  entryPoints?: Array<{
    entryPointType?: "video" | "phone" | "more" | "sip";
    uri?: string;
    label?: string;
    pin?: string;
    accessCode?: string;
    meetingCode?: string;
    passcode?: string;
    password?: string;
  }>;
  createRequest?: {
    requestId: string;
    conferenceSolutionKey?: { type: string };
    status?: { statusCode: string };
  };
  notes?: string;
}

interface GoogleReminder {
  method: "email" | "popup";
  minutes: number;
}

interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleEventDateTime;
  visibility?: "default" | "public" | "private" | "confidential";
  organizer?: GoogleAttendee;
  attendees?: GoogleAttendee[];
  conferenceData?: GoogleConferenceData;
  reminders?: {
    useDefault?: boolean;
    overrides?: GoogleReminder[];
  };
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  created?: string;
  updated?: string;
}

interface GoogleEventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendar[];
  nextPageToken?: string;
}

interface GoogleFreeBusyResponse {
  calendars: Record<
    string,
    {
      busy?: Array<{ start: string; end: string }>;
      errors?: Array<{ domain: string; reason: string }>;
    }
  >;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse Google's RRULE string into RecurrenceRule object
 */
function parseRecurrenceRule(
  rruleStrings: string[]
): RecurrenceRule | undefined {
  const rruleLine = rruleStrings.find((r) => r.startsWith("RRULE:"));
  if (!rruleLine) return undefined;

  const rrule = rruleLine.replace("RRULE:", "");
  const parts = rrule.split(";");
  const rule: Partial<RecurrenceRule> = { interval: 1 };

  for (const part of parts) {
    const [key, value] = part.split("=");
    switch (key) {
      case "FREQ":
        rule.frequency = value?.toLowerCase() as RecurrenceRule["frequency"];
        break;
      case "INTERVAL":
        rule.interval = value ? Number.parseInt(value, 10) : 1;
        break;
      case "UNTIL":
        if (value) {
          // Parse YYYYMMDD or YYYYMMDDTHHMMSSZ format
          const year = value.slice(0, 4);
          const month = value.slice(4, 6);
          const day = value.slice(6, 8);
          rule.until = new Date(`${year}-${month}-${day}`);
        }
        break;
      case "COUNT":
        rule.count = value ? Number.parseInt(value, 10) : undefined;
        break;
      case "BYDAY":
        rule.byDay = value?.split(",");
        break;
      case "BYMONTHDAY":
        rule.byMonthDay = value?.split(",").map((d) => Number.parseInt(d, 10));
        break;
      case "BYMONTH":
        rule.byMonth = value?.split(",").map((m) => Number.parseInt(m, 10));
        break;
    }
  }

  return rule.frequency ? (rule as RecurrenceRule) : undefined;
}

/**
 * Build RRULE string from RecurrenceRule object
 */
function buildRecurrenceRule(rule: RecurrenceRule): string {
  const parts: string[] = [`FREQ=${rule.frequency.toUpperCase()}`];

  if (rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }

  if (rule.until) {
    const d = rule.until;
    const until = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    parts.push(`UNTIL=${until}`);
  } else if (rule.count) {
    parts.push(`COUNT=${rule.count}`);
  }

  if (rule.byDay?.length) {
    parts.push(`BYDAY=${rule.byDay.join(",")}`);
  }

  if (rule.byMonthDay?.length) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  }

  if (rule.byMonth?.length) {
    parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  }

  return `RRULE:${parts.join(";")}`;
}

/**
 * Convert Google conference data to our format
 */
function convertConferenceData(
  data?: GoogleConferenceData
): ConferenceData | undefined {
  if (!data?.entryPoints?.length) return undefined;

  let type: ConferenceData["type"] = "other";
  const solutionType = data.conferenceSolution?.key?.type;

  if (solutionType === "hangoutsMeet" || solutionType === "eventHangout") {
    type = "hangoutsMeet";
  } else if (solutionType?.includes("zoom")) {
    type = "zoom";
  }

  const entryPoints: ConferenceEntryPoint[] = [];
  for (const ep of data.entryPoints ?? []) {
    if (ep.uri) {
      entryPoints.push({
        entryPointType: ep.entryPointType ?? "video",
        uri: ep.uri,
        label: ep.label,
        pin: ep.pin,
        accessCode: ep.accessCode,
        meetingCode: ep.meetingCode,
        passcode: ep.passcode,
        password: ep.password,
      });
    }
  }

  return {
    type,
    conferenceId: data.conferenceId,
    entryPoints,
    notes: data.notes,
  };
}

/**
 * Parse date/time from Google event format
 */
function parseEventDateTime(dt?: GoogleEventDateTime): Date {
  if (!dt) return new Date();

  if (dt.dateTime) {
    return new Date(dt.dateTime);
  }

  if (dt.date) {
    // All-day event: date only
    return new Date(dt.date + "T00:00:00");
  }

  return new Date();
}

/**
 * Check if event is all-day
 */
function isAllDayEvent(event: GoogleEvent): boolean {
  return !!(event.start?.date && !event.start.dateTime);
}

// =============================================================================
// GMAIL CALENDAR CLIENT
// =============================================================================

export class GmailCalendarClient implements CalendarClient {
  readonly provider = "gmail" as const;
  private accessToken: string;
  private readonly refreshTokenValue: string;
  private tokenExpiresAt: Date;
  readonly email: string;

  constructor(
    email: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date
  ) {
    this.email = email;
    this.accessToken = accessToken;
    this.refreshTokenValue = refreshToken;
    this.tokenExpiresAt = expiresAt;
  }

  // ---------------------------------------------------------------------------
  // Token Management
  // ---------------------------------------------------------------------------

  needsRefresh(): boolean {
    // Refresh if token expires in less than 5 minutes
    const fiveMinutes = 5 * 60 * 1000;
    return this.tokenExpiresAt.getTime() - Date.now() < fiveMinutes;
  }

  async refreshToken(): Promise<CalendarTokenInfo> {
    try {
      const result = await refreshGmailOAuth(this.refreshTokenValue);
      this.accessToken = result.accessToken;
      this.tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
      return this.getTokenInfo();
    } catch (error) {
      throw new CalendarAuthError(
        `Failed to refresh Gmail token: ${error instanceof Error ? error.message : "Unknown error"}`,
        "gmail"
      );
    }
  }

  getTokenInfo(): CalendarTokenInfo {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshTokenValue,
      expiresAt: this.tokenExpiresAt,
    };
  }

  // ---------------------------------------------------------------------------
  // API Helpers
  // ---------------------------------------------------------------------------

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (this.needsRefresh()) {
      await this.refreshToken();
    }

    const url = `${CALENDAR_API_BASE}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    // Handle 204 No Content for delete operations
    if (response.status === 204) {
      return {} as T;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: { error?: { message?: string; code?: number } } = {};
      try {
        errorData = JSON.parse(errorBody);
      } catch {
        // Not JSON
      }

      if (response.status === 401) {
        throw new CalendarAuthError(
          errorData.error?.message || "Authentication failed",
          "gmail"
        );
      }

      if (response.status === 429) {
        throw new CalendarQuotaError("gmail");
      }

      if (response.status === 404) {
        throw new CalendarNotFoundError("gmail", "event");
      }

      throw new CalendarProviderError(
        errorData.error?.message || `Calendar API error: ${response.status}`,
        "gmail",
        response.status,
        errorData
      );
    }

    return (await response.json()) as T;
  }

  // ---------------------------------------------------------------------------
  // Calendar Operations
  // ---------------------------------------------------------------------------

  async listCalendars(): Promise<CalendarInfo[]> {
    const response = await this.request<GoogleCalendarListResponse>(
      "/users/me/calendarList"
    );

    return (response.items ?? []).map((cal) => this.convertCalendar(cal));
  }

  async getCalendar(calendarId: string): Promise<CalendarInfo | null> {
    try {
      const calendar = await this.request<GoogleCalendar>(
        `/users/me/calendarList/${encodeURIComponent(calendarId)}`
      );
      return this.convertCalendar(calendar);
    } catch (error) {
      if (error instanceof CalendarNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private convertCalendar(cal: GoogleCalendar): CalendarInfo {
    return {
      id: cal.id,
      name: cal.summary,
      description: cal.description,
      primary: cal.primary ?? false,
      accessRole: cal.accessRole,
      backgroundColor: cal.backgroundColor,
      foregroundColor: cal.foregroundColor,
      timeZone: cal.timeZone ?? "UTC",
      selected: cal.selected,
      provider: "gmail",
    };
  }

  // ---------------------------------------------------------------------------
  // Event Operations
  // ---------------------------------------------------------------------------

  async listEvents(input: ListEventsInput): Promise<ListEventsResponse> {
    const calendarId = input.calendarId ?? "primary";
    const params = new URLSearchParams({
      timeMin: input.timeMin.toISOString(),
      timeMax: input.timeMax.toISOString(),
      maxResults: String(input.maxResults ?? 250),
      singleEvents: String(input.singleEvents ?? true),
      orderBy: input.orderBy ?? "startTime",
    });

    if (input.query) {
      params.set("q", input.query);
    }

    if (input.showDeleted) {
      params.set("showDeleted", "true");
    }

    const response = await this.request<GoogleEventsListResponse>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
    );

    return {
      items: (response.items ?? []).map((event) =>
        this.convertEvent(event, calendarId)
      ),
      nextPageToken: response.nextPageToken,
      hasMore: !!response.nextPageToken,
      nextSyncToken: response.nextSyncToken,
    };
  }

  async getEvent(
    calendarId: string,
    eventId: string
  ): Promise<CalendarEvent | null> {
    try {
      const event = await this.request<GoogleEvent>(
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      );
      return this.convertEvent(event, calendarId);
    } catch (error) {
      if (error instanceof CalendarNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const calendarId = input.calendarId ?? "primary";
    const body = this.buildEventBody(input);

    // Add conference data request if needed
    let queryParams = "";
    if (input.addConference) {
      body.conferenceData = {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
      queryParams = "?conferenceDataVersion=1";
    }

    // Add sendUpdates parameter
    if (input.sendUpdates !== false && input.attendees?.length) {
      queryParams += queryParams ? "&" : "?";
      queryParams += "sendUpdates=all";
    }

    const event = await this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events${queryParams}`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    return this.convertEvent(event, calendarId);
  }

  async updateEvent(input: UpdateEventInput): Promise<CalendarEvent> {
    const calendarId = input.calendarId ?? "primary";
    const body = this.buildEventBody(input);

    const params = new URLSearchParams();
    if (input.sendUpdates !== false) {
      params.set("sendUpdates", "all");
    }

    const queryString = params.toString() ? `?${params.toString()}` : "";

    const event = await this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}${queryString}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      }
    );

    return this.convertEvent(event, calendarId);
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    sendUpdates = true
  ): Promise<void> {
    const params = sendUpdates ? "?sendUpdates=all" : "";
    await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${params}`,
      {
        method: "DELETE",
      }
    );
  }

  async respondToEvent(
    calendarId: string,
    eventId: string,
    response: "accepted" | "declined" | "tentative",
    sendUpdates = true
  ): Promise<void> {
    // First, get the current event
    const event = await this.getEvent(calendarId, eventId);
    if (!event) {
      throw new CalendarNotFoundError("gmail", "event", eventId);
    }

    // Find self in attendees and update response
    const attendees =
      event.attendees.map((att) => {
        if (att.self) {
          return { ...att, responseStatus: response };
        }
        return att;
      }) ?? [];

    // Update event with new attendee response
    const params = sendUpdates ? "?sendUpdates=all" : "";
    await this.request(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${params}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          attendees: attendees.map((a) => ({
            email: a.email,
            displayName: a.name,
            responseStatus: a.responseStatus,
            optional: a.optional,
          })),
        }),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Free/Busy Operations
  // ---------------------------------------------------------------------------

  async getFreeBusy(input: FreeBusyInput): Promise<FreeBusyResult> {
    const body = {
      timeMin: input.timeMin.toISOString(),
      timeMax: input.timeMax.toISOString(),
      items: input.emails.map((email) => ({ id: email })),
    };

    const response = await this.request<GoogleFreeBusyResponse>("/freeBusy", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const calendars = new Map<string, FreeBusySlot[]>();
    const errors = new Map<string, string>();

    for (const [email, data] of Object.entries(response.calendars)) {
      if (data.errors?.length) {
        errors.set(email, data.errors.map((e) => e.reason).join(", "));
      } else {
        calendars.set(
          email,
          (data.busy ?? []).map((slot) => ({
            start: new Date(slot.start),
            end: new Date(slot.end),
            status: "busy" as const,
          }))
        );
      }
    }

    return { calendars, errors: errors.size > 0 ? errors : undefined };
  }

  // ---------------------------------------------------------------------------
  // Quick Actions
  // ---------------------------------------------------------------------------

  async quickAdd(calendarId: string, text: string): Promise<CalendarEvent> {
    const event = await this.request<GoogleEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?text=${encodeURIComponent(text)}`,
      { method: "POST" }
    );

    return this.convertEvent(event, calendarId);
  }

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  private convertEvent(event: GoogleEvent, calendarId: string): CalendarEvent {
    const isAllDay = isAllDayEvent(event);

    // Find self in attendees
    const selfAttendee = event.attendees?.find((a) => a.self);

    // Determine if user can edit/delete
    const isOrganizer = event.organizer?.self ?? false;
    const guestsCanModify = event.guestsCanModify ?? false;
    const canEdit = isOrganizer || guestsCanModify;
    const canDelete = isOrganizer;

    // Convert reminders
    const reminders: EventReminder[] = [];
    if (event.reminders?.overrides) {
      for (const reminder of event.reminders.overrides) {
        reminders.push({
          method: reminder.method,
          minutes: reminder.minutes,
        });
      }
    }

    return {
      id: event.id,
      calendarId,
      title: event.summary ?? "(No title)",
      description: event.description,
      location: event.location,
      start: parseEventDateTime(event.start),
      end: parseEventDateTime(event.end),
      isAllDay,
      status: event.status ?? "confirmed",
      visibility: event.visibility ?? "default",
      organizer: event.organizer
        ? {
            email: event.organizer.email ?? "",
            name: event.organizer.displayName,
            responseStatus: event.organizer.responseStatus ?? "needsAction",
            organizer: true,
            self: event.organizer.self,
          }
        : {
            email: this.email,
            responseStatus: "accepted",
            organizer: true,
            self: true,
          },
      attendees: (event.attendees ?? []).map((a) => ({
        email: a.email ?? "",
        name: a.displayName,
        responseStatus: a.responseStatus ?? "needsAction",
        organizer: a.organizer,
        self: a.self,
        optional: a.optional,
      })),
      recurrence: event.recurrence
        ? parseRecurrenceRule(event.recurrence)
        : undefined,
      reminders,
      conferenceData: convertConferenceData(event.conferenceData),
      htmlLink: event.htmlLink,
      recurringEventId: event.recurringEventId,
      originalStartTime: event.originalStartTime
        ? parseEventDateTime(event.originalStartTime)
        : undefined,
      canEdit,
      canDelete,
      selfResponseStatus: selfAttendee?.responseStatus,
      created: event.created ? new Date(event.created) : new Date(),
      updated: event.updated ? new Date(event.updated) : new Date(),
      provider: "gmail",
    };
  }

  private buildEventBody(
    input: CreateEventInput | UpdateEventInput
  ): Partial<GoogleEvent> {
    const body: Partial<GoogleEvent> = {};

    if (input.title !== undefined) {
      body.summary = input.title;
    }

    if (input.description !== undefined) {
      body.description = input.description;
    }

    if (input.location !== undefined) {
      body.location = input.location;
    }

    if (input.start !== undefined && input.end !== undefined) {
      if (input.isAllDay) {
        // All-day events use date only
        body.start = {
          date: input.start.toISOString().split("T")[0],
        };
        body.end = {
          date: input.end.toISOString().split("T")[0],
        };
      } else {
        body.start = {
          dateTime: input.start.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        body.end = {
          dateTime: input.end.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      }
    }

    if (input.visibility !== undefined) {
      body.visibility = input.visibility;
    }

    if (input.attendees !== undefined) {
      body.attendees = input.attendees.map((a) => ({
        email: a.email,
        displayName: a.name,
        optional: a.optional,
      }));
    }

    if (input.recurrence) {
      body.recurrence = [buildRecurrenceRule(input.recurrence)];
    }

    if (input.reminders !== undefined) {
      body.reminders = {
        useDefault: false,
        overrides: input.reminders.map((r) => ({
          method: r.method,
          minutes: r.minutes,
        })),
      };
    }

    if (input.guestsCanModify !== undefined) {
      body.guestsCanModify = input.guestsCanModify;
    }

    if (input.guestsCanInviteOthers !== undefined) {
      body.guestsCanInviteOthers = input.guestsCanInviteOthers;
    }

    if (input.guestsCanSeeOtherGuests !== undefined) {
      body.guestsCanSeeOtherGuests = input.guestsCanSeeOtherGuests;
    }

    return body;
  }
}
