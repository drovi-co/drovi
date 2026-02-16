from __future__ import annotations

from .models import (
    StarterPackEvalMetricSpec,
    StarterPackEvalSuiteSpec,
    StarterPackTemplateSpec,
)


HR_TEMPLATES: list[StarterPackTemplateSpec] = [
    StarterPackTemplateSpec(
        key="hr_recruiting",
        name="Recruiting Coordinator Agent",
        summary="Coordinates candidate flow, scheduling, and follow-ups with complete evidence trails.",
        domain="hr",
        role_key="hr.recruiting_coordinator",
        role_name="Recruiting Coordinator Agent",
        role_description="Orchestrates recruiting tasks across ATS, calendar, and communication channels.",
        profile_name="Recruiting Coordinator Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["email", "slack"],
            "data_domains": ["ats", "calendar", "messages"],
            "max_actions_per_run": 20,
        },
        tool_policy={
            "allow": ["calendar.schedule", "email.draft", "email.send", "ats.update", "ticket.create"],
            "approval_required": ["email.send"],
            "deny": ["hris.terminate_employee"],
        },
        model_policy={"reasoning_mode": "balanced", "temperature": 0.2},
        playbook_name="Recruiting Coordination Playbook",
        objective="Reduce hiring-cycle friction and no-shows while keeping candidate communication consistent.",
        constraints={
            "respect_business_hours": True,
            "require_evidence": True,
            "max_reschedule_attempts": 3,
        },
        sop={
            "steps": [
                "Monitor candidate stage transitions",
                "Propose interview slots based on panel availability",
                "Send candidate confirmations and reminders",
                "Escalate conflicts and no-shows to recruiter owner",
                "Publish weekly pipeline bottleneck report",
            ]
        },
        success_criteria={"interview_scheduling_sla_hours": 8, "no_show_rate": 0.05, "candidate_response_sla_hours": 24},
        escalation_policy={"notify_channel": "#talent-ops", "escalate_to_role": "hr.recruiter_lead"},
        dsl={"intent": "recruiting_coordination", "pipeline_system": "ats"},
        trigger_specs=[
            {"trigger_type": "event", "trigger_spec": {"event_name": "ats.stage.changed"}},
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 */3 * * *"}},
        ],
        default_work_product_type="email",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="hr.recruiting.baseline.v1",
            summary="Coordination SLA and communication quality checks.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="run_success_rate",
                    description="Completed runs / total runs in trailing window.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="work_product_delivery_rate",
                    description="Delivered candidate comms and reports.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="approval_backlog",
                    description="Pending outbound approvals older than SLA.",
                    comparator="lte",
                    threshold=6,
                ),
            ],
        ),
    ),
    StarterPackTemplateSpec(
        key="hr_onboarding",
        name="Onboarding Manager Agent",
        summary="Drives onboarding checklists, documentation completion, and cross-team reminders.",
        domain="hr",
        role_key="hr.onboarding_manager",
        role_name="Onboarding Manager Agent",
        role_description="Coordinates new-hire onboarding dependencies and tracks completion risk.",
        profile_name="Onboarding Manager Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["email", "slack"],
            "data_domains": ["hris", "ticketing", "documents"],
            "max_actions_per_run": 20,
        },
        tool_policy={
            "allow": ["ticket.create", "ticket.update", "email.draft", "email.send", "docs.link"],
            "approval_required": ["email.send"],
            "deny": ["payroll.change_bank_account"],
        },
        model_policy={"reasoning_mode": "deterministic", "temperature": 0.0},
        playbook_name="Onboarding Management Playbook",
        objective="Ensure every onboarding milestone is completed on schedule and evidence-backed.",
        constraints={"require_evidence": True, "max_overdue_days_before_escalation": 2},
        sop={
            "steps": [
                "Ingest new-hire event and expected onboarding checklist",
                "Track completion and overdue signals",
                "Trigger reminders for task owners",
                "Escalate blockers to people ops lead",
                "Publish onboarding health digest",
            ]
        },
        success_criteria={"onboarding_completion_rate": 0.95, "overdue_task_rate": 0.08},
        escalation_policy={"notify_channel": "#people-ops", "escalate_to_role": "hr.people_ops_lead"},
        dsl={"intent": "onboarding_orchestration"},
        trigger_specs=[
            {"trigger_type": "event", "trigger_spec": {"event_name": "hris.employee.hired"}},
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 9 * * 1-5"}},
        ],
        default_work_product_type="ticket",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="hr.onboarding.baseline.v1",
            summary="Completion health and escalation responsiveness checks.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="run_success_rate",
                    description="Completed runs / total runs in trailing window.",
                    comparator="gte",
                    threshold=0.92,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="work_product_delivery_rate",
                    description="Delivered onboarding artifacts and reminders.",
                    comparator="gte",
                    threshold=0.9,
                ),
                StarterPackEvalMetricSpec(
                    metric_name="evidence_link_rate",
                    description="Onboarding outputs linked to source evidence.",
                    comparator="gte",
                    threshold=0.88,
                ),
            ],
        ),
    ),
    StarterPackTemplateSpec(
        key="hr_policy_drift",
        name="Policy Q&A + Drift Agent",
        summary="Answers policy questions and flags policy drift between handbook, legal updates, and operations.",
        domain="hr",
        role_key="hr.policy_drift",
        role_name="Policy Q&A + Drift Agent",
        role_description="Maintains trust in HR policy answers and highlights contradictory or outdated guidance.",
        profile_name="Policy Drift Profile",
        autonomy_tier="L2",
        permission_scope={
            "channels": ["slack", "teams", "email"],
            "data_domains": ["documents", "messages", "policy"],
            "max_actions_per_run": 8,
        },
        tool_policy={
            "allow": ["docs.search", "message.reply", "ticket.create", "email.draft"],
            "approval_required": ["message.reply", "email.send"],
            "deny": ["hris.change_compensation"],
        },
        model_policy={"reasoning_mode": "balanced", "temperature": 0.1},
        playbook_name="Policy Drift Detection Playbook",
        objective="Provide policy guidance with exact citations and alert on drift before it causes compliance risk.",
        constraints={"require_evidence": True, "forbid_uncited_policy_claims": True},
        sop={
            "steps": [
                "Ingest policy Q&A requests and relevant policy corpus updates",
                "Retrieve top evidence snippets for each answer",
                "Detect contradictions between current and historical guidance",
                "Escalate unresolved drift to compliance owner",
                "Publish weekly drift report",
            ]
        },
        success_criteria={"uncited_answer_rate": 0.0, "drift_detection_precision": 0.85},
        escalation_policy={"notify_channel": "#policy-compliance", "escalate_to_role": "legal.compliance_counsel"},
        dsl={"intent": "policy_qa_drift_detection"},
        trigger_specs=[
            {"trigger_type": "event", "trigger_spec": {"event_name": "policy.document.updated"}},
            {"trigger_type": "schedule", "trigger_spec": {"cron": "0 */12 * * *"}},
        ],
        default_work_product_type="doc",
        eval_suite=StarterPackEvalSuiteSpec(
            suite_name="hr.policy_drift.baseline.v1",
            summary="Evidence fidelity and contradiction-detection checks.",
            metrics=[
                StarterPackEvalMetricSpec(
                    metric_name="evidence_link_rate",
                    description="Policy outputs containing verifiable evidence links.",
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
                    description="Pending policy responses waiting for approval older than SLA.",
                    comparator="lte",
                    threshold=3,
                ),
            ],
        ),
    ),
]
