// =============================================================================
// CALENDAR COMPONENT TYPES
// =============================================================================

export type ViewType = "month" | "week" | "day" | "agenda";

export interface CalendarEvent {
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
  organizer: CalendarAttendee;
  attendees: CalendarAttendee[];
  conferenceData?: ConferenceData;
  htmlLink?: string;
  created: Date;
  updated: Date;
  // Calendar colors
  colorId?: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface CalendarAttendee {
  email: string;
  name?: string;
  responseStatus: "needsAction" | "accepted" | "declined" | "tentative";
  organizer?: boolean;
  self?: boolean;
}

export interface ConferenceData {
  type: "hangoutsMeet" | "teams" | "zoom" | "other";
  entryPoints: ConferenceEntryPoint[];
}

export interface ConferenceEntryPoint {
  type: string;
  uri: string;
  label?: string;
}

export interface CalendarInfo {
  id: string;
  name: string;
  description?: string;
  primary: boolean;
  accessRole: "owner" | "writer" | "reader";
  backgroundColor?: string;
  timeZone: string;
}

export interface CalendarViewProps {
  accountId: string;
  className?: string;
}

export interface EventClickHandler {
  (event: CalendarEvent): void;
}

export interface TimeSlotClickHandler {
  (date: Date, hour?: number): void;
}

// Event form data for creating/editing
export interface EventFormData {
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  attendees: { email: string; name?: string }[];
  addConference: boolean;
  visibility: "default" | "public" | "private";
}
