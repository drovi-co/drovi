"""
Google Calendar Connector

Extracts calendar events, attendees, and meeting details from Google Calendar.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.http_client import connector_request
from src.connectors.sources.calendar.google_calendar_definition import CAPABILITIES, OAUTH_SCOPES, default_streams

logger = structlog.get_logger()

GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3"


def _google_error_detail(response: httpx.Response) -> str:
    """Extract a concise Google API error detail from the response payload."""
    try:
        payload = response.json()
    except Exception:
        payload = None

    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            message = str(err.get("message") or "").strip()
            reasons = [
                str(item.get("reason"))
                for item in err.get("errors", [])
                if isinstance(item, dict) and item.get("reason")
            ]
            if message and reasons:
                return f"{message} [reason={','.join(reasons)}]"
            if message:
                return message
        elif isinstance(err, str) and err.strip():
            return err.strip()

    raw = (response.text or "").strip()
    return raw[:300] if raw else "no additional details"


def _parse_iso_datetime(value: str | None) -> datetime | None:
    """Parse ISO datetime strings that may use trailing Z."""
    if not value:
        return None
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = f"{candidate[:-1]}+00:00"
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


def _to_rfc3339_utc(value: datetime) -> str:
    """Format datetime as strict RFC3339 UTC timestamp."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


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

    connector_type = "google_calendar"
    capabilities = CAPABILITIES
    SCOPES = list(OAUTH_SCOPES)

    def __init__(self):
        """Initialize Google Calendar connector."""
        self._access_token: str | None = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if Google Calendar credentials are valid."""
        try:
            access_token = config.get_credential("access_token")
            if not access_token:
                return False, "Missing access_token in credentials"

            async with httpx.AsyncClient() as client:
                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=f"{GOOGLE_CALENDAR_BASE_URL}/users/me/calendarList",
                    operation="check_connection",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"maxResults": 1},
                )

                if response.status_code == 200:
                    logger.info("Google Calendar connection verified")
                    return True, None
                elif response.status_code == 401:
                    return False, "Invalid or expired access token"
                else:
                    return False, f"Google Calendar API error: {response.status_code} ({_google_error_detail(response)})"

        except Exception as e:
            return False, f"Connection check failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available Calendar streams."""
        return default_streams()

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from a Calendar stream."""
        self._access_token = config.get_credential("access_token")

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

                response = await connector_request(
                    connector=self,
                    config=config,
                    client=client,
                    method="GET",
                    url=f"{GOOGLE_CALENDAR_BASE_URL}/users/me/calendarList",
                    operation="read_calendars",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params=params,
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
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
                    record = self.create_record(
                        record_id=calendar.id,
                        stream_name=stream.stream_name,
                        data=self._calendar_to_record(calendar),
                    )
                    record.record_type = RecordType.CUSTOM
                    batch.add_record(record)

                if batch.records:
                    batch.complete(has_more=bool(data.get("nextPageToken")))
                    yield batch

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
        calendars_to_sync = config.get_setting("calendar_ids")
        if not calendars_to_sync:
            # Default to primary calendar
            calendars_to_sync = ["primary"]

        # Sync window - default to 90 days in past and future
        sync_params = config.get_setting("sync_params", {}) or {}
        backfill_start = sync_params.get("backfill_start")
        backfill_end = sync_params.get("backfill_end")

        if isinstance(backfill_start, str):
            backfill_start = _parse_iso_datetime(backfill_start)
        if isinstance(backfill_end, str):
            backfill_end = _parse_iso_datetime(backfill_end)

        now_utc = datetime.now(timezone.utc)

        if backfill_start or backfill_end:
            start_dt = backfill_start or (now_utc - timedelta(days=90))
            end_dt = backfill_end or (now_utc + timedelta(days=90))
        else:
            start_dt = now_utc - timedelta(days=90)
            end_dt = now_utc + timedelta(days=90)

        if start_dt > end_dt:
            start_dt, end_dt = end_dt, start_dt

        time_min = _to_rfc3339_utc(start_dt)
        time_max = _to_rfc3339_utc(end_dt)

        newest_update = last_sync_time

        async with httpx.AsyncClient(timeout=60.0) as client:
            for calendar_id in calendars_to_sync:
                async for batch in self._read_calendar_events(
                    config,
                    client,
                    calendar_id,
                    time_min,
                    time_max,
                    last_sync_time,
                ):
                    yield batch

                    # Track newest update time
                    for record in batch.records:
                        updated = record.data.get("updated") if hasattr(record, "data") else None
                        if updated and (not newest_update or updated > newest_update):
                            newest_update = updated

        # Final batch with updated cursor
        if newest_update and newest_update != last_sync_time:
            batch = self.create_batch(stream.stream_name, config.connection_id)
            batch.complete(next_cursor={"updated": newest_update}, has_more=False)
            yield batch

    async def _read_calendar_events(
        self,
        config: ConnectorConfig,
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

            response = await connector_request(
                connector=self,
                config=config,
                client=client,
                method="GET",
                url=f"{GOOGLE_CALENDAR_BASE_URL}/calendars/{calendar_id}/events",
                operation="read_events",
                headers={"Authorization": f"Bearer {self._access_token}"},
                params=params,
            )
            if response.status_code != 200:
                raise RuntimeError(
                    f"Google Calendar events API error: {response.status_code} ({_google_error_detail(response)})"
                )
            data = response.json()

            batch = self.create_batch("events", config.connection_id)
            for item in data.get("items", []):
                event = self._parse_event(item, calendar_id)
                if event:
                    record = self.create_record(
                        record_id=event.id,
                        stream_name="events",
                        data=self._event_to_record(event),
                        cursor_value=event.updated,
                    )
                    record.record_type = RecordType.EVENT
                    batch.add_record(record)

            if batch.records:
                batch.complete(has_more=bool(data.get("nextPageToken")))
                yield batch

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
