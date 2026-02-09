import pytest

from src.documents.storage import (
    build_document_object_key,
    build_document_page_object_key,
)


pytestmark = [pytest.mark.unit]


def test_build_document_object_key_content_addressed_and_sanitized() -> None:
    key = build_document_object_key(
        organization_id="org_test",
        sha256="a" * 64,
        file_name="../Client Folder/Weird   Name!!.PDF",
    )

    # Default prefix should be stable in tests (drovi-documents).
    assert key.startswith("drovi-documents/org_test/")
    # Preserves extension (lowercased) and does not include the original name.
    assert key.endswith(f"{'a' * 64}.pdf")
    # No path traversal.
    assert ".." not in key


def test_build_document_page_object_key_is_stable_and_padded() -> None:
    key = build_document_page_object_key(
        organization_id="org_test",
        document_sha256="b" * 64,
        page_index=3,
        image_sha256="c" * 64,
    )

    assert key == f"drovi-documents/org_test/{'b' * 64}/pages/0003-{'c' * 64}.png"

