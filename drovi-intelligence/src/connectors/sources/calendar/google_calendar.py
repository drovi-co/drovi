"""
Google Calendar Connector

Extracts calendar events, attendees, and meeting details from Google Calendar.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import httpx
import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()

GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3"


@dataclass
class CalendarEvent:
    """Represents a calendar event."""

    id: str
    calendar_id: str
    summary: str
    description: str | None
    location: str | None
    start_time: datetime
    end_time: datetime
    all_day: bool
    status: str  # confirmed, tentative, cancelled
    organizer: dict[str, str] | None
    attendees: list[dict[str, Any]]
    recurrence: list[str] | None
    created: str
    updated: str
    html_link: str | None
    conference_data: dict[str, Any] | None = None
    attachments: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Calendar:
    """Represents a calendar."""

    id: str
    summary: str
    description: str | None
    time_zone: str | None
    access_role: str  # owner, writer, reader, freeBusyReader
    primary: bool
    background_color: str | None
    foreground_color: str | None


class GoogleCalendarConnector(BaseConnector):
    """
    Connector for Google Calendar.

    Extracts:
    - Calendars (list of calendars the user has access to)
    - Events (with attendees, location, conference data)

    Supports incremental sync based on updated timestamp.
    """

    def __init__(self):
        """Initialize Google Calendar connector."""
        self._access_token: str | None = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if Google Calendar credentials are valid."""
        try:
            access_token = config.credentials.get("access_token")
            if not access_token:
                return False, "Missing access_token in credentials"

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{GOOGLE_CALENDAR_BASE_URL}/users/me/calendarList",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"maxResults": 1},
                )

                if response.status_code == 200:
                    logger.info("Google Calendar connection verified")
                    return True, None
                elif response.status_code == 401:
                    return False, "Invalid or expired access token"
                else:
                    return False, f"Google Calendar API error: {response.status_code}"

        except Exception as e:
            return False, f"Connection check failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available Calendar streams."""
        return [
            StreamConfig(
                stream_name="calendars",
                sync_mode="full_refresh",
            ),
            StreamConfig(
                stream_name="events",
                sync_mode="incremental",
                cursor_field="updated",
            ),
        ]

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from a Calendar stream."""
        self._access_token = config.credentials.get("access_token")

        if stream.stream_name == "calendars":
            async for batch in self._read_calendars(config, stream, state):
                yield batch
        elif stream.stream_name == "events":
            async for batch in self._read_events(config, stream, state):
                yield batch
        else:
            logger.warning(f"Unknown stream: {stream.stream_name}")

    async def _read_calendars(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read calendar list."""
        page_token = None
        has_more = True

        async with httpx.AsyncClient(timeout=30.0) as client:
            while has_more:
                params: dict[str, Any] = {"maxResults": 100}
                if page_token:
                    params["pageToken"] = page_token

                response = await client.get(
                    f"{GOOGLE_CALENDAR_BASE_URL}/users/me/calendarList",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params=params,
                )
                response.raise_for_status()
                data = response.json()

                calendars = []
                for item in data.get("items", []):
                    calendar = Calendar(
                        id=item["id"],
                        summary=item.get("summary", ""),
                        description=item.get("description"),
                        time_zone=item.get("timeZone"),
                        access_role=item.get("accessRole", "reader"),
                        primary=item.get("primary", False),
                        background_color=item.get("backgroundColor"),
                        foreground_color=item.get("foregroundColor"),
                    )
                    calendars.append(self._calendar_to_record(calendar))

                if calendars:
                    yield RecordBatch(records=calendars)

                page_token = data.get("nextPageToken")
                has_more = bool(page_token)

    async def _read_events(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read calendar events."""
        cursor = state.get_cursor(stream.stream_name)
        last_sync_time = cursor.get("updated") if cursor else None

        # Get list of calendars to sync
        calendars_to_sync = config.settings.get("calendar_ids")
        if not calendars_to_sync:
            # Default to primary calendar
            calendars_to_sync = ["primary"]

        # Sync window - default to 90 days in past and future
        time_min = (datetime.utcnow() - timedelta(days=90)).isoformat() + "Z"
        time_max = (datetime.utcnow() + timedelta(days=90)).isoformat() + "Z"

        newest_update = last_sync_time

        async with httpx.AsyncClient(timeout=60.0) as client:
            for calendar_id in calendars_to_sync:
                async for batch in self._read_calendar_events(
                    client,
                    calendar_id,
                    time_min,
                    time_max,
                    last_sync_time,
                ):
                    yield batch

                    # Track newest update time
                    for record in batch.records:
                        updated = record.get("updated")
                        if updated and (not newest_update or updated > newest_update):
                            newest_update = updated

        # Final batch with updated cursor
        if newest_update and newest_update != last_sync_time:
            yield RecordBatch(
                records=[],
                next_cursor={"updated": newest_update},
            )

    async def _read_calendar_events(
        self,
        client: httpx.AsyncClient,
        calendar_id: str,
        time_min: str,
        time_max: str,
        updated_min: str | None,
    ) -> AsyncIterator[RecordBatch]:
        """Read events from a specific calendar."""
        page_token = None
        has_more = True

        while has_more:
            params: dict[str, Any] = {
                "maxResults": 250,
                "singleEvents": "true",
                "orderBy": "updated",
                "timeMin": time_min,
                "timeMax": time_max,
            }
            if page_token:
                params["pageToken"] = page_token
            if updated_min:
                params["updatedMin"] = updated_min

            response = await client.get(
                f"{GOOGLE_CALENDAR_BASE_URL}/calendars/{calendar_id}/events",
                headers={"Authorization": f"Bearer {self._access_token}"},
                params=params,
            )
            response.raise_for_status()
            data = response.json()

            events = []
            for item in data.get("items", []):
                event = self._parse_event(item, calendar_id)
                if event:
                    events.append(self._event_to_record(event))

            if events:
                yield RecordBatch(records=events)

            page_token = data.get("nextPageToken")
            has_more = bool(page_token)

    def _parse_event(
        self,
        item: dict[str, Any],
        calendar_id: str,
    ) -> CalendarEvent | None:
        """Parse a calendar event from API response."""
        # Extract start/end times
        start = item.get("start", {})
        end = item.get("end", {})

        # Check if all-day event
        all_day = "date" in start

        if all_day:
            start_time = datetime.fromisoformat(start["date"])
            end_time = datetime.fromisoformat(end["date"])
        else:
            start_time = datetime.fromisoformat(
                start.get("dateTime", "").replace("Z", "+00:00")
            )
            end_time = datetime.fromisoformat(
                end.get("dateTime", "").replace("Z", "+00:00")
            )

        # Parse attendees
        attendees = []
        for attendee in item.get("attendees", []):
            attendees.append({
                "email": attendee.get("email"),
                "display_name": attendee.get("displayName"),
                "response_status": attendee.get("responseStatus"),
                "organizer": attendee.get("organizer", False),
                "self": attendee.get("self", False),
                "optional": attendee.get("optional", False),
            })

        # Parse organizer
        organizer = item.get("organizer")
        if organizer:
            organizer = {
                "email": organizer.get("email"),
                "display_name": organizer.get("displayName"),
                "self": organizer.get("self", False),
            }

        return CalendarEvent(
            id=item["id"],
            calendar_id=calendar_id,
            summary=item.get("summary", ""),
            description=item.get("description"),
            location=item.get("location"),
            start_time=start_time,
            end_time=end_time,
            all_day=all_day,
            status=item.get("status", "confirmed"),
            organizer=organizer,
            attendees=attendees,
            recurrence=item.get("recurrence"),
            created=item.get("created", ""),
            updated=item.get("updated", ""),
            html_link=item.get("htmlLink"),
            conference_data=item.get("conferenceData"),
            attachments=item.get("attachments", []),
        )

    def _calendar_to_record(self, calendar: Calendar) -> dict[str, Any]:
        """Convert Calendar to a record dict."""
        return {
            "id": calendar.id,
            "type": "google_calendar",
            "summary": calendar.summary,
            "description": calendar.description,
            "time_zone": calendar.time_zone,
            "access_role": calendar.access_role,
            "primary": calendar.primary,
            "background_color": calendar.background_color,
            "foreground_color": calendar.foreground_color,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _event_to_record(self, event: CalendarEvent) -> dict[str, Any]:
        """Convert CalendarEvent to a record dict."""
        # Calculate duration
        duration_minutes = int((event.end_time - event.start_time).total_seconds() / 60)

        return {
            "id": event.id,
            "type": "calendar_event",
            "calendar_id": event.calendar_id,
            "summary": event.summary,
            "description": event.description,
            "location": event.location,
            "start_time": event.start_time.isoformat(),
            "end_time": event.end_time.isoformat(),
            "duration_minutes": duration_minutes,
            "all_day": event.all_day,
            "status": event.status,
            "organizer": event.organizer,
            "attendees": event.attendees,
            "attendee_count": len(event.attendees),
            "has_conference": event.conference_data is not None,
            "conference_data": event.conference_data,
            "recurrence": event.recurrence,
            "html_link": event.html_link,
            "created": event.created,
            "updated": event.updated,
            "extracted_at": datetime.utcnow().isoformat(),
        }


# Register connector
ConnectorRegistry.register("google_calendar", GoogleCalendarConnector)
