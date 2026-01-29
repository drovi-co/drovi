"""
Webhook Delivery Service

Handles outgoing webhooks to notify external systems of events.
Implements:
- Event emission on UIO lifecycle changes
- HMAC signature generation for security
- Retry logic with exponential backoff
- PostgreSQL persistence for subscriptions and deliveries
"""

import hashlib
import hmac
import json
from datetime import datetime, timedelta
from enum import Enum
from typing import Any
from uuid import uuid4

import httpx
import structlog
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.db import get_db_session
from src.db.models import WebhookSubscription as WebhookSubscriptionModel
from src.db.models import WebhookDelivery as WebhookDeliveryModel

logger = structlog.get_logger()


class WebhookEventType(str, Enum):
    """Types of events that can trigger webhooks."""

    # UIO events
    UIO_CREATED = "uio.created"
    UIO_UPDATED = "uio.updated"
    UIO_COMPLETED = "uio.completed"
    UIO_CANCELLED = "uio.cancelled"

    # Commitment events
    COMMITMENT_CREATED = "commitment.created"
    COMMITMENT_FULFILLED = "commitment.fulfilled"
    COMMITMENT_BROKEN = "commitment.broken"
    COMMITMENT_DUE_SOON = "commitment.due_soon"

    # Decision events
    DECISION_MADE = "decision.made"
    DECISION_REVERSED = "decision.reversed"

    # Risk events
    RISK_DETECTED = "risk.detected"
    RISK_RESOLVED = "risk.resolved"

    # Sync events
    SYNC_STARTED = "sync.started"
    SYNC_COMPLETED = "sync.completed"
    SYNC_FAILED = "sync.failed"


class DeliveryStatus(str, Enum):
    """Webhook delivery status."""

    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"
    RETRYING = "retrying"


class WebhookService:
    """
    Webhook delivery service with database persistence.

    Provides:
    - Subscription management (PostgreSQL-backed)
    - Event emission
    - Reliable delivery with retries
    - HMAC signature verification
    """

    MAX_RETRIES = 5
    RETRY_DELAYS = [30, 60, 300, 900, 3600]  # 30s, 1m, 5m, 15m, 1h

    def __init__(self):
        """Initialize webhook service."""
        pass  # No in-memory storage needed - using database

    async def create_subscription(
        self,
        organization_id: str,
        url: str,
        events: list[WebhookEventType],
        secret: str | None = None,
        name: str | None = None,
        description: str | None = None,
    ) -> WebhookSubscriptionModel:
        """
        Create a new webhook subscription.

        Args:
            organization_id: Organization ID
            url: Webhook endpoint URL
            events: List of event types to subscribe to
            secret: HMAC signing secret (generated if not provided)
            name: Optional subscription name
            description: Optional description

        Returns:
            Created subscription
        """
        subscription_id = f"whsub_{uuid4().hex[:12]}"

        if not secret:
            import secrets
            secret = secrets.token_hex(32)

        async with get_db_session() as session:
            subscription = WebhookSubscriptionModel(
                id=subscription_id,
                organization_id=organization_id,
                url=url,
                events=[e.value for e in events],
                secret=secret,
                name=name,
                description=description,
                active=True,
            )
            session.add(subscription)
            await session.flush()

            logger.info(
                "Webhook subscription created",
                subscription_id=subscription_id,
                organization_id=organization_id,
                events=[e.value for e in events],
            )

            return subscription

    async def update_subscription(
        self,
        subscription_id: str,
        url: str | None = None,
        events: list[WebhookEventType] | None = None,
        active: bool | None = None,
        name: str | None = None,
        description: str | None = None,
    ) -> WebhookSubscriptionModel | None:
        """Update a webhook subscription."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WebhookSubscriptionModel).where(
                    WebhookSubscriptionModel.id == subscription_id
                )
            )
            subscription = result.scalar_one_or_none()

            if not subscription:
                return None

            if url is not None:
                subscription.url = url
            if events is not None:
                subscription.events = [e.value for e in events]
            if active is not None:
                subscription.active = active
            if name is not None:
                subscription.name = name
            if description is not None:
                subscription.description = description

            await session.flush()
            logger.info("Webhook subscription updated", subscription_id=subscription_id)
            return subscription

    async def delete_subscription(self, subscription_id: str) -> bool:
        """Delete a webhook subscription."""
        async with get_db_session() as session:
            result = await session.execute(
                delete(WebhookSubscriptionModel).where(
                    WebhookSubscriptionModel.id == subscription_id
                )
            )
            deleted = result.rowcount > 0

            if deleted:
                logger.info("Webhook subscription deleted", subscription_id=subscription_id)

            return deleted

    async def get_subscription(self, subscription_id: str) -> WebhookSubscriptionModel | None:
        """Get a subscription by ID."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WebhookSubscriptionModel).where(
                    WebhookSubscriptionModel.id == subscription_id
                )
            )
            return result.scalar_one_or_none()

    async def get_subscriptions(
        self,
        organization_id: str,
        active_only: bool = True,
    ) -> list[WebhookSubscriptionModel]:
        """Get all subscriptions for an organization."""
        async with get_db_session() as session:
            query = select(WebhookSubscriptionModel).where(
                WebhookSubscriptionModel.organization_id == organization_id
            )
            if active_only:
                query = query.where(WebhookSubscriptionModel.active == True)

            result = await session.execute(query)
            return list(result.scalars().all())

    async def emit_event(
        self,
        organization_id: str,
        event_type: WebhookEventType,
        payload: dict[str, Any],
    ) -> list[str]:
        """
        Emit an event to all matching subscriptions.

        Args:
            organization_id: Organization ID
            event_type: Type of event
            payload: Event payload

        Returns:
            List of delivery IDs
        """
        delivery_ids = []

        # Find matching subscriptions
        subscriptions = await self._get_matching_subscriptions(
            organization_id, event_type
        )

        for subscription in subscriptions:
            delivery_id = await self._create_delivery(
                subscription, event_type, payload
            )
            delivery_ids.append(delivery_id)

            # Attempt immediate delivery
            await self._attempt_delivery(delivery_id)

        return delivery_ids

    async def _get_matching_subscriptions(
        self,
        organization_id: str,
        event_type: WebhookEventType,
    ) -> list[WebhookSubscriptionModel]:
        """Get subscriptions matching the organization and event type."""
        async with get_db_session() as session:
            # Query subscriptions where events array contains the event type
            result = await session.execute(
                select(WebhookSubscriptionModel).where(
                    WebhookSubscriptionModel.organization_id == organization_id,
                    WebhookSubscriptionModel.active == True,
                    WebhookSubscriptionModel.events.contains([event_type.value]),
                )
            )
            return list(result.scalars().all())

    async def _create_delivery(
        self,
        subscription: WebhookSubscriptionModel,
        event_type: WebhookEventType,
        payload: dict[str, Any],
    ) -> str:
        """Create a delivery record in database."""
        delivery_id = f"whdel_{uuid4().hex[:12]}"

        async with get_db_session() as session:
            delivery = WebhookDeliveryModel(
                id=delivery_id,
                subscription_id=subscription.id,
                event_type=event_type.value,
                payload=payload,
                status=DeliveryStatus.PENDING.value,
                attempts=0,
                max_attempts=self.MAX_RETRIES,
            )
            session.add(delivery)
            await session.flush()

        return delivery_id

    async def _attempt_delivery(self, delivery_id: str) -> bool:
        """
        Attempt to deliver a webhook.

        Returns True if delivery succeeded.
        """
        async with get_db_session() as session:
            # Get delivery with subscription
            result = await session.execute(
                select(WebhookDeliveryModel).where(
                    WebhookDeliveryModel.id == delivery_id
                )
            )
            delivery = result.scalar_one_or_none()

            if not delivery:
                return False

            # Get subscription
            sub_result = await session.execute(
                select(WebhookSubscriptionModel).where(
                    WebhookSubscriptionModel.id == delivery.subscription_id
                )
            )
            subscription = sub_result.scalar_one_or_none()

            if not subscription:
                delivery.status = DeliveryStatus.FAILED.value
                delivery.error_message = "Subscription not found"
                return False

            # Update attempt tracking
            delivery.attempts += 1
            delivery.last_attempt_at = datetime.utcnow()
            delivery.status = DeliveryStatus.RETRYING.value

            # Build webhook payload
            webhook_payload = self._build_payload(delivery, subscription)

            # Generate signature
            signature = self._generate_signature(
                json.dumps(webhook_payload, sort_keys=True),
                subscription.secret,
            )

            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        subscription.url,
                        json=webhook_payload,
                        headers={
                            "Content-Type": "application/json",
                            "X-Webhook-Signature": signature,
                            "X-Webhook-Delivery-ID": delivery.id,
                            "X-Webhook-Event": delivery.event_type,
                        },
                    )

                delivery.response_code = response.status_code

                if response.is_success:
                    delivery.status = DeliveryStatus.DELIVERED.value
                    delivery.delivered_at = datetime.utcnow()
                    logger.info(
                        "Webhook delivered",
                        delivery_id=delivery_id,
                        subscription_id=subscription.id,
                        status_code=response.status_code,
                    )
                    return True
                else:
                    logger.warning(
                        "Webhook delivery failed",
                        delivery_id=delivery_id,
                        status_code=response.status_code,
                        attempts=delivery.attempts,
                    )

            except Exception as e:
                delivery.error_message = str(e)
                logger.error(
                    "Webhook delivery error",
                    delivery_id=delivery_id,
                    error=str(e),
                    attempts=delivery.attempts,
                )

            # Check if we should retry
            if delivery.attempts < delivery.max_attempts:
                delivery.status = DeliveryStatus.RETRYING.value
                # Calculate next retry time
                delay = self.RETRY_DELAYS[min(delivery.attempts - 1, len(self.RETRY_DELAYS) - 1)]
                delivery.next_retry_at = datetime.utcnow() + timedelta(seconds=delay)
                logger.info(
                    "Webhook delivery retry scheduled",
                    delivery_id=delivery_id,
                    retry_at=delivery.next_retry_at.isoformat(),
                    delay_seconds=delay,
                )
            else:
                delivery.status = DeliveryStatus.FAILED.value

            return False

    def _build_payload(
        self,
        delivery: WebhookDeliveryModel,
        subscription: WebhookSubscriptionModel,
    ) -> dict[str, Any]:
        """Build the webhook payload."""
        return {
            "id": delivery.id,
            "event": delivery.event_type,
            "organization_id": subscription.organization_id,
            "timestamp": datetime.utcnow().isoformat(),
            "data": delivery.payload,
        }

    def _generate_signature(self, payload: str, secret: str) -> str:
        """Generate HMAC-SHA256 signature for the payload."""
        return "sha256=" + hmac.new(
            secret.encode(),
            payload.encode(),
            hashlib.sha256,
        ).hexdigest()

    async def get_delivery(self, delivery_id: str) -> WebhookDeliveryModel | None:
        """Get a delivery by ID."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WebhookDeliveryModel).where(
                    WebhookDeliveryModel.id == delivery_id
                )
            )
            return result.scalar_one_or_none()

    async def get_deliveries(
        self,
        subscription_id: str | None = None,
        status: DeliveryStatus | None = None,
        limit: int = 100,
    ) -> list[WebhookDeliveryModel]:
        """Get deliveries with optional filters."""
        async with get_db_session() as session:
            query = select(WebhookDeliveryModel)

            if subscription_id:
                query = query.where(WebhookDeliveryModel.subscription_id == subscription_id)
            if status:
                query = query.where(WebhookDeliveryModel.status == status.value)

            query = query.order_by(WebhookDeliveryModel.created_at.desc()).limit(limit)
            result = await session.execute(query)
            return list(result.scalars().all())

    async def get_pending_retries(self) -> list[WebhookDeliveryModel]:
        """Get all deliveries pending retry (next_retry_at has passed)."""
        async with get_db_session() as session:
            result = await session.execute(
                select(WebhookDeliveryModel).where(
                    WebhookDeliveryModel.status == DeliveryStatus.RETRYING.value,
                    WebhookDeliveryModel.next_retry_at <= datetime.utcnow(),
                ).order_by(WebhookDeliveryModel.next_retry_at)
            )
            return list(result.scalars().all())

    async def retry_pending_deliveries(self) -> int:
        """
        Process all deliveries pending retry.

        This should be called by a scheduled job.

        Returns number of retries attempted.
        """
        pending = await self.get_pending_retries()
        retried = 0

        for delivery in pending:
            await self._attempt_delivery(delivery.id)
            retried += 1

        if retried > 0:
            logger.info("Processed pending webhook retries", count=retried)

        return retried

    async def cleanup_old_deliveries(self, days: int = 30) -> int:
        """
        Remove old completed/failed deliveries.

        Args:
            days: Delete deliveries older than this many days

        Returns:
            Number of deliveries deleted
        """
        cutoff = datetime.utcnow() - timedelta(days=days)

        async with get_db_session() as session:
            result = await session.execute(
                delete(WebhookDeliveryModel).where(
                    WebhookDeliveryModel.created_at < cutoff,
                    WebhookDeliveryModel.status.in_([
                        DeliveryStatus.DELIVERED.value,
                        DeliveryStatus.FAILED.value,
                    ]),
                )
            )
            deleted = result.rowcount
            logger.info("Cleaned up old webhook deliveries", deleted=deleted, days=days)
            return deleted


# Singleton
_webhook_service: WebhookService | None = None


async def get_webhook_service() -> WebhookService:
    """Get the singleton WebhookService instance."""
    global _webhook_service
    if _webhook_service is None:
        _webhook_service = WebhookService()
    return _webhook_service


# =============================================================================
# CONVENIENCE FUNCTIONS FOR EVENT EMISSION
# =============================================================================


async def emit_uio_created(
    organization_id: str,
    uio_id: str,
    uio_type: str,
    uio_data: dict[str, Any],
) -> list[str]:
    """Emit UIO created event."""
    service = await get_webhook_service()
    return await service.emit_event(
        organization_id=organization_id,
        event_type=WebhookEventType.UIO_CREATED,
        payload={
            "uio_id": uio_id,
            "uio_type": uio_type,
            **uio_data,
        },
    )


async def emit_commitment_due_soon(
    organization_id: str,
    commitment_id: str,
    title: str,
    due_date: datetime,
    days_until_due: int,
) -> list[str]:
    """Emit commitment due soon event."""
    service = await get_webhook_service()
    return await service.emit_event(
        organization_id=organization_id,
        event_type=WebhookEventType.COMMITMENT_DUE_SOON,
        payload={
            "commitment_id": commitment_id,
            "title": title,
            "due_date": due_date.isoformat(),
            "days_until_due": days_until_due,
        },
    )


async def emit_risk_detected(
    organization_id: str,
    risk_id: str,
    risk_type: str,
    severity: str,
    title: str,
    description: str,
) -> list[str]:
    """Emit risk detected event."""
    service = await get_webhook_service()
    return await service.emit_event(
        organization_id=organization_id,
        event_type=WebhookEventType.RISK_DETECTED,
        payload={
            "risk_id": risk_id,
            "risk_type": risk_type,
            "severity": severity,
            "title": title,
            "description": description,
        },
    )


async def emit_sync_completed(
    organization_id: str,
    connection_id: str,
    connector_type: str,
    records_synced: int,
    duration_seconds: float,
) -> list[str]:
    """Emit sync completed event."""
    service = await get_webhook_service()
    return await service.emit_event(
        organization_id=organization_id,
        event_type=WebhookEventType.SYNC_COMPLETED,
        payload={
            "connection_id": connection_id,
            "connector_type": connector_type,
            "records_synced": records_synced,
            "duration_seconds": duration_seconds,
        },
    )
