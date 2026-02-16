from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.kernel.errors import NotFoundError, ValidationError
from src.plugins.accounting import AccountingPlugin
from src.plugins.contracts import ExtensionTypeSpec
from src.plugins.extensions import upsert_uio_extension
from src.plugins.legal import LegalPlugin


def test_legal_payload_validation_happy_path() -> None:
    plugin = LegalPlugin()
    payload = plugin.validate_extension_payload(
        type_name="legal.matter",
        payload={"client_name": "Acme Corp", "status": "open"},
    )
    assert payload["client_name"] == "Acme Corp"
    assert payload["status"] == "open"


def test_legal_payload_validation_rejects_invalid_shape() -> None:
    plugin = LegalPlugin()
    with pytest.raises(ValidationError) as exc:
        plugin.validate_extension_payload(
            type_name="legal.matter",
            payload={"status": "open"},  # missing client_name
        )
    assert exc.value.code == "extension.payload_invalid"


def test_accounting_payload_validation_happy_path() -> None:
    plugin = AccountingPlugin()
    payload = plugin.validate_extension_payload(
        type_name="accounting.filing_deadline",
        payload={
            "client_name": "Beta LLC",
            "filing_type": "Tax Return",
            "due_at": "2026-03-31T17:00:00Z",
        },
    )
    assert payload["client_name"] == "Beta LLC"
    assert payload["filing_type"] == "Tax Return"


@pytest.mark.asyncio
async def test_upsert_extension_persists_and_updates_typed_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    plugin = MagicMock()
    plugin.plugin_id = "legal"
    plugin.upsert_typed_extension = AsyncMock()

    spec = ExtensionTypeSpec(
        type="legal.matter",
        schema_version="1.0",
        typed_table="legal_matter",
    )

    class FakeRegistry:
        def validate_extension_payload(self, *, type_name: str, payload: dict):
            return plugin, spec, payload

    monkeypatch.setattr("src.plugins.extensions.get_plugin_registry", lambda: FakeRegistry())

    session = AsyncMock()
    exists_result = MagicMock()
    exists_result.fetchone.return_value = SimpleNamespace(id="uio_1")
    insert_result = MagicMock()
    session.execute = AsyncMock(side_effect=[exists_result, insert_result])

    result = await upsert_uio_extension(
        session=session,
        organization_id="org_test",
        uio_id="uio_1",
        type_name="legal.matter",
        payload={"client_name": "Acme"},
    )

    assert result.plugin_id == "legal"
    assert result.typed_table == "legal_matter"
    assert session.execute.await_count == 2
    plugin.upsert_typed_extension.assert_awaited_once()


@pytest.mark.asyncio
async def test_upsert_extension_requires_existing_uio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    plugin = MagicMock()
    plugin.plugin_id = "legal"
    plugin.upsert_typed_extension = AsyncMock()

    spec = ExtensionTypeSpec(
        type="legal.matter",
        schema_version="1.0",
        typed_table="legal_matter",
    )

    class FakeRegistry:
        def validate_extension_payload(self, *, type_name: str, payload: dict):
            return plugin, spec, payload

    monkeypatch.setattr("src.plugins.extensions.get_plugin_registry", lambda: FakeRegistry())

    session = AsyncMock()
    exists_result = MagicMock()
    exists_result.fetchone.return_value = None
    session.execute = AsyncMock(return_value=exists_result)

    with pytest.raises(NotFoundError) as exc:
        await upsert_uio_extension(
            session=session,
            organization_id="org_test",
            uio_id="uio_missing",
            type_name="legal.matter",
            payload={"client_name": "Acme"},
        )

    assert exc.value.code == "extension.uio_not_found"
    plugin.upsert_typed_extension.assert_not_called()

