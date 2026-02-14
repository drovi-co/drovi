from __future__ import annotations

from src.agentos.work_products.models import RenderedWorkProduct, WorkProductGenerateRequest
from src.agentos.work_products.verification import verify_work_product


def test_verify_doc_requires_citations_when_requested() -> None:
    request = WorkProductGenerateRequest(
        organization_id="org_test",
        run_id="agrun_test",
        product_type="doc",
        title="Advice timeline",
        require_citations=True,
        evidence_refs=["evh_a", "evh_b"],
    )
    rendered = RenderedWorkProduct(
        product_type="doc",
        title="Advice timeline",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension=".docx",
        content_bytes=b"doc-bytes",
        text_content="Advice changed in April without explicit citation",
        output_payload={},
    )

    result = verify_work_product(request=request, rendered=rendered)
    assert result.valid is False
    assert "missing evidence citation marker [EVIDENCE:evh_a]" in result.issues
    assert "missing evidence citation marker [EVIDENCE:evh_b]" in result.issues


def test_verify_doc_passes_when_all_citations_present() -> None:
    request = WorkProductGenerateRequest(
        organization_id="org_test",
        run_id="agrun_test",
        product_type="doc",
        title="Advice timeline",
        require_citations=True,
        evidence_refs=["evh_a"],
    )
    rendered = RenderedWorkProduct(
        product_type="doc",
        title="Advice timeline",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension=".docx",
        content_bytes=b"doc-bytes",
        text_content="Advice update [EVIDENCE:evh_a]",
        output_payload={},
    )

    result = verify_work_product(request=request, rendered=rendered)
    assert result.valid is True
    assert result.issues == []


def test_verify_email_requires_subject() -> None:
    request = WorkProductGenerateRequest(
        organization_id="org_test",
        run_id="agrun_test",
        product_type="email",
        title="Outbound",
    )
    rendered = RenderedWorkProduct(
        product_type="email",
        title="Outbound",
        mime_type="text/html",
        extension=".html",
        content_bytes=b"<p>Body</p>",
        text_content="Body",
        output_payload={"subject": ""},
    )

    result = verify_work_product(request=request, rendered=rendered)
    assert result.valid is False
    assert "email subject is empty" in result.issues
