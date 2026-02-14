from __future__ import annotations

import io
import json

import pytest

from src.agentos.work_products.models import WorkProductGenerateRequest
from src.agentos.work_products.renderers import render_work_product


def _request(
    *,
    product_type: str,
    input_payload: dict | None = None,
    evidence_refs: list[str] | None = None,
) -> WorkProductGenerateRequest:
    return WorkProductGenerateRequest(
        organization_id="org_test",
        run_id="agrun_test",
        product_type=product_type,  # type: ignore[arg-type]
        title="Quarterly Output",
        instructions="Generate the requested artifact",
        input_payload=input_payload or {},
        evidence_refs=evidence_refs or [],
    )


def test_render_email_includes_evidence_markers() -> None:
    rendered = render_work_product(
        _request(
            product_type="email",
            input_payload={
                "subject": "Renewal update",
                "body_lines": ["Pipeline remains healthy", "Next step is legal review"],
            },
            evidence_refs=["evh_1", "evh_2"],
        )
    )

    assert rendered.product_type == "email"
    assert rendered.mime_type == "text/html"
    assert "[EVIDENCE:evh_1]" in rendered.text_content
    assert "Renewal update" in rendered.output_payload["subject"]


def test_render_sheet_contains_rows_and_evidence_row() -> None:
    openpyxl = pytest.importorskip("openpyxl")

    rendered = render_work_product(
        _request(
            product_type="sheet",
            input_payload={
                "rows": [
                    {"account": "Acme", "risk": "low"},
                    {"account": "Globex", "risk": "high"},
                ]
            },
            evidence_refs=["evh_sheet"],
        )
    )

    workbook = openpyxl.load_workbook(io.BytesIO(rendered.content_bytes))
    sheet = workbook.active
    assert sheet["A1"].value == "account"
    assert sheet["B2"].value == "low"
    assert "evh_sheet" in str(sheet["B5"].value)


def test_render_slides_includes_sections_and_citations() -> None:
    pptx = pytest.importorskip("pptx")

    rendered = render_work_product(
        _request(
            product_type="slides",
            input_payload={
                "sections": ["KPI Summary", "Risks & Mitigations"],
            },
            evidence_refs=["evh_slide_1"],
        )
    )

    presentation = pptx.Presentation(io.BytesIO(rendered.content_bytes))
    assert len(presentation.slides) == 3
    slides = list(presentation.slides)
    body_text = "\n".join(
        shape.text
        for slide in slides[1:]
        for shape in slide.shapes
        if hasattr(shape, "text")
    )
    assert "KPI Summary" in body_text
    assert "[EVIDENCE:evh_slide_1]" in body_text


def test_render_doc_includes_citation_section() -> None:
    docx = pytest.importorskip("docx")

    rendered = render_work_product(
        _request(
            product_type="doc",
            input_payload={
                "sections": ["Timeline", "Risk register"],
                "section_bodies": {"Timeline": "All follow-ups sent before deadline."},
            },
            evidence_refs=["evh_doc_1"],
        )
    )

    document = docx.Document(io.BytesIO(rendered.content_bytes))
    text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    assert "Timeline" in text
    assert "[EVIDENCE:evh_doc_1]" in text


def test_render_ticket_and_api_action_are_json() -> None:
    ticket_rendered = render_work_product(
        _request(
            product_type="ticket",
            input_payload={"labels": ["urgent"], "priority": "high"},
            evidence_refs=["evh_ticket"],
        )
    )
    ticket_payload = json.loads(ticket_rendered.content_bytes.decode("utf-8"))
    assert ticket_payload["priority"] == "high"
    assert ticket_payload["labels"] == ["urgent"]

    api_rendered = render_work_product(
        _request(
            product_type="api_action",
            input_payload={"method": "PATCH", "endpoint": "https://example.com/api"},
            evidence_refs=["evh_api"],
        )
    )
    api_payload = json.loads(api_rendered.content_bytes.decode("utf-8"))
    assert api_payload["method"] == "PATCH"
    assert api_payload["endpoint"] == "https://example.com/api"
