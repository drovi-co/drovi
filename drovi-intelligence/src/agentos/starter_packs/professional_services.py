from __future__ import annotations

from .models import (
    StarterPackEvalMetricSpec,
    StarterPackEvalSuiteSpec,
    StarterPackTemplateSpec,
)


PROFESSIONAL_SERVICES_TEMPLATES: list[StarterPackTemplateSpec] = [
    StarterPackTemplateSpec(
        key="legal_advice_timeline",
        name="Advice Timeline Sentinel",
        summary="Builds an evidence-first timeline of legal advice and changes over time.",
        domain="legal",
        role_key="legal.advice_timeline_sentinel",
        role_name="Advice Timeline Sentinel",
        role_description="Produces matter-level advice history with exact wording and provenance links.",
        profile_name="Advice Timeline Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["email", "slack"],
            "data_domains": ["messages", "documents", "meetings"],
            "max_actions_per_run": 8,
        },
        tool_policy={
            "allow": ["docs.search", "timeline.build", "email.draft", "ticket.create"],
            "approval_required": ["email.send"],
            "deny": ["court.filing.submit"],
        },
        model_policy={"reasoning_mode": "deterministic", "temperature": 0.0},
        playbook_name="Legal Advice Timeline Playbook",
        objective="Provide a complete advice timeline with evidence links and change annotations.",
        constraints={"require_evidence": True, "forbid_uncited_advice": True},
        sop={
            "steps": [
                "Collect matter communications and legal memos",
                "Extract advice statements with quote spans",
                "Build bi-temporal advice timeline",
                "Highlight deltas and supersession events",
                "Produce partner-ready evidence report",
            ]
        },
        success_criteria={"citation_coverage": 1.0, "timeline_completeness_rate": 0.95},
        escalation_policy={"notify_channel": "#legal-risk", "escalate_to_role": "legal.partner"},
        dsl={"intent": "legal_advice_timeline", "ui_surface": "matter_timeline"},
        trigger_specs=[
            {"trigger_type": "event", "trigger_spec": {"event_name": "matter.document.added"}},
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 */8 * * *"}},
        ],
        default_work_product_type="doc",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="legal.advice_timeline.baseline.v1",
            summary="Timeline fidelity and citation integrity checks.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="evidence_link_rate",
                    description="Timeline outputs with explicit evidence link coverage.",
                    comparator="gte",
                    threshold=0.98,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="run_success_rate",
                    description="Completed runs / total runs in trailing window.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="work_product_delivery_rate",
                    description="Successfully delivered timeline packets to legal reviewers.",
                    comparator="gte",
                    threshold=0.9,
                ),
            ],
        ),
    ),
    StarterPackTemplateSpec(
        key="legal_contradiction",
        name="Contradiction Detection Agent",
        summary="Flags contradictory legal advice and drift from latest legal position.",
        domain="legal",
        role_key="legal.contradiction_detection",
        role_name="Contradiction Detection Agent",
        role_description="Scans legal corpora and communication history for contradictions and stale guidance.",
        profile_name="Contradiction Detection Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["email", "slack"],
            "data_domains": ["documents", "messages", "knowledge_graph"],
            "max_actions_per_run": 12,
        },
        tool_policy={
            "allow": ["docs.search", "graph.query", "risk.flag", "email.draft"],
            "approval_required": ["email.send"],
            "deny": ["court.filing.submit"],
        },
        model_policy={"reasoning_mode": "balanced", "temperature": 0.1},
        playbook_name="Legal Contradiction Radar Playbook",
        objective="Catch conflicting legal advice and silent drift before client impact.",
        constraints={"require_evidence": True, "min_confidence_for_alert": 0.75},
        sop={
            "steps": [
                "Extract current and historical advice claims",
                "Run contradiction and temporal consistency checks",
                "Score matter-level risk for unresolved contradictions",
                "Draft contradiction packet with citations",
                "Escalate high-severity conflicts",
            ]
        },
        success_criteria={"contradiction_precision": 0.85, "alert_sla_hours": 4},
        escalation_policy={"notify_channel": "#legal-contradictions", "escalate_to_role": "legal.partner"},
        dsl={"intent": "legal_contradiction_detection"},
        trigger_specs=[
            {"trigger_type": "event", "trigger_spec": {"event_name": "matter.advice.updated"}},
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 */6 * * *"}},
        ],
        default_work_product_type="doc",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="legal.contradiction.baseline.v1",
            summary="Contradiction quality and operational readiness checks.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="evidence_link_rate",
                    description="Contradiction alerts that include linked evidence.",
                    comparator="gte",
                    threshold=0.95,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="run_success_rate",
                    description="Completed runs / total runs in trailing window.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="approval_backlog",
                    description="Pending contradiction notifications older than SLA.",
                    comparator="lte",
                    threshold=4,
                ),
            ],
        ),
    ),
    StarterPackTemplateSpec(
        key="accounting_filing_missing_docs",
        name="Filing & Missing Docs Agent",
        summary="Tracks filing deadlines, identifies missing client docs, and drives follow-up execution.",
        domain="accounting",
        role_key="accounting.filing_missing_docs",
        role_name="Filing & Missing Docs Agent",
        role_description="Prevents filing delays by continuously reconciling obligations, due dates, and required evidence.",
        profile_name="Filing Missing Docs Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["email", "slack"],
            "data_domains": ["documents", "tasks", "deadlines"],
            "max_actions_per_run": 15,
        },
        tool_policy={
            "allow": ["docs.search", "deadline.track", "email.draft", "ticket.create", "sheet.generate"],
            "approval_required": ["email.send"],
            "deny": ["erp.payment.release"],
        },
        model_policy={"reasoning_mode": "deterministic", "temperature": 0.0},
        playbook_name="Accounting Filing Readiness Playbook",
        objective="Reduce missed filings by surfacing missing documents and unresolved obligations early.",
        constraints={"require_evidence": True, "max_followups_per_client_per_week": 3},
        sop={
            "steps": [
                "Ingest filing calendar and expected client deliverables",
                "Detect missing docs and overdue dependencies",
                "Generate follow-up queue by urgency",
                "Send client-ready reminder drafts with evidence references",
                "Publish filing readiness dashboard extract",
            ]
        },
        success_criteria={"missed_filing_rate": 0.01, "doc_collection_cycle_days": 5},
        escalation_policy={"notify_channel": "#filing-ops", "escalate_to_role": "accounting.partner"},
        dsl={"intent": "accounting_filing_readiness"},
        trigger_specs=[
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 7 * * 1-5"}},
            {"trigger_type": "event", "trigger_spec": {"event_name": "document.uploaded"}},
        ],
        default_work_product_type="sheet",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="accounting.filing_missing_docs.baseline.v1",
            summary="Deadline coverage and documentation completeness checks.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="run_success_rate",
                    description="Completed runs / total runs in trailing window.",
                    comparator="gte",
                    threshold=0.92,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="work_product_delivery_rate",
                    description="Delivered filing readiness reports and follow-up packs.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="evidence_link_rate",
                    description="Generated filing outputs linked to source artifacts.",
                    comparator="gte",
                    threshold=0.9,
                ),
            ],
        ),
    ),
]
