"""
API tests for Alertmanager webhook receiver.

These tests validate that:
- the webhook is protected by a token
- payloads are accepted and forwarded to Slack/Email when configured
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest


pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _settings(**overrides):
    defaults = dict(
        environment="test",
        monitoring_alert_webhook_token=None,
        monitoring_alert_email_to=None,
        monitoring_alert_slack_webhook_url=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class TestAlertmanagerWebhook:
    async def test_rejects_missing_token(self, async_client_no_auth):
        with patch("src.api.routes.monitoring.get_settings", return_value=_settings()):
            response = await async_client_no_auth.post(
                "/api/v1/monitoring/alerts/webhook",
                json={"status": "firing", "alerts": []},
            )

        assert response.status_code == 401

    async def test_accepts_dev_token_in_non_prod(self, async_client_no_auth):
        with patch("src.api.routes.monitoring.get_settings", return_value=_settings(environment="test")):
            response = await async_client_no_auth.post(
                "/api/v1/monitoring/alerts/webhook",
                params={"token": "dev"},
                json={"status": "firing", "alerts": []},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["alerts"] == 0

    async def test_forwarding_flags(self, async_client_no_auth):
        settings = _settings(
            monitoring_alert_webhook_token="t0k3n",
            monitoring_alert_email_to="ops@drovi.co",
            monitoring_alert_slack_webhook_url="https://hooks.slack.test/abc",
        )

        payload = {
            "status": "firing",
            "commonLabels": {"alertname": "DroviHighErrorRate"},
            "alerts": [
                {
                    "status": "firing",
                    "labels": {"alertname": "DroviHighErrorRate", "severity": "critical"},
                    "annotations": {"summary": "High 5xx error rate", "description": "Error rate > 5%"},
                    "startsAt": "2026-02-08T00:00:00Z",
                    "endsAt": "0001-01-01T00:00:00Z",
                }
            ],
        }

        with patch("src.api.routes.monitoring.get_settings", return_value=settings):
            with patch("src.api.routes.monitoring._post_slack_webhook", AsyncMock(return_value=True)):
                with patch("src.api.routes.monitoring.send_resend_email", AsyncMock(return_value=True)):
                    response = await async_client_no_auth.post(
                        "/api/v1/monitoring/alerts/webhook",
                        params={"token": "t0k3n"},
                        json=payload,
                    )

        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["alerts"] == 1
        assert data["slack_ok"] is True
        assert data["email_ok"] is True

