"""
Calendar Parser

Extracts structured metadata from calendar events including:
- Event details (title, description, location)
- Attendees and their status
- Date/time and recurrence
- Meeting links (Zoom, Meet, Teams)
- Agenda items
"""

import re
from datetime import datetime, timedelta
from typing import Literal

from pydantic import Field

from .base import SourceParser, ParsedContent


class CalendarAttendee(ParsedContent):
    """An attendee on a calendar event."""

    email: str
    name: str | None = None
    status: Literal["accepted", "declined", "tentative", "pending", "unknown"] = "unknown"
    is_organizer: bool = False
    is_optional: bool = False


class ParsedCalendarEvent(ParsedContent):
    """Structured calendar event data."""

    source_type: str = "calendar"

    # Event basics
    title: str = ""
    description: str | None = None
    location: str | None = None

    # Organizer
    organizer_email: str | None = None
    organizer_name: str | None = None

    # Attendees
    attendees: list[dict] = Field(default_factory=list)
    attendee_count: int = 0
    accepted_count: int = 0
    declined_count: int = 0
    pending_count: int = 0

    # Time
    start_time: datetime | None = None
    end_time: datetime | None = None
    duration_minutes: int | None = None
    is_all_day: bool = False
    timezone: str | None = None

    # Recurrence
    is_recurring: bool = False
    recurrence_rule: str | None = None
    recurrence_pattern: str | None = None  # "daily", "weekly", etc.

    # Meeting links
    has_video_call: bool = False
    video_call_type: Literal["zoom", "meet", "teams", "webex", "other", None] = None
    video_call_link: str | None = None

    # Status
    event_status: Literal["confirmed", "tentative", "cancelled", "unknown"] = "unknown"

    # Agenda and extracted items
    has_agenda: bool = False
    agenda_items: list[str] = Field(default_factory=list)

    # Notes/actions from description
    action_items: list[str] = Field(default_factory=list)


class CalendarParser(SourceParser[ParsedCalendarEvent]):
    """
    Parser for calendar event content.

    Handles various calendar formats and extracts structured metadata.
    """

    @property
    def source_type(self) -> str:
        return "calendar"

    def parse(self, raw_content: str) -> ParsedCalendarEvent:
        """Parse raw calendar event content."""
        # Extract basic info
        title = self._extract_title(raw_content)
        description = self._extract_description(raw_content)
        location = self._extract_location(raw_content)

        # Extract organizer
        organizer_email, organizer_name = self._extract_organizer(raw_content)

        # Extract attendees
        attendees = self._extract_attendees(raw_content)
        accepted = sum(1 for a in attendees if a.get("status") == "accepted")
        declined = sum(1 for a in attendees if a.get("status") == "declined")
        pending = sum(1 for a in attendees if a.get("status") in ("pending", "unknown"))

        # Extract time
        start_time, end_time, is_all_day = self._extract_times(raw_content)
        duration = None
        if start_time and end_time:
            duration = int((end_time - start_time).total_seconds() / 60)

        # Extract recurrence
        is_recurring, recurrence_rule, recurrence_pattern = self._extract_recurrence(raw_content)

        # Extract video call
        has_video, video_type, video_link = self._extract_video_call(raw_content)

        # Extract agenda
        has_agenda, agenda_items = self._extract_agenda(raw_content)

        # Extract action items
        action_items = self._extract_action_items(raw_content)

        # Collect participants
        all_participants = [organizer_name] if organizer_name else []
        all_participants.extend([a.get("name", "") for a in attendees if a.get("name")])

        all_emails = [organizer_email] if organizer_email else []
        all_emails.extend([a.get("email", "") for a in attendees if a.get("email")])

        return ParsedCalendarEvent(
            raw_content=raw_content,
            source_type="calendar",
            title=title,
            description=description,
            location=location,
            organizer_email=organizer_email,
            organizer_name=organizer_name,
            attendees=attendees,
            attendee_count=len(attendees),
            accepted_count=accepted,
            declined_count=declined,
            pending_count=pending,
            start_time=start_time,
            end_time=end_time,
            duration_minutes=duration,
            is_all_day=is_all_day,
            sent_at=start_time,  # Use start time as sent_at
            is_recurring=is_recurring,
            recurrence_rule=recurrence_rule,
            recurrence_pattern=recurrence_pattern,
            has_video_call=has_video,
            video_call_type=video_type,
            video_call_link=video_link,
            has_agenda=has_agenda,
            agenda_items=agenda_items,
            action_items=action_items,
            body_text=description or "",
            participants=all_participants,
            participant_emails=all_emails,
        )

    def _extract_title(self, content: str) -> str:
        """Extract event title."""
        patterns = [
            r'^SUMMARY[;:](.+?)$',
            r'^Subject:\s*(.+?)$',
            r'^Title:\s*(.+?)$',
            r'^Event:\s*(.+?)$',
        ]

        for pattern in patterns:
            match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE)
            if match:
                return match.group(1).strip()

        # Fallback: first line might be title
        first_line = content.split('\n')[0].strip()
        if len(first_line) < 200:
            return first_line

        return ""

    def _extract_description(self, content: str) -> str | None:
        """Extract event description."""
        patterns = [
            r'DESCRIPTION[;:](.+?)(?=^[A-Z]+[;:]|$)',
            r'Description:\s*(.+?)(?=^[A-Za-z]+:|$)',
        ]

        for pattern in patterns:
            match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE | re.DOTALL)
            if match:
                desc = match.group(1).strip()
                # Clean up iCal escapes
                desc = desc.replace('\\n', '\n').replace('\\,', ',')
                return desc

        return None

    def _extract_location(self, content: str) -> str | None:
        """Extract event location."""
        patterns = [
            r'LOCATION[;:](.+?)$',
            r'Location:\s*(.+?)$',
            r'Where:\s*(.+?)$',
        ]

        for pattern in patterns:
            match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE)
            if match:
                return match.group(1).strip()

        return None

    def _extract_organizer(self, content: str) -> tuple[str | None, str | None]:
        """Extract organizer email and name."""
        patterns = [
            r'ORGANIZER[;:](?:CN=([^:;]+)[;:])?(?:MAILTO:)?([^\s\n]+)',
            r'Organizer:\s*(.+?)\s*[<(]([^\s>)]+@[^\s>)]+)[>)]?',
            r'Organizer:\s*([^\s<]+@[^\s>]+)',
        ]

        for pattern in patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                groups = match.groups()
                if len(groups) == 1:
                    return groups[0], None
                elif len(groups) == 2:
                    return groups[1], groups[0]

        return None, None

    def _extract_attendees(self, content: str) -> list[dict]:
        """Extract attendees with their status."""
        attendees = []

        # iCal format
        ical_pattern = r'ATTENDEE[;:](?:.*?CN=([^;:]+)[;:])?(?:.*?PARTSTAT=(\w+)[;:])?(?:.*?ROLE=(\w+)[;:])?(?:MAILTO:)?([^\s\n]+)'
        for match in re.finditer(ical_pattern, content, re.IGNORECASE):
            name, partstat, role, email = match.groups()
            status = self._normalize_partstat(partstat)
            attendees.append({
                "email": email.strip() if email else None,
                "name": name.strip() if name else None,
                "status": status,
                "is_optional": role and "OPT" in role.upper(),
            })

        # Plain format: "Attendees: name1, name2"
        plain_pattern = r'Attendees?:\s*(.+?)(?=^[A-Za-z]+:|$)'
        match = re.search(plain_pattern, content, re.MULTILINE | re.IGNORECASE | re.DOTALL)
        if match and not attendees:
            attendee_text = match.group(1)
            # Split by comma, newline, or semicolon
            for part in re.split(r'[,;\n]+', attendee_text):
                part = part.strip()
                if part:
                    # Try to extract email
                    email_match = re.search(r'([^\s<]+@[^\s>]+)', part)
                    if email_match:
                        attendees.append({
                            "email": email_match.group(1),
                            "name": part.replace(email_match.group(0), '').strip(' <>()'),
                            "status": "unknown",
                        })
                    else:
                        attendees.append({
                            "email": None,
                            "name": part,
                            "status": "unknown",
                        })

        return attendees

    def _normalize_partstat(self, partstat: str | None) -> str:
        """Normalize participation status."""
        if not partstat:
            return "unknown"

        status_map = {
            "ACCEPTED": "accepted",
            "DECLINED": "declined",
            "TENTATIVE": "tentative",
            "NEEDS-ACTION": "pending",
            "DELEGATED": "pending",
        }

        return status_map.get(partstat.upper(), "unknown")

    def _extract_times(self, content: str) -> tuple[datetime | None, datetime | None, bool]:
        """Extract start and end times."""
        start_time = None
        end_time = None
        is_all_day = False

        # iCal date/time patterns
        dtstart_match = re.search(r'DTSTART[;:](?:VALUE=DATE[;:])?(\d{8}T?\d{0,6}Z?)', content)
        dtend_match = re.search(r'DTEND[;:](?:VALUE=DATE[;:])?(\d{8}T?\d{0,6}Z?)', content)

        if dtstart_match:
            start_str = dtstart_match.group(1)
            start_time = self._parse_ical_datetime(start_str)
            is_all_day = len(start_str) == 8  # Just date, no time

        if dtend_match:
            end_str = dtend_match.group(1)
            end_time = self._parse_ical_datetime(end_str)

        # Plain format fallback
        if not start_time:
            patterns = [
                r'(?:Start|When|Date):\s*(.+?)$',
                r'(\d{1,2}/\d{1,2}/\d{2,4})\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:AM|PM)?)',
            ]
            for pattern in patterns:
                match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE)
                if match:
                    try:
                        # Attempt to parse various date formats
                        date_str = match.group(0)
                        for fmt in ["%m/%d/%Y %I:%M %p", "%Y-%m-%d %H:%M", "%m/%d/%y %I:%M %p"]:
                            try:
                                start_time = datetime.strptime(date_str, fmt)
                                break
                            except ValueError:
                                continue
                    except Exception:
                        pass

        return start_time, end_time, is_all_day

    def _parse_ical_datetime(self, dt_str: str) -> datetime | None:
        """Parse iCal date/time format."""
        try:
            if len(dt_str) == 8:
                return datetime.strptime(dt_str, "%Y%m%d")
            elif len(dt_str) == 15:
                return datetime.strptime(dt_str, "%Y%m%dT%H%M%S")
            elif len(dt_str) == 16 and dt_str.endswith('Z'):
                return datetime.strptime(dt_str, "%Y%m%dT%H%M%SZ")
        except ValueError:
            pass
        return None

    def _extract_recurrence(self, content: str) -> tuple[bool, str | None, str | None]:
        """Extract recurrence information."""
        rrule_match = re.search(r'RRULE[;:](.+?)$', content, re.MULTILINE | re.IGNORECASE)

        if rrule_match:
            rule = rrule_match.group(1)

            # Determine pattern
            pattern = None
            if "FREQ=DAILY" in rule:
                pattern = "daily"
            elif "FREQ=WEEKLY" in rule:
                pattern = "weekly"
            elif "FREQ=MONTHLY" in rule:
                pattern = "monthly"
            elif "FREQ=YEARLY" in rule:
                pattern = "yearly"

            return True, rule, pattern

        # Check for recurring indicators
        if re.search(r'recurring|repeats?|every\s+(day|week|month)', content, re.IGNORECASE):
            return True, None, None

        return False, None, None

    def _extract_video_call(self, content: str) -> tuple[bool, str | None, str | None]:
        """Extract video call information."""
        video_patterns = {
            "zoom": r'(https?://[^\s]*zoom\.us/[^\s]+)',
            "meet": r'(https?://meet\.google\.com/[^\s]+)',
            "teams": r'(https?://teams\.microsoft\.com/[^\s]+)',
            "webex": r'(https?://[^\s]*webex\.com/[^\s]+)',
        }

        for platform, pattern in video_patterns.items():
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                return True, platform, match.group(1)

        # Check for generic video call mentions
        if re.search(r'video\s*call|conference\s*call|virtual\s*meeting', content, re.IGNORECASE):
            return True, "other", None

        return False, None, None

    def _extract_agenda(self, content: str) -> tuple[bool, list[str]]:
        """Extract agenda items."""
        agenda_items = []

        # Look for agenda section
        agenda_match = re.search(r'Agenda:?\s*\n((?:[-•*]\s*.+\n?)+)', content, re.IGNORECASE)

        if agenda_match:
            lines = agenda_match.group(1).split('\n')
            for line in lines:
                item = re.sub(r'^[-•*]\s*', '', line).strip()
                if item:
                    agenda_items.append(item)

        # Also look for numbered items
        numbered_match = re.search(r'(?:Agenda|Topics):?\s*\n((?:\d+[.)]\s*.+\n?)+)', content, re.IGNORECASE)
        if numbered_match and not agenda_items:
            lines = numbered_match.group(1).split('\n')
            for line in lines:
                item = re.sub(r'^\d+[.)]\s*', '', line).strip()
                if item:
                    agenda_items.append(item)

        return bool(agenda_items), agenda_items

    def _extract_action_items(self, content: str) -> list[str]:
        """Extract action items from description."""
        action_items = []

        # Look for action item patterns
        patterns = [
            r'Action(?:\s+items?)?:\s*\n((?:[-•*]\s*.+\n?)+)',
            r'TODO:?\s*(.+?)(?=\n|$)',
            r'(?:^|\n)[-•*]\s*\[?\s*\]?\s*(.+?)(?=\n|$)',
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, content, re.IGNORECASE | re.MULTILINE):
                item = match.group(1).strip()
                if item and len(item) < 500:
                    action_items.append(item)

        return action_items

    def clean_body(self, content: str) -> str:
        """Clean calendar event text."""
        parsed = self.parse(content)
        return parsed.description or parsed.title
