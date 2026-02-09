import pytest

from src.documents.processor import guess_file_type, parse_document_bytes


pytestmark = [pytest.mark.unit]


def test_guess_file_type_prefers_extension() -> None:
    assert guess_file_type("file.PDF", None) == "pdf"
    assert guess_file_type("memo.docx", "application/octet-stream") == "docx"
    assert guess_file_type("notes.txt", None) == "txt"
    assert guess_file_type("readme.md", None) == "markdown"
    assert guess_file_type("data.csv", None) == "csv"


@pytest.mark.asyncio
async def test_parse_document_bytes_txt_produces_single_chunk_with_layout() -> None:
    file_type, page_count, chunks, meta = await parse_document_bytes(
        file_name="notes.txt",
        mime_type="text/plain",
        data=b"Hello world\nSecond line\n",
    )

    assert file_type == "txt"
    assert page_count is None
    assert isinstance(meta, dict)
    assert len(chunks) == 1
    assert "Hello world" in chunks[0].text
    assert isinstance(chunks[0].layout_blocks, list)
    # Line layout should produce anchors for citations even without bounding boxes.
    assert len(chunks[0].layout_blocks) >= 1
