// =============================================================================
// CALENDAR CLIENT ABSTRACTION - TYPE DEFINITIONS
// =============================================================================

/**
 * Supported calendar providers
 */
export type CalendarProvider = "gmail" | "outlook";

// =============================================================================
// CORE TYPES
// =============================================================================

/**
 * Event attendee with response status
 */
export interface CalendarAttendee {
  /** Email address */
  email: string;
  /** Display name */
  name?: string;
  /** Response status */
  responseStatus: "needsAction" | "accepted" | "declined" | "tentative";
  /** Whether this is the organizer */
  organizer?: boolean;
  /** Whether this is the authenticated user */
  self?: boolean;
  /** Whether the attendee is optional */
  optional?: boolean;
}

/**
 * Recurrence rule following RFC 5545 (simplified)
 */
export interface RecurrenceRule {
  /** Frequency of recurrence */
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  /** Interval between occurrences (default: 1) */
  interval: number;
  /** End date of recurrence */
  until?: Date;
  /** Number of occurrences */
  count?: number;
  /** Days of the week (e.g., ["MO", "WE", "FR"]) */
  byDay?: string[];
  /** Days of the month (e.g., [1, 15]) */
  byMonthDay?: number[];
  /** Months of the year (1-12) */
  byMonth?: number[];
}

/**
 * Video conference data (Google Meet, Teams, Zoom)
 */
export interface ConferenceData {
  /** Conference provider type */
  type: "hangoutsMeet" | "teams" | "zoom" | "other";
  /** Conference ID */
  conferenceId?: string;
  /** Entry points (URLs, phone numbers) */
  entryPoints: ConferenceEntryPoint[];
  /** Additional notes */
  notes?: string;
}

/**
 * Conference entry point (e.g., video URL, phone number)
 */
export interface ConferenceEntryPoint {
  /** Entry point type */
  entryPointType: "video" | "phone" | "more" | "sip";
  /** URI for joining */
  uri: string;
  /** Display label */
  label?: string;
  /** PIN for phone entry */
  pin?: string;
  /** Access code */
  accessCode?: string;
  /** Meeting code */
  meetingCode?: string;
  /** Passcode */
  passcode?: string;
  /** Password */
  password?: string;
}

/**
 * Event reminder
 */
export interface EventReminder {
  /** Reminder method */
  method: "email" | "popup";
  /** Minutes before event */
  minutes: number;
}

/**
 * Calendar event representation
 */
export interface CalendarEvent {
  /** Provider-specific event ID */
  id: string;
  /** Calendar ID this event belongs to */
  calendarId: string;
  /** Event title/summary */
  title: string;
  /** Event description (may contain HTML) */
  description?: string;
  /** Event location (physical address or room) */
  location?: string;
  /** Start time */
  start: Date;
  /** End time */
  end: Date;
  /** Whether this is an all-day event */
  isAllDay: boolean;
  /** Event status */
  status: "confirmed" | "tentative" | "cancelled";
  /** Event visibility */
  visibility: "default" | "public" | "private" | "confidential";
  /** Event organizer */
  organizer: CalendarAttendee;
  /** Event attendees */
  attendees: CalendarAttendee[];
  /** Recurrence rule (for recurring events) */
  recurrence?: RecurrenceRule;
  /** Event reminders */
  reminders: EventReminder[];
  /** Video conference data */
  conferenceData?: ConferenceData;
  /** URL to view event in provider's UI */
  htmlLink?: string;
  /** Recurring event ID (if this is an instance) */
  recurringEventId?: string;
  /** Original start time (for moved recurring instances) */
  originalStartTime?: Date;
  /** Whether the user can edit this event */
  canEdit: boolean;
  /** Whether the user can delete this event */
  canDelete: boolean;
  /** Current user's response status */
  selfResponseStatus?: "needsAction" | "accepted" | "declined" | "tentative";
  /** When the event was created */
  created: Date;
  /** When the event was last updated */
  updated: Date;
  /** Provider (gmail or outlook) */
  provider: CalendarProvider;
}

/**
 * Calendar info
 */
export interface CalendarInfo {
  /** Provider-specific calendar ID */
  id: string;
  /** Calendar name */
  name: string;
  /** Calendar description */
  description?: string;
  /** Whether this is the primary calendar */
  primary: boolean;
  /** User's access level */
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  /** Calendar background color (hex) */
  backgroundColor?: string;
  /** Calendar foreground color (hex) */
  foregroundColor?: string;
  /** Calendar timezone (IANA format) */
  timeZone: string;
  /** Whether the calendar is selected/visible */
  selected?: boolean;
  /** Provider (gmail or outlook) */
  provider: CalendarProvider;
}

/**
 * Free/busy time slot
 */
export interface FreeBusySlot {
  /** Start of busy period */
  start: Date;
  /** End of busy period */
  end: Date;
  /** Optional status (busy, tentative, oof) */
  status?: "busy" | "tentative" | "oof" | "workingElsewhere" | "free";
}

// =============================================================================
// INPUT TYPES
// =============================================================================

/**
 * Input for creating a calendar event
 */
export interface CreateEventInput {
  /** Calendar ID (defaults to primary) */
  calendarId?: string;
  /** Event title (required) */
  title: string;
  /** Event description */
  description?: string;
  /** Event location */
  location?: string;
  /** Start time (required) */
  start: Date;
  /** End time (required) */
  end: Date;
  /** Whether this is an all-day event */
  isAllDay?: boolean;
  /** Event attendees */
  attendees?: Array<{ email: string; name?: string; optional?: boolean }>;
  /** Recurrence rule */
  recurrence?: RecurrenceRule;
  /** Event reminders */
  reminders?: EventReminder[];
  /** Add video conference (Google Meet / Teams) */
  addConference?: boolean;
  /** Event visibility */
  visibility?: "default" | "public" | "private";
  /** Send update notifications to attendees */
  sendUpdates?: boolean;
  /** Guest permissions - can guests modify the event */
  guestsCanModify?: boolean;
  /** Guest permissions - can guests invite others */
  guestsCanInviteOthers?: boolean;
  /** Guest permissions - can guests see other guests */
  guestsCanSeeOtherGuests?: boolean;
}

/**
 * Input for updating a calendar event
 */
export interface UpdateEventInput extends Partial<CreateEventInput> {
  /** Event ID (required) */
  eventId: string;
  /** Calendar ID */
  calendarId?: string;
  /** Send update notifications */
  sendUpdates?: boolean;
}

/**
 * Input for listing calendar events
 */
export interface ListEventsInput {
  /** Calendar ID (defaults to primary) */
  calendarId?: string;
  /** Start of time range (required) */
  timeMin: Date;
  /** End of time range (required) */
  timeMax: Date;
  /** Maximum number of events to return */
  maxResults?: number;
  /** Expand recurring events into instances */
  singleEvents?: boolean;
  /** Order by start time or updated time */
  orderBy?: "startTime" | "updated";
  /** Filter by query string */
  query?: string;
  /** Show deleted events */
  showDeleted?: boolean;
}

/**
 * Input for free/busy query
 */
export interface FreeBusyInput {
  /** Calendars or email addresses to check */
  emails: string[];
  /** Start of time range */
  timeMin: Date;
  /** End of time range */
  timeMax: Date;
}

/**
 * Result for free/busy query
 */
export interface FreeBusyResult {
  /** Busy slots by email address */
  calendars: Map<string, FreeBusySlot[]>;
  /** Errors for specific calendars */
  errors?: Map<string, string>;
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/**
 * Paginated list response for events
 */
export interface ListEventsResponse {
  /** Events in the result */
  items: CalendarEvent[];
  /** Next page token */
  nextPageToken?: string;
  /** Whether there are more results */
  hasMore: boolean;
  /** Sync token for incremental sync */
  nextSyncToken?: string;
}

/**
 * Token info for refresh checking
 */
export interface CalendarTokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// =============================================================================
// CALENDAR CLIENT INTERFACE
// =============================================================================

/**
 * Unified calendar client interface for provider-agnostic operations.
 * Implementations must handle provider-specific API calls and normalize
 * responses to these standard types.
 */
export interface CalendarClient {
  /** The calendar provider type */
  readonly provider: CalendarProvider;

  /** The email address of the connected account */
  readonly email: string;

  // ---------------------------------------------------------------------------
  // Token Management
  // ---------------------------------------------------------------------------

  /**
   * Check if the access token needs to be refreshed.
   * @returns True if token is expired or will expire within 5 minutes
   */
  needsRefresh(): boolean;

  /**
   * Refresh the access token using the refresh token.
   * Updates internal token state.
   * @returns Updated token info
   * @throws CalendarAuthError if refresh fails
   */
  refreshToken(): Promise<CalendarTokenInfo>;

  /**
   * Get current token info
   */
  getTokenInfo(): CalendarTokenInfo;

  // ---------------------------------------------------------------------------
  // Calendar Operations
  // ---------------------------------------------------------------------------

  /**
   * List available calendars
   * @returns Array of calendar info objects
   */
  listCalendars(): Promise<CalendarInfo[]>;

  /**
   * Get a specific calendar by ID
   * @param calendarId - Provider-specific calendar ID
   * @returns Calendar info, or null if not found
   */
  getCalendar(calendarId: string): Promise<CalendarInfo | null>;

  // ---------------------------------------------------------------------------
  // Event Operations
  // ---------------------------------------------------------------------------

  /**
   * List events in a date range
   * @param input - List events input with time range and options
   * @returns Paginated list of events
   */
  listEvents(input: ListEventsInput): Promise<ListEventsResponse>;

  /**
   * Get a single event by ID
   * @param calendarId - Calendar ID
   * @param eventId - Provider-specific event ID
   * @returns Event data, or null if not found
   */
  getEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null>;

  /**
   * Create a new event
   * @param input - Create event input
   * @returns Created event
   */
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;

  /**
   * Update an existing event
   * @param input - Update event input
   * @returns Updated event
   */
  updateEvent(input: UpdateEventInput): Promise<CalendarEvent>;

  /**
   * Delete an event
   * @param calendarId - Calendar ID
   * @param eventId - Event ID
   * @param sendUpdates - Whether to notify attendees
   */
  deleteEvent(
    calendarId: string,
    eventId: string,
    sendUpdates?: boolean
  ): Promise<void>;

  /**
   * Respond to an event invitation
   * @param calendarId - Calendar ID
   * @param eventId - Event ID
   * @param response - Response status
   * @param sendUpdates - Whether to notify organizer
   */
  respondToEvent(
    calendarId: string,
    eventId: string,
    response: "accepted" | "declined" | "tentative",
    sendUpdates?: boolean
  ): Promise<void>;

  // ---------------------------------------------------------------------------
  // Free/Busy Operations
  // ---------------------------------------------------------------------------

  /**
   * Get free/busy information for calendars
   * @param input - Free/busy query input
   * @returns Free/busy result with busy slots by calendar
   */
  getFreeBusy(input: FreeBusyInput): Promise<FreeBusyResult>;

  // ---------------------------------------------------------------------------
  // Quick Actions
  // ---------------------------------------------------------------------------

  /**
   * Quick add an event from natural language
   * Only supported by Google Calendar
   * @param calendarId - Calendar ID
   * @param text - Natural language event text (e.g., "Meeting with Bob tomorrow at 3pm")
   * @returns Created event
   */
  quickAdd?(calendarId: string, text: string): Promise<CalendarEvent>;
}
