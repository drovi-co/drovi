from __future__ import annotations

from src.agentos.starter_packs.registry import get_starter_pack, list_starter_packs


def test_registry_contains_expected_templates() -> None:
    templates = list_starter_packs()
    keys = {template.key for template in templates}

    assert len(templates) == 9
    assert keys == {
        "sales_sdr",
        "sales_revops",
        "sales_renewal_risk",
        "hr_recruiting",
        "hr_onboarding",
        "hr_policy_drift",
        "legal_advice_timeline",
        "legal_contradiction",
        "accounting_filing_missing_docs",
    }


def test_template_definitions_expose_eval_suite_and_trigger_specs() -> None:
    template = get_starter_pack("legal_advice_timeline")
    assert template.eval_suite.suite_name == "legal.advice_timeline.baseline.v1"
    assert len(template.eval_suite.metrics) == 3
    assert len(template.trigger_specs) >= 1
