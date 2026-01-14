import {
  GRAPH_API_BASE,
  refreshOutlookToken as refreshOutlookOAuth,
} from "@memorystack/auth/providers";
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
import {
  CalendarAuthError,
  CalendarNotFoundError,
  CalendarProviderError,
  CalendarQuotaError,
} from "./errors";

// =============================================================================
// MICROSOFT GRAPH CALENDAR API RESPONSE TYPES
// =============================================================================

interface GraphCalendar {
  id: string;
  name: string;
  color?: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  canShare?: boolean;
  canViewPrivateItems?: boolean;
  owner?: {
    name?: string;
    address?: string;
  };
}

interface GraphDateTimeTimeZone {
  dateTime: string;
  timeZone: string;
}

interface GraphEmailAddress {
  address: string;
  name?: string;
}

interface GraphAttendee {
  emailAddress: GraphEmailAddress;
  status?: {
    response?: "none" | "organizer" | "tentativelyAccepted" | "accepted" | "declined" | "notResponded";
    time?: string;
  };
  type?: "required" | "optional" | "resource";
}

interface GraphOnlineMeeting {
  joinUrl?: string;
  conferenceId?: string;
  tollNumber?: string;
  tollFreeNumber?: string;
}

interface GraphPatternedRecurrence {
  pattern?: {
    type?: "daily" | "weekly" | "absoluteMonthly" | "relativeMonthly" | "absoluteYearly" | "relativeYearly";
    interval?: number;
    daysOfWeek?: string[];
    dayOfMonth?: number;
    month?: number;
  };
  range?: {
    type?: "endDate" | "noEnd" | "numbered";
    startDate?: string;
    endDate?: string;
    numberOfOccurrences?: number;
  };
}

interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: {
    contentType?: "text" | "html";
    content?: string;
  };
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
  isAllDay?: boolean;
  location?: {
    displayName?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      countryOrRegion?: string;
      postalCode?: string;
    };
  };
  organizer?: {
    emailAddress?: GraphEmailAddress;
  };
  attendees?: GraphAttendee[];
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  importance?: "low" | "normal" | "high";
  sensitivity?: "normal" | "personal" | "private" | "confidential";
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: "teamsForBusiness" | "skypeForBusiness" | "skypeForConsumer" | "unknown";
  onlineMeeting?: GraphOnlineMeeting;
  recurrence?: GraphPatternedRecurrence;
  seriesMasterId?: string;
  type?: "singleInstance" | "occurrence" | "exception" | "seriesMaster";
  responseStatus?: {
    response?: "none" | "organizer" | "tentativelyAccepted" | "accepted" | "declined" | "notResponded";
    time?: string;
  };
  isCancelled?: boolean;
  reminderMinutesBeforeStart?: number;
  isReminderOn?: boolean;
  webLink?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

interface GraphEventsResponse {
  value?: GraphEvent[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

interface GraphCalendarsResponse {
  value?: GraphCalendar[];
  "@odata.nextLink"?: string;
}

interface GraphScheduleItem {
  status?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  start?: GraphDateTimeTimeZone;
  end?: GraphDateTimeTimeZone;
}

interface GraphScheduleInformation {
  scheduleId?: string;
  scheduleItems?: GraphScheduleItem[];
  error?: {
    message?: string;
  };
}

interface GraphScheduleResponse {
  value?: GraphScheduleInformation[];
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert Graph attendee response status to our format
 */
function convertAttendeeResponse(
  response?: string
): "needsAction" | "accepted" | "declined" | "tentative" {
  switch (response) {
    case "accepted":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    case "organizer":
      return "accepted";
    default:
      return "needsAction";
  }
}

/**
 * Convert Graph recurrence pattern to our RecurrenceRule
 */
function convertRecurrence(recurrence?: GraphPatternedRecurrence): RecurrenceRule | undefined {
  if (!recurrence?.pattern) return undefined;

  const pattern = recurrence.pattern;
  const range = recurrence.range;

  const rule: RecurrenceRule = {
    frequency: "weekly",
    interval: pattern.interval ?? 1,
  };

  // Map pattern type to frequency
  switch (pattern.type) {
    case "daily":
      rule.frequency = "daily";
      break;
    case "weekly":
      rule.frequency = "weekly";
      break;
    case "absoluteMonthly":
    case "relativeMonthly":
      rule.frequency = "monthly";
      break;
    case "absoluteYearly":
    case "relativeYearly":
      rule.frequency = "yearly";
      break;
  }

  // Days of week
  if (pattern.daysOfWeek?.length) {
    rule.byDay = pattern.daysOfWeek.map((day) => {
      const mapping: Record<string, string> = {
        sunday: "SU",
        monday: "MO",
        tuesday: "TU",
        wednesday: "WE",
        thursday: "TH",
        friday: "FR",
        saturday: "SA",
      };
      return mapping[day.toLowerCase()] ?? day.slice(0, 2).toUpperCase();
    });
  }

  // Day of month
  if (pattern.dayOfMonth) {
    rule.byMonthDay = [pattern.dayOfMonth];
  }

  // Month
  if (pattern.month) {
    rule.byMonth = [pattern.month];
  }

  // Range
  if (range?.endDate) {
    rule.until = new Date(range.endDate);
  } else if (range?.numberOfOccurrences) {
    rule.count = range.numberOfOccurrences;
  }

  return rule;
}

/**
 * Build Graph recurrence pattern from our RecurrenceRule
 */
function buildRecurrencePattern(rule: RecurrenceRule): GraphPatternedRecurrence {
  const pattern: GraphPatternedRecurrence = {
    pattern: {
      interval: rule.interval,
    },
    range: {
      type: "noEnd",
      startDate: new Date().toISOString().split("T")[0],
    },
  };

  // Map frequency to pattern type
  switch (rule.frequency) {
    case "daily":
      pattern.pattern!.type = "daily";
      break;
    case "weekly":
      pattern.pattern!.type = "weekly";
      break;
    case "monthly":
      pattern.pattern!.type = "absoluteMonthly";
      break;
    case "yearly":
      pattern.pattern!.type = "absoluteYearly";
      break;
  }

  // Days of week
  if (rule.byDay?.length) {
    pattern.pattern!.daysOfWeek = rule.byDay.map((day) => {
      const mapping: Record<string, string> = {
        SU: "sunday",
        MO: "monday",
        TU: "tuesday",
        WE: "wednesday",
        TH: "thursday",
        FR: "friday",
        SA: "saturday",
      };
      return mapping[day.toUpperCase()] ?? day.toLowerCase();
    });
  }

  // Day of month
  if (rule.byMonthDay?.length) {
    pattern.pattern!.dayOfMonth = rule.byMonthDay[0];
  }

  // Month
  if (rule.byMonth?.length) {
    pattern.pattern!.month = rule.byMonth[0];
  }

  // Range
  if (rule.until) {
    pattern.range = {
      type: "endDate",
      endDate: rule.until.toISOString().split("T")[0],
      startDate: new Date().toISOString().split("T")[0],
    };
  } else if (rule.count) {
    pattern.range = {
      type: "numbered",
      numberOfOccurrences: rule.count,
      startDate: new Date().toISOString().split("T")[0],
    };
  }

  return pattern;
}

/**
 * Parse date/time from Graph format
 */
function parseGraphDateTime(dt?: GraphDateTimeTimeZone): Date {
  if (!dt?.dateTime) return new Date();
  return new Date(dt.dateTime);
}

/**
 * Convert Graph status to our busy slot status
 */
function convertBusyStatus(
  status?: string
): "busy" | "tentative" | "oof" | "workingElsewhere" | "free" {
  switch (status) {
    case "busy":
      return "busy";
    case "tentative":
      return "tentative";
    case "oof":
      return "oof";
    case "workingElsewhere":
      return "workingElsewhere";
    default:
      return "free";
  }
}

// =============================================================================
// OUTLOOK CALENDAR CLIENT
// =============================================================================

export class OutlookCalendarClient implements CalendarClient {
  readonly provider = "outlook" as const;
  private accessToken: string;
  private refreshTokenValue: string;
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
    const fiveMinutes = 5 * 60 * 1000;
    return this.tokenExpiresAt.getTime() - Date.now() < fiveMinutes;
  }

  async refreshToken(): Promise<CalendarTokenInfo> {
    try {
      const result = await refreshOutlookOAuth(this.refreshTokenValue);
      this.accessToken = result.accessToken;
      this.refreshTokenValue = result.refreshToken;
      this.tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
      return this.getTokenInfo();
    } catch (error) {
      throw new CalendarAuthError(
        `Failed to refresh Outlook token: ${error instanceof Error ? error.message : "Unknown error"}`,
        "outlook"
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

    const url = endpoint.startsWith("http")
      ? endpoint
      : `${GRAPH_API_BASE}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.timezone="UTC"',
        ...options.headers,
      },
    });

    // Handle 204 No Content for delete operations
    if (response.status === 204) {
      return {} as T;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: { error?: { message?: string; code?: string } } = {};
      try {
        errorData = JSON.parse(errorBody);
      } catch {
        // Not JSON
      }

      if (response.status === 401) {
        throw new CalendarAuthError(
          errorData.error?.message || "Authentication failed",
          "outlook"
        );
      }

      if (response.status === 429) {
        throw new CalendarQuotaError("outlook");
      }

      if (response.status === 404) {
        throw new CalendarNotFoundError("outlook", "event");
      }

      throw new CalendarProviderError(
        errorData.error?.message || `Calendar API error: ${response.status}`,
        "outlook",
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
    const response = await this.request<GraphCalendarsResponse>("/me/calendars");
    return (response.value ?? []).map((cal) => this.convertCalendar(cal));
  }

  async getCalendar(calendarId: string): Promise<CalendarInfo | null> {
    try {
      const calendar = await this.request<GraphCalendar>(
        `/me/calendars/${encodeURIComponent(calendarId)}`
      );
      return this.convertCalendar(calendar);
    } catch (error) {
      if (error instanceof CalendarNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private convertCalendar(cal: GraphCalendar): CalendarInfo {
    let accessRole: CalendarInfo["accessRole"] = "reader";
    if (cal.canEdit) {
      accessRole = "writer";
    }
    if (cal.owner?.address?.toLowerCase() === this.email.toLowerCase()) {
      accessRole = "owner";
    }

    return {
      id: cal.id,
      name: cal.name,
      primary: cal.isDefaultCalendar ?? false,
      accessRole,
      backgroundColor: cal.hexColor ?? cal.color,
      timeZone: "UTC", // Outlook doesn't return calendar timezone, we request UTC
      provider: "outlook",
    };
  }

  // ---------------------------------------------------------------------------
  // Event Operations
  // ---------------------------------------------------------------------------

  async listEvents(input: ListEventsInput): Promise<ListEventsResponse> {
    const calendarId = input.calendarId ?? "calendar";
    const endpoint =
      calendarId === "calendar"
        ? "/me/calendar/events"
        : `/me/calendars/${encodeURIComponent(calendarId)}/events`;

    const params = new URLSearchParams({
      $top: String(input.maxResults ?? 250),
      $orderby: input.orderBy === "updated" ? "lastModifiedDateTime desc" : "start/dateTime asc",
      $filter: `start/dateTime ge '${input.timeMin.toISOString()}' and end/dateTime le '${input.timeMax.toISOString()}'`,
      $select:
        "id,subject,body,bodyPreview,start,end,isAllDay,location,organizer,attendees,showAs,sensitivity,isOnlineMeeting,onlineMeeting,onlineMeetingProvider,recurrence,seriesMasterId,type,responseStatus,isCancelled,reminderMinutesBeforeStart,isReminderOn,webLink,createdDateTime,lastModifiedDateTime",
    });

    if (input.query) {
      params.set("$search", `"${input.query}"`);
    }

    const response = await this.request<GraphEventsResponse>(
      `${endpoint}?${params.toString()}`
    );

    return {
      items: (response.value ?? []).map((event) =>
        this.convertEvent(event, calendarId)
      ),
      nextPageToken: response["@odata.nextLink"],
      hasMore: !!response["@odata.nextLink"],
      nextSyncToken: response["@odata.deltaLink"],
    };
  }

  async getEvent(
    calendarId: string,
    eventId: string
  ): Promise<CalendarEvent | null> {
    try {
      const endpoint =
        calendarId === "calendar"
          ? `/me/calendar/events/${encodeURIComponent(eventId)}`
          : `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

      const event = await this.request<GraphEvent>(endpoint);
      return this.convertEvent(event, calendarId);
    } catch (error) {
      if (error instanceof CalendarNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const calendarId = input.calendarId ?? "calendar";
    const endpoint =
      calendarId === "calendar"
        ? "/me/calendar/events"
        : `/me/calendars/${encodeURIComponent(calendarId)}/events`;

    const body = this.buildEventBody(input);

    const event = await this.request<GraphEvent>(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return this.convertEvent(event, calendarId);
  }

  async updateEvent(input: UpdateEventInput): Promise<CalendarEvent> {
    const calendarId = input.calendarId ?? "calendar";
    const endpoint =
      calendarId === "calendar"
        ? `/me/calendar/events/${encodeURIComponent(input.eventId)}`
        : `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`;

    const body = this.buildEventBody(input);

    const event = await this.request<GraphEvent>(endpoint, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    return this.convertEvent(event, calendarId);
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    _sendUpdates = true // Outlook sends notifications by default
  ): Promise<void> {
    const endpoint =
      calendarId === "calendar"
        ? `/me/calendar/events/${encodeURIComponent(eventId)}`
        : `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

    await this.request(endpoint, { method: "DELETE" });
  }

  async respondToEvent(
    calendarId: string,
    eventId: string,
    response: "accepted" | "declined" | "tentative",
    sendResponse = true
  ): Promise<void> {
    const endpoint =
      calendarId === "calendar"
        ? `/me/calendar/events/${encodeURIComponent(eventId)}`
        : `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

    // Map response to Graph API action
    const action =
      response === "accepted"
        ? "accept"
        : response === "declined"
          ? "decline"
          : "tentativelyAccept";

    await this.request(`${endpoint}/${action}`, {
      method: "POST",
      body: JSON.stringify({
        sendResponse,
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // Free/Busy Operations
  // ---------------------------------------------------------------------------

  async getFreeBusy(input: FreeBusyInput): Promise<FreeBusyResult> {
    const body = {
      schedules: input.emails,
      startTime: {
        dateTime: input.timeMin.toISOString(),
        timeZone: "UTC",
      },
      endTime: {
        dateTime: input.timeMax.toISOString(),
        timeZone: "UTC",
      },
    };

    const response = await this.request<GraphScheduleResponse>(
      "/me/calendar/getSchedule",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    const calendars = new Map<string, FreeBusySlot[]>();
    const errors = new Map<string, string>();

    for (const schedule of response.value ?? []) {
      const email = schedule.scheduleId ?? "";

      if (schedule.error) {
        errors.set(email, schedule.error.message ?? "Unknown error");
      } else {
        const slots: FreeBusySlot[] = [];
        for (const item of schedule.scheduleItems ?? []) {
          if (item.start && item.end) {
            slots.push({
              start: parseGraphDateTime(item.start),
              end: parseGraphDateTime(item.end),
              status: convertBusyStatus(item.status),
            });
          }
        }
        calendars.set(email, slots);
      }
    }

    return { calendars, errors: errors.size > 0 ? errors : undefined };
  }

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  private convertEvent(event: GraphEvent, calendarId: string): CalendarEvent {
    const isAllDay = event.isAllDay ?? false;

    // Determine self response status
    const selfResponse = event.responseStatus?.response;

    // Determine if user is organizer
    const isOrganizer =
      event.organizer?.emailAddress?.address?.toLowerCase() ===
      this.email.toLowerCase();

    // Determine permissions
    const canEdit = isOrganizer || selfResponse === "organizer";
    const canDelete = isOrganizer;

    // Build conference data for Teams meetings
    let conferenceData: ConferenceData | undefined;
    if (event.isOnlineMeeting && event.onlineMeeting?.joinUrl) {
      const entryPoints: ConferenceEntryPoint[] = [
        {
          entryPointType: "video",
          uri: event.onlineMeeting.joinUrl,
          label: "Join Teams Meeting",
        },
      ];

      if (event.onlineMeeting.tollNumber) {
        entryPoints.push({
          entryPointType: "phone",
          uri: `tel:${event.onlineMeeting.tollNumber}`,
          label: event.onlineMeeting.tollNumber,
        });
      }

      conferenceData = {
        type: "teams",
        conferenceId: event.onlineMeeting.conferenceId,
        entryPoints,
      };
    }

    // Build reminders
    const reminders: EventReminder[] = [];
    if (event.isReminderOn && event.reminderMinutesBeforeStart) {
      reminders.push({
        method: "popup",
        minutes: event.reminderMinutesBeforeStart,
      });
    }

    return {
      id: event.id,
      calendarId,
      title: event.subject ?? "(No title)",
      description: event.body?.content,
      location: event.location?.displayName,
      start: parseGraphDateTime(event.start),
      end: parseGraphDateTime(event.end),
      isAllDay,
      status: event.isCancelled ? "cancelled" : "confirmed",
      visibility:
        event.sensitivity === "private" || event.sensitivity === "confidential"
          ? "private"
          : "default",
      organizer: {
        email: event.organizer?.emailAddress?.address ?? this.email,
        name: event.organizer?.emailAddress?.name,
        responseStatus: "accepted",
        organizer: true,
        self: isOrganizer,
      },
      attendees: (event.attendees ?? []).map((att) => ({
        email: att.emailAddress?.address ?? "",
        name: att.emailAddress?.name,
        responseStatus: convertAttendeeResponse(att.status?.response),
        organizer: false,
        self: att.emailAddress?.address?.toLowerCase() === this.email.toLowerCase(),
        optional: att.type === "optional",
      })),
      recurrence: convertRecurrence(event.recurrence),
      reminders,
      conferenceData,
      htmlLink: event.webLink,
      recurringEventId: event.seriesMasterId,
      canEdit,
      canDelete,
      selfResponseStatus: convertAttendeeResponse(selfResponse),
      created: event.createdDateTime ? new Date(event.createdDateTime) : new Date(),
      updated: event.lastModifiedDateTime
        ? new Date(event.lastModifiedDateTime)
        : new Date(),
      provider: "outlook",
    };
  }

  private buildEventBody(
    input: CreateEventInput | UpdateEventInput
  ): Partial<GraphEvent> {
    const body: Partial<GraphEvent> = {};

    if (input.title !== undefined) {
      body.subject = input.title;
    }

    if (input.description !== undefined) {
      body.body = {
        contentType: "html",
        content: input.description,
      };
    }

    if (input.location !== undefined) {
      body.location = {
        displayName: input.location,
      };
    }

    if (input.start !== undefined && input.end !== undefined) {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      if (input.isAllDay) {
        body.isAllDay = true;
        const startDateStr = input.start.toISOString().split("T")[0] ?? "";
        const endDateStr = input.end.toISOString().split("T")[0] ?? "";
        body.start = {
          dateTime: startDateStr,
          timeZone,
        };
        body.end = {
          dateTime: endDateStr,
          timeZone,
        };
      } else {
        body.start = {
          dateTime: input.start.toISOString(),
          timeZone,
        };
        body.end = {
          dateTime: input.end.toISOString(),
          timeZone,
        };
      }
    }

    if (input.visibility !== undefined) {
      body.sensitivity = input.visibility === "private" ? "private" : "normal";
    }

    if (input.attendees !== undefined) {
      body.attendees = input.attendees.map((a) => ({
        emailAddress: {
          address: a.email,
          name: a.name,
        },
        type: a.optional ? "optional" : "required",
      }));
    }

    if (input.recurrence) {
      body.recurrence = buildRecurrencePattern(input.recurrence);
    }

    if (input.reminders !== undefined && input.reminders.length > 0) {
      // Outlook only supports one reminder
      body.isReminderOn = true;
      body.reminderMinutesBeforeStart = input.reminders[0]?.minutes ?? 15;
    }

    if (input.addConference) {
      body.isOnlineMeeting = true;
      body.onlineMeetingProvider = "teamsForBusiness";
    }

    return body;
  }
}
