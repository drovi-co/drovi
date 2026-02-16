from __future__ import annotations

from .models import RenderedWorkProduct, VerificationResult, WorkProductGenerateRequest


def verify_work_product(
    *,
    request: WorkProductGenerateRequest,
    rendered: RenderedWorkProduct,
) -> VerificationResult:
    issues: list[str] = []

    if not rendered.content_bytes:
        issues.append("rendered artifact is empty")

    text = rendered.text_content.strip()
    if not text:
        issues.append("rendered text content is empty")

    if rendered.product_type == "doc" and request.require_citations and request.evidence_refs:
        for evidence_id in request.evidence_refs:
            marker = f"[EVIDENCE:{evidence_id}]"
            if marker not in rendered.text_content:
                issues.append(f"missing evidence citation marker {marker}")

    if rendered.product_type == "email":
        subject = str(rendered.output_payload.get("subject") or "").strip()
        if not subject:
            issues.append("email subject is empty")

    checks = {
        "product_type": rendered.product_type,
        "byte_size": len(rendered.content_bytes),
        "text_length": len(rendered.text_content),
        "citation_count": rendered.text_content.count("[EVIDENCE:"),
    }
    return VerificationResult(valid=not issues, issues=issues, checks=checks)
