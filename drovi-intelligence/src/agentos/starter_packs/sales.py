from __future__ import annotations

from .models import (
    StarterPackEvalMetricSpec,
    StarterPackEvalSuiteSpec,
    StarterPackTemplateSpec,
)


SALES_TEMPLATES: list[StarterPackTemplateSpec] = [
    StarterPackTemplateSpec(
        key="sales_sdr",
        name="Sales SDR Agent",
        summary="Prospect monitoring, outreach drafting, and CRM follow-up with evidence-backed messaging.",
        domain="sales",
        role_key="sales.sdr",
        role_name="Sales SDR Agent",
        role_description="Runs outbound and inbound lead qualification while preserving context from recent interactions.",
        profile_name="SDR Default Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["email", "slack"],
            "data_domains": ["crm", "calendar", "messages"],
            "max_actions_per_run": 12,
        },
        tool_policy={
            "allow": ["crm.lookup", "crm.update", "email.draft", "email.send", "calendar.schedule"],
            "approval_required": ["email.send"],
            "deny": ["finance.payout", "admin.delete_user"],
        },
        model_policy={"reasoning_mode": "balanced", "temperature": 0.2},
        playbook_name="SDR Outreach Playbook",
        objective="Increase qualified meeting volume by personalizing outreach from real account context.",
        constraints={
            "require_evidence": True,
            "max_daily_outbound_messages": 50,
            "exclude_domains": ["competitor.com"],
        },
        sop={
            "steps": [
                "Detect new leads and stale leads from CRM",
                "Retrieve last interactions and objections",
                "Draft personalized outreach with explicit evidence links",
                "Queue send action for approval when external commit is required",
                "Update CRM stage and notes after send",
            ]
        },
        success_criteria={"qualified_meetings_per_week": 8, "reply_rate": 0.15, "crm_update_latency_minutes": 30},
        escalation_policy={
            "on_no_reply_days": 10,
            "escalate_to_role": "sales.ae",
            "notify_channel": "#sales-ops",
        },
        dsl={"intent": "outbound_sales", "handoff_targets": ["sales.ae"]},
        trigger_specs=[
            {"trigger_type": "event", "trigger_spec": {"event_name": "crm.lead.created"}},
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 */2 * * *"}},
        ],
        default_work_product_type="email",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="sales.sdr.baseline.v1",
            summary="Quality and throughput checks for SDR automation.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="run_success_rate",
                    description="Completed runs / total runs in the trailing window.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="evidence_link_rate",
                    description="Generated deliverables that include linked evidence artifacts.",
                    comparator="gte",
                    threshold=0.85,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="approval_backlog",
                    description="Pending approvals that are older than SLA.",
                    comparator="lte",
                    threshold=5,
                ),
            ],
        ),
    ),
    StarterPackTemplateSpec(
        key="sales_revops",
        name="RevOps Hygiene Agent",
        summary="Finds CRM hygiene drift, normalizes stages, and enforces data quality SLAs.",
        domain="sales",
        role_key="sales.revops_hygiene",
        role_name="RevOps Hygiene Agent",
        role_description="Maintains CRM integrity and surfaces field completeness issues by team.",
        profile_name="RevOps Hygiene Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["slack"],
            "data_domains": ["crm", "analytics"],
            "max_actions_per_run": 25,
        },
        tool_policy={
            "allow": ["crm.lookup", "crm.bulk_patch", "analytics.query", "ticket.create"],
            "approval_required": ["crm.bulk_patch"],
            "deny": ["email.send"],
        },
        model_policy={"reasoning_mode": "deterministic", "temperature": 0.0},
        playbook_name="RevOps Hygiene Playbook",
        objective="Keep pipeline data trustworthy by correcting stale records and escalating systemic drift.",
        constraints={
            "max_bulk_mutations_per_run": 100,
            "require_double_check_for_owner_changes": True,
            "require_evidence": True,
        },
        sop={
            "steps": [
                "Scan records updated in last 14 days for field gaps",
                "Classify issues by severity and ownership",
                "Patch low-risk fields automatically",
                "Open tickets for high-risk or ambiguous records",
                "Publish daily hygiene scorecard",
            ]
        },
        success_criteria={"field_completeness_rate": 0.95, "mean_time_to_fix_hours": 24, "false_fix_rate": 0.02},
        escalation_policy={"notify_channel": "#revenue-ops", "escalate_after_failures": 3},
        dsl={"intent": "crm_hygiene", "reporting_surface": "revops_dashboard"},
        trigger_specs=[
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 6 * * *"}},
        ],
        default_work_product_type="sheet",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="sales.revops.baseline.v1",
            summary="Data quality, corrective throughput, and safety checks.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="run_success_rate",
                    description="Completed runs / total runs in the trailing window.",
                    comparator="gte",
                    threshold=0.92,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="approval_backlog",
                    description="Pending high-risk corrective actions older than SLA.",
                    comparator="lte",
                    threshold=4,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="work_product_delivery_rate",
                    description="Successfully delivered scorecards and issue packets.",
                    comparator="gte",
                    threshold=0.9,
                ),
            ],
        ),
    ),
    StarterPackTemplateSpec(
        key="sales_renewal_risk",
        name="Renewal Risk Agent",
        summary="Scores renewal accounts for churn risk and drives escalation workflows.",
        domain="sales",
        role_key="sales.renewal_risk",
        role_name="Renewal Risk Agent",
        role_description="Monitors signals across communications, commitments, and account health to flag churn risk.",
        profile_name="Renewal Risk Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["email", "slack"],
            "data_domains": ["crm", "messages", "billing"],
            "max_actions_per_run": 10,
        },
        tool_policy={
            "allow": ["crm.lookup", "crm.update", "email.draft", "ticket.create", "analytics.query"],
            "approval_required": ["email.send"],
            "deny": ["billing.refund"],
        },
        model_policy={"reasoning_mode": "balanced", "temperature": 0.1},
        playbook_name="Renewal Risk Playbook",
        objective="Detect at-risk renewals early and trigger action plans with concrete evidence.",
        constraints={"risk_threshold": 0.7, "require_evidence": True, "max_escalations_per_day": 20},
        sop={
            "steps": [
                "Aggregate health signals and unresolved commitments",
                "Score account risk with confidence explanations",
                "Draft stakeholder update with evidence snippets",
                "Open follow-up tasks for owners",
                "Track resolution progress until risk declines",
            ]
        },
        success_criteria={"high_risk_accounts_reviewed_within_hours": 4, "false_positive_rate": 0.1},
        escalation_policy={"notify_channel": "#renewals", "escalate_to_role": "sales.cs_lead"},
        dsl={"intent": "renewal_risk_management", "risk_score_model": "v1"},
        trigger_specs=[
            {"trigger_type": "event", "trigger_spec": {"event_name": "crm.renewal_window.entered"}},
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 */6 * * *"}},
        ],
        default_work_product_type="doc",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="sales.renewal_risk.baseline.v1",
            summary="Risk-detection reliability and execution readiness checks.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="run_success_rate",
                    description="Completed runs / total runs in the trailing window.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="evidence_link_rate",
                    description="Risk reports with evidence-backed claims.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="work_product_delivery_rate",
                    description="Delivered risk briefs and escalations.",
                    comparator="gte",
                    threshold=0.88,
                ),
            ],
        ),
    ),
]
