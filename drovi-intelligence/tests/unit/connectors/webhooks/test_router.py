"""
Unit tests for Webhook Router.

Tests webhook endpoints for Slack, Gmail, and other providers.
"""

import pytest
import json
import hashlib
import hmac
import base64
import time
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture(autouse=True)
def clear_settings_cache():
    """Clear the settings cache before each test to allow mocking."""
    from src.config import get_settings
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def slack_signing_secret():
    """Slack signing secret for testing."""
    return "test_slack_signing_secret"


@pytest.fixture
def valid_slack_message_event():
    """Create a valid Slack message event."""
    return {
        "type": "event_callback",
        "token": "verification_token",
        "team_id": "T123ABC",
        "api_app_id": "A123ABC",
        "event": {
            "type": "message",
            "channel": "C123ABC",
            "user": "U123ABC",
            "text": "Hello, world!",
            "ts": "1704067200.000001",
        },
        "event_id": "Ev123ABC",
        "event_time": 1704067200,
    }


@pytest.fixture
def slack_url_verification():
    """Slack URL verification challenge."""
    return {
        "type": "url_verification",
        "token": "verification_token",
        "challenge": "challenge_string_123",
    }


@pytest.fixture
def gmail_push_notification():
    """Gmail push notification payload."""
    data = {
        "emailAddress": "user@example.com",
        "historyId": "12345",
    }
    encoded_data = base64.b64encode(json.dumps(data).encode()).decode()

    return {
        "message": {
            "messageId": "msg_123",
            "publishTime": "2024-01-01T12:00:00.000Z",
            "data": encoded_data,
        },
        "subscription": "projects/myproject/subscriptions/mysub",
    }


def create_slack_signature(body: bytes, secret: str, timestamp: str) -> str:
    """Create a valid Slack signature for testing."""
    sig_basestring = f"v0:{timestamp}:{body.decode('utf-8')}"
    computed_sig = "v0=" + hmac.new(
        secret.encode(),
        sig_basestring.encode(),
        hashlib.sha256,
    ).hexdigest()
    return computed_sig


# =============================================================================
# Slack Signature Verification Tests
# =============================================================================


class TestSlackSignatureVerification:
    """Tests for Slack signature verification."""

    @pytest.mark.asyncio
    async def test_verify_valid_signature(self, slack_signing_secret):
        """Test verification of valid signature."""
        from src.connectors.webhooks.router import _verify_slack_signature

        body = b'{"type":"url_verification"}'
        timestamp = str(int(time.time()))
        signature = create_slack_signature(body, slack_signing_secret, timestamp)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            result = await _verify_slack_signature(body, signature, timestamp)
            assert result is True

    @pytest.mark.asyncio
    async def test_verify_invalid_signature(self, slack_signing_secret):
        """Test rejection of invalid signature."""
        from src.connectors.webhooks.router import _verify_slack_signature

        body = b'{"type":"url_verification"}'
        timestamp = str(int(time.time()))
        invalid_signature = "v0=invalid_signature_hash"

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            result = await _verify_slack_signature(body, invalid_signature, timestamp)
            assert result is False

    @pytest.mark.asyncio
    async def test_verify_missing_signature(self):
        """Test rejection when signature missing."""
        from src.connectors.webhooks.router import _verify_slack_signature

        body = b'{"type":"url_verification"}'
        timestamp = str(int(time.time()))

        result = await _verify_slack_signature(body, None, timestamp)
        assert result is False

    @pytest.mark.asyncio
    async def test_verify_missing_timestamp(self):
        """Test rejection when timestamp missing."""
        from src.connectors.webhooks.router import _verify_slack_signature

        body = b'{"type":"url_verification"}'
        signature = "v0=somesignature"

        result = await _verify_slack_signature(body, signature, None)
        assert result is False

    @pytest.mark.asyncio
    async def test_verify_stale_timestamp(self, slack_signing_secret):
        """Test rejection of stale timestamp (replay attack prevention)."""
        from src.connectors.webhooks.router import _verify_slack_signature

        body = b'{"type":"url_verification"}'
        old_timestamp = str(int(time.time()) - 600)  # 10 minutes old
        signature = create_slack_signature(body, slack_signing_secret, old_timestamp)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            result = await _verify_slack_signature(body, signature, old_timestamp)
            assert result is False

    @pytest.mark.asyncio
    async def test_verify_no_secret_configured(self):
        """Test allowing requests when secret not configured (dev mode)."""
        from src.connectors.webhooks.router import _verify_slack_signature

        body = b'{"type":"url_verification"}'
        timestamp = str(int(time.time()))
        signature = "v0=anysignature"

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(slack_signing_secret=None)

            result = await _verify_slack_signature(body, signature, timestamp)
            assert result is True  # Allow in dev mode


# =============================================================================
# Slack Webhook Endpoint Tests
# =============================================================================


class TestSlackWebhookEndpoint:
    """Tests for Slack webhook endpoint."""

    @pytest.mark.asyncio
    async def test_url_verification_challenge(
        self, slack_signing_secret, slack_url_verification
    ):
        """Test handling URL verification challenge."""
        from src.connectors.webhooks.router import slack_webhook

        body = json.dumps(slack_url_verification).encode()
        timestamp = str(int(time.time()))
        signature = create_slack_signature(body, slack_signing_secret, timestamp)

        mock_request = MagicMock()
        mock_request.body = AsyncMock(return_value=body)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            response = await slack_webhook(
                request=mock_request,
                x_slack_signature=signature,
                x_slack_request_timestamp=timestamp,
            )

            assert response["challenge"] == "challenge_string_123"

    @pytest.mark.asyncio
    async def test_event_callback(
        self, slack_signing_secret, valid_slack_message_event
    ):
        """Test handling event callback."""
        from src.connectors.webhooks.router import slack_webhook

        body = json.dumps(valid_slack_message_event).encode()
        timestamp = str(int(time.time()))
        signature = create_slack_signature(body, slack_signing_secret, timestamp)

        mock_request = MagicMock()
        mock_request.body = AsyncMock(return_value=body)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            with patch("src.connectors.webhooks.router._queue_slack_event") as mock_queue:
                mock_queue.return_value = None

                response = await slack_webhook(
                    request=mock_request,
                    x_slack_signature=signature,
                    x_slack_request_timestamp=timestamp,
                )

                assert response["ok"] is True
                mock_queue.assert_called_once()

    @pytest.mark.asyncio
    async def test_invalid_signature_rejected(self, slack_signing_secret):
        """Test rejection of invalid signature."""
        from src.connectors.webhooks.router import slack_webhook

        body = b'{"type":"event_callback"}'
        timestamp = str(int(time.time()))
        invalid_signature = "v0=invalid"

        mock_request = MagicMock()
        mock_request.body = AsyncMock(return_value=body)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            with pytest.raises(HTTPException) as exc_info:
                await slack_webhook(
                    request=mock_request,
                    x_slack_signature=invalid_signature,
                    x_slack_request_timestamp=timestamp,
                )

            assert exc_info.value.status_code == 401


# =============================================================================
# Gmail Webhook Endpoint Tests
# =============================================================================


class TestGmailWebhookEndpoint:
    """Tests for Gmail webhook endpoint."""

    @pytest.mark.asyncio
    async def test_gmail_push_notification(self, gmail_push_notification):
        """Test handling Gmail push notification."""
        from src.connectors.webhooks.router import gmail_webhook

        mock_request = MagicMock()
        mock_request.json = AsyncMock(return_value=gmail_push_notification)

        with patch(
            "src.connectors.webhooks.router._queue_gmail_notification"
        ) as mock_queue:
            mock_queue.return_value = None

            response = await gmail_webhook(mock_request)

            assert response["ok"] is True
            mock_queue.assert_called_once()

    @pytest.mark.asyncio
    async def test_gmail_empty_notification(self):
        """Test handling empty notification."""
        from src.connectors.webhooks.router import gmail_webhook

        mock_request = MagicMock()
        mock_request.json = AsyncMock(return_value={"message": {}})

        response = await gmail_webhook(mock_request)
        assert response["ok"] is True


# =============================================================================
# Event Types Tests
# =============================================================================


class TestEventTypes:
    """Tests for different Slack event types."""

    @pytest.mark.asyncio
    async def test_message_event(self, slack_signing_secret):
        """Test handling message event."""
        event = {
            "type": "event_callback",
            "event": {
                "type": "message",
                "channel": "C123",
                "user": "U123",
                "text": "Test message",
            },
        }

        body = json.dumps(event).encode()
        timestamp = str(int(time.time()))
        signature = create_slack_signature(body, slack_signing_secret, timestamp)

        from src.connectors.webhooks.router import slack_webhook

        mock_request = MagicMock()
        mock_request.body = AsyncMock(return_value=body)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            with patch("src.connectors.webhooks.router._queue_slack_event") as mock_queue:
                await slack_webhook(
                    request=mock_request,
                    x_slack_signature=signature,
                    x_slack_request_timestamp=timestamp,
                )

                # Verify event was queued
                call_args = mock_queue.call_args[0][0]
                assert call_args["event"]["type"] == "message"

    @pytest.mark.asyncio
    async def test_reaction_event(self, slack_signing_secret):
        """Test handling reaction event."""
        event = {
            "type": "event_callback",
            "event": {
                "type": "reaction_added",
                "user": "U123",
                "reaction": "thumbsup",
                "item": {"type": "message", "channel": "C123", "ts": "123.456"},
            },
        }

        body = json.dumps(event).encode()
        timestamp = str(int(time.time()))
        signature = create_slack_signature(body, slack_signing_secret, timestamp)

        from src.connectors.webhooks.router import slack_webhook

        mock_request = MagicMock()
        mock_request.body = AsyncMock(return_value=body)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            with patch("src.connectors.webhooks.router._queue_slack_event") as mock_queue:
                await slack_webhook(
                    request=mock_request,
                    x_slack_signature=signature,
                    x_slack_request_timestamp=timestamp,
                )

                call_args = mock_queue.call_args[0][0]
                assert call_args["event"]["type"] == "reaction_added"


# =============================================================================
# Queue Tests
# =============================================================================


class TestQueueFunctions:
    """Tests for event queueing functions."""

    @pytest.mark.asyncio
    async def test_queue_slack_event(self, valid_slack_message_event):
        """Test queueing Slack event for processing."""
        from src.connectors.webhooks.router import _queue_slack_event

        with patch(
            "src.connectors.webhooks.handlers.slack.SlackWebhookHandler"
        ) as mock_handler_class:
            mock_handler = MagicMock()
            mock_handler.handle_event = AsyncMock()
            mock_handler_class.return_value = mock_handler

            await _queue_slack_event(valid_slack_message_event)

            mock_handler.handle_event.assert_called_once_with(valid_slack_message_event)


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Tests for error handling in webhooks."""

    @pytest.mark.asyncio
    async def test_malformed_json(self, slack_signing_secret):
        """Test handling of malformed JSON."""
        from src.connectors.webhooks.router import slack_webhook

        body = b"not valid json"
        timestamp = str(int(time.time()))
        signature = create_slack_signature(body, slack_signing_secret, timestamp)

        mock_request = MagicMock()
        mock_request.body = AsyncMock(return_value=body)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            with pytest.raises(json.JSONDecodeError):
                await slack_webhook(
                    request=mock_request,
                    x_slack_signature=signature,
                    x_slack_request_timestamp=timestamp,
                )

    @pytest.mark.asyncio
    async def test_unknown_event_type(self, slack_signing_secret):
        """Test handling of unknown event type."""
        event = {
            "type": "unknown_type",
        }

        body = json.dumps(event).encode()
        timestamp = str(int(time.time()))
        signature = create_slack_signature(body, slack_signing_secret, timestamp)

        from src.connectors.webhooks.router import slack_webhook

        mock_request = MagicMock()
        mock_request.body = AsyncMock(return_value=body)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            response = await slack_webhook(
                request=mock_request,
                x_slack_signature=signature,
                x_slack_request_timestamp=timestamp,
            )

            # Should return ok even for unknown types
            assert response["ok"] is True


# =============================================================================
# Security Tests
# =============================================================================


class TestSecurity:
    """Security-related tests for webhooks."""

    @pytest.mark.asyncio
    async def test_replay_attack_prevention(self, slack_signing_secret):
        """Test that old timestamps are rejected."""
        from src.connectors.webhooks.router import _verify_slack_signature

        body = b'{"type":"event_callback"}'
        old_timestamp = str(int(time.time()) - 400)  # Over 5 minutes old
        signature = create_slack_signature(body, slack_signing_secret, old_timestamp)

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            result = await _verify_slack_signature(body, signature, old_timestamp)
            assert result is False

    @pytest.mark.asyncio
    async def test_timestamp_format_validation(self, slack_signing_secret):
        """Test that invalid timestamp format is rejected."""
        from src.connectors.webhooks.router import _verify_slack_signature

        body = b'{"type":"event_callback"}'
        invalid_timestamp = "not_a_number"
        signature = "v0=somesignature"

        with patch("src.config.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(
                slack_signing_secret=slack_signing_secret
            )

            result = await _verify_slack_signature(body, signature, invalid_timestamp)
            assert result is False
