"""
HubSpot CRM Connector

Extracts contacts, companies, deals, and activities from HubSpot.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState
from src.connectors.http import request_with_retry

logger = structlog.get_logger()

HUBSPOT_BASE_URL = "https://api.hubapi.com"


@dataclass
class HubSpotContact:
    """Represents a HubSpot contact."""

    id: str
    email: str | None
    first_name: str | None
    last_name: str | None
    phone: str | None
    company: str | None
    job_title: str | None
    lifecycle_stage: str | None
    lead_status: str | None
    owner_id: str | None
    created_at: str
    updated_at: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class HubSpotCompany:
    """Represents a HubSpot company."""

    id: str
    name: str | None
    domain: str | None
    industry: str | None
    phone: str | None
    city: str | None
    country: str | None
    owner_id: str | None
    created_at: str
    updated_at: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class HubSpotDeal:
    """Represents a HubSpot deal."""

    id: str
    name: str | None
    stage: str | None
    pipeline: str | None
    amount: float | None
    close_date: str | None
    owner_id: str | None
    created_at: str
    updated_at: str
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class HubSpotEngagement:
    """Represents a HubSpot engagement (email, call, meeting, note)."""

    id: str
    type: str  # EMAIL, CALL, MEETING, NOTE, TASK
    timestamp: str
    owner_id: str | None
    associations: dict[str, list[str]]
    metadata: dict[str, Any] = field(default_factory=dict)


class HubSpotConnector(BaseConnector):
    """
    Connector for HubSpot CRM.

    Extracts:
    - Contacts
    - Companies
    - Deals
    - Engagements (emails, calls, meetings, notes)

    Supports incremental sync based on lastmodifieddate.
    """

    def __init__(self):
        """Initialize HubSpot connector."""
        self._access_token: str | None = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if HubSpot credentials are valid."""
        try:
            access_token = config.get_credential("access_token")
            if not access_token:
                return False, "Missing access_token in credentials"

            async with httpx.AsyncClient() as client:
                response = await request_with_retry(
                    client,
                    "GET",
                    f"{HUBSPOT_BASE_URL}/crm/v3/objects/contacts",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"limit": 1},
                    rate_limit_key=self.get_rate_limit_key(config),
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )

                if response.status_code == 200:
                    logger.info("HubSpot connection verified")
                    return True, None
                elif response.status_code == 401:
                    return False, "Invalid or expired access token"
                else:
                    return False, f"HubSpot API error: {response.status_code}"

        except Exception as e:
            return False, f"Connection check failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available HubSpot streams."""
        return [
            StreamConfig(
                stream_name="contacts",
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="lastmodifieddate",
            ),
            StreamConfig(
                stream_name="companies",
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="lastmodifieddate",
            ),
            StreamConfig(
                stream_name="deals",
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="lastmodifieddate",
            ),
            StreamConfig(
                stream_name="engagements",
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="lastUpdated",
            ),
        ]

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from a HubSpot stream."""
        self._access_token = config.get_credential("access_token")

        if stream.stream_name == "contacts":
            async for batch in self._read_contacts(config, stream, state):
                yield batch
        elif stream.stream_name == "companies":
            async for batch in self._read_companies(config, stream, state):
                yield batch
        elif stream.stream_name == "deals":
            async for batch in self._read_deals(config, stream, state):
                yield batch
        elif stream.stream_name == "engagements":
            async for batch in self._read_engagements(config, stream, state):
                yield batch
        else:
            logger.warning(f"Unknown stream: {stream.stream_name}")

    async def _read_contacts(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read contacts from HubSpot."""
        cursor = state.get_cursor(stream.stream_name)
        after = cursor.get("after") if cursor else None

        properties = [
            "email", "firstname", "lastname", "phone", "company",
            "jobtitle", "lifecyclestage", "hs_lead_status", "hubspot_owner_id",
            "createdate", "lastmodifieddate",
        ]

        async with httpx.AsyncClient(timeout=60.0) as client:
            while True:
                params: dict[str, Any] = {
                    "limit": 100,
                    "properties": ",".join(properties),
                }
                if after:
                    params["after"] = after

                response = await request_with_retry(
                    client,
                    "GET",
                    f"{HUBSPOT_BASE_URL}/crm/v3/objects/contacts",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params=params,
                    rate_limit_key=self.get_rate_limit_key(config),
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for result in data.get("results", []):
                    props = result.get("properties", {})
                    contact = HubSpotContact(
                        id=result["id"],
                        email=props.get("email"),
                        first_name=props.get("firstname"),
                        last_name=props.get("lastname"),
                        phone=props.get("phone"),
                        company=props.get("company"),
                        job_title=props.get("jobtitle"),
                        lifecycle_stage=props.get("lifecyclestage"),
                        lead_status=props.get("hs_lead_status"),
                        owner_id=props.get("hubspot_owner_id"),
                        created_at=props.get("createdate", ""),
                        updated_at=props.get("lastmodifieddate", ""),
                        properties=props,
                    )
                    record = self.create_record(
                        record_id=contact.id,
                        stream_name=stream.stream_name,
                        data=self._contact_to_record(contact),
                        cursor_value=contact.updated_at,
                    )
                    record.record_type = RecordType.CONTACT
                    batch.add_record(record)

                paging = data.get("paging", {})
                next_link = paging.get("next", {})
                after = next_link.get("after")

                if batch.records:
                    batch.complete(
                        next_cursor={"after": after} if after else None,
                        has_more=bool(after),
                    )
                    yield batch

                if not after:
                    break

    async def _read_companies(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read companies from HubSpot."""
        cursor = state.get_cursor(stream.stream_name)
        after = cursor.get("after") if cursor else None

        properties = [
            "name", "domain", "industry", "phone", "city", "country",
            "hubspot_owner_id", "createdate", "lastmodifieddate",
        ]

        async with httpx.AsyncClient(timeout=60.0) as client:
            while True:
                params: dict[str, Any] = {
                    "limit": 100,
                    "properties": ",".join(properties),
                }
                if after:
                    params["after"] = after

                response = await request_with_retry(
                    client,
                    "GET",
                    f"{HUBSPOT_BASE_URL}/crm/v3/objects/companies",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params=params,
                    rate_limit_key=self.get_rate_limit_key(config),
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for result in data.get("results", []):
                    props = result.get("properties", {})
                    company = HubSpotCompany(
                        id=result["id"],
                        name=props.get("name"),
                        domain=props.get("domain"),
                        industry=props.get("industry"),
                        phone=props.get("phone"),
                        city=props.get("city"),
                        country=props.get("country"),
                        owner_id=props.get("hubspot_owner_id"),
                        created_at=props.get("createdate", ""),
                        updated_at=props.get("lastmodifieddate", ""),
                        properties=props,
                    )
                    record = self.create_record(
                        record_id=company.id,
                        stream_name=stream.stream_name,
                        data=self._company_to_record(company),
                        cursor_value=company.updated_at,
                    )
                    record.record_type = RecordType.CUSTOM
                    batch.add_record(record)

                paging = data.get("paging", {})
                next_link = paging.get("next", {})
                after = next_link.get("after")

                if batch.records:
                    batch.complete(
                        next_cursor={"after": after} if after else None,
                        has_more=bool(after),
                    )
                    yield batch

                if not after:
                    break

    async def _read_deals(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read deals from HubSpot."""
        cursor = state.get_cursor(stream.stream_name)
        after = cursor.get("after") if cursor else None

        properties = [
            "dealname", "dealstage", "pipeline", "amount", "closedate",
            "hubspot_owner_id", "createdate", "lastmodifieddate",
        ]

        async with httpx.AsyncClient(timeout=60.0) as client:
            while True:
                params: dict[str, Any] = {
                    "limit": 100,
                    "properties": ",".join(properties),
                }
                if after:
                    params["after"] = after

                response = await request_with_retry(
                    client,
                    "GET",
                    f"{HUBSPOT_BASE_URL}/crm/v3/objects/deals",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params=params,
                    rate_limit_key=self.get_rate_limit_key(config),
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for result in data.get("results", []):
                    props = result.get("properties", {})
                    amount = props.get("amount")
                    deal = HubSpotDeal(
                        id=result["id"],
                        name=props.get("dealname"),
                        stage=props.get("dealstage"),
                        pipeline=props.get("pipeline"),
                        amount=float(amount) if amount else None,
                        close_date=props.get("closedate"),
                        owner_id=props.get("hubspot_owner_id"),
                        created_at=props.get("createdate", ""),
                        updated_at=props.get("lastmodifieddate", ""),
                        properties=props,
                    )
                    record = self.create_record(
                        record_id=deal.id,
                        stream_name=stream.stream_name,
                        data=self._deal_to_record(deal),
                        cursor_value=deal.updated_at,
                    )
                    record.record_type = RecordType.CUSTOM
                    batch.add_record(record)

                paging = data.get("paging", {})
                next_link = paging.get("next", {})
                after = next_link.get("after")

                if batch.records:
                    batch.complete(
                        next_cursor={"after": after} if after else None,
                        has_more=bool(after),
                    )
                    yield batch

                if not after:
                    break

    async def _read_engagements(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read engagements from HubSpot."""
        cursor = state.get_cursor(stream.stream_name)
        offset = cursor.get("offset") if cursor else None

        async with httpx.AsyncClient(timeout=60.0) as client:
            while True:
                params: dict[str, Any] = {"limit": 250}
                if offset:
                    params["offset"] = offset

                response = await request_with_retry(
                    client,
                    "GET",
                    f"{HUBSPOT_BASE_URL}/engagements/v1/engagements/paged",
                    headers={"Authorization": f"Bearer {self._access_token}"},
                    params=params,
                    rate_limit_key=self.get_rate_limit_key(config),
                    rate_limit_per_minute=self.get_rate_limit_per_minute(),
                )
                response.raise_for_status()
                data = response.json()

                batch = self.create_batch(stream.stream_name, config.connection_id)
                for result in data.get("results", []):
                    engagement_data = result.get("engagement", {})
                    associations = result.get("associations", {})
                    metadata = result.get("metadata", {})

                    engagement = HubSpotEngagement(
                        id=str(engagement_data.get("id")),
                        type=engagement_data.get("type", "UNKNOWN"),
                        timestamp=str(engagement_data.get("timestamp", "")),
                        owner_id=str(engagement_data.get("ownerId")) if engagement_data.get("ownerId") else None,
                        associations={
                            "contactIds": [str(i) for i in associations.get("contactIds", [])],
                            "companyIds": [str(i) for i in associations.get("companyIds", [])],
                            "dealIds": [str(i) for i in associations.get("dealIds", [])],
                        },
                        metadata=metadata,
                    )
                    record = self.create_record(
                        record_id=engagement.id,
                        stream_name=stream.stream_name,
                        data=self._engagement_to_record(engagement),
                        cursor_value=engagement.timestamp,
                    )
                    record.record_type = RecordType.EVENT
                    batch.add_record(record)

                has_more = data.get("hasMore", False)
                offset = data.get("offset")

                if batch.records:
                    batch.complete(
                        next_cursor={"offset": offset} if has_more else None,
                        has_more=bool(has_more),
                    )
                    yield batch

                if not has_more:
                    break

    def _contact_to_record(self, contact: HubSpotContact) -> dict[str, Any]:
        """Convert HubSpotContact to a record dict."""
        full_name = " ".join(
            filter(None, [contact.first_name, contact.last_name])
        ) or None

        return {
            "id": contact.id,
            "type": "hubspot_contact",
            "email": contact.email,
            "first_name": contact.first_name,
            "last_name": contact.last_name,
            "full_name": full_name,
            "phone": contact.phone,
            "company": contact.company,
            "job_title": contact.job_title,
            "lifecycle_stage": contact.lifecycle_stage,
            "lead_status": contact.lead_status,
            "owner_id": contact.owner_id,
            "created_at": contact.created_at,
            "updated_at": contact.updated_at,
            "properties": contact.properties,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _company_to_record(self, company: HubSpotCompany) -> dict[str, Any]:
        """Convert HubSpotCompany to a record dict."""
        return {
            "id": company.id,
            "type": "hubspot_company",
            "name": company.name,
            "domain": company.domain,
            "industry": company.industry,
            "phone": company.phone,
            "city": company.city,
            "country": company.country,
            "owner_id": company.owner_id,
            "created_at": company.created_at,
            "updated_at": company.updated_at,
            "properties": company.properties,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _deal_to_record(self, deal: HubSpotDeal) -> dict[str, Any]:
        """Convert HubSpotDeal to a record dict."""
        return {
            "id": deal.id,
            "type": "hubspot_deal",
            "name": deal.name,
            "stage": deal.stage,
            "pipeline": deal.pipeline,
            "amount": deal.amount,
            "close_date": deal.close_date,
            "owner_id": deal.owner_id,
            "created_at": deal.created_at,
            "updated_at": deal.updated_at,
            "properties": deal.properties,
            "extracted_at": datetime.utcnow().isoformat(),
        }

    def _engagement_to_record(self, engagement: HubSpotEngagement) -> dict[str, Any]:
        """Convert HubSpotEngagement to a record dict."""
        # Extract relevant metadata based on type
        content = ""
        subject = ""
        duration = None

        if engagement.type == "EMAIL":
            subject = engagement.metadata.get("subject", "")
            content = engagement.metadata.get("text", "") or engagement.metadata.get("html", "")
        elif engagement.type == "CALL":
            content = engagement.metadata.get("body", "")
            duration = engagement.metadata.get("durationMilliseconds")
        elif engagement.type == "MEETING":
            content = engagement.metadata.get("body", "")
            subject = engagement.metadata.get("title", "")
        elif engagement.type == "NOTE":
            content = engagement.metadata.get("body", "")
        elif engagement.type == "TASK":
            content = engagement.metadata.get("body", "")
            subject = engagement.metadata.get("subject", "")

        return {
            "id": engagement.id,
            "type": f"hubspot_{engagement.type.lower()}",
            "engagement_type": engagement.type,
            "timestamp": engagement.timestamp,
            "owner_id": engagement.owner_id,
            "subject": subject,
            "content": content,
            "duration_ms": duration,
            "contact_ids": engagement.associations.get("contactIds", []),
            "company_ids": engagement.associations.get("companyIds", []),
            "deal_ids": engagement.associations.get("dealIds", []),
            "metadata": engagement.metadata,
            "extracted_at": datetime.utcnow().isoformat(),
        }


# Register connector
ConnectorRegistry.register("hubspot", HubSpotConnector)
