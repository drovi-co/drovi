from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


TemplateDomain = Literal["sales", "hr", "legal", "accounting"]
TemplateGroup = Literal[
    "sales_sdr",
    "sales_revops",
    "sales_renewal_risk",
    "hr_recruiting",
    "hr_onboarding",
    "hr_policy_drift",
    "legal_advice_timeline",
    "legal_contradiction",
    "accounting_filing_missing_docs",
]
Comparator = Literal["gte", "lte"]


class StarterPackEvalMetricSpec(BaseModel):
    metric_name: str
    description: str
    comparator: Comparator
    threshold: float


class StarterPackEvalSuiteSpec(BaseModel):
    suite_name: str
    summary: str
    metrics: list[StarterPackEvalMetricSpec] = Field(default_factory=list)


class StarterPackTemplateSpec(BaseModel):
    key: TemplateGroup
    name: str
    summary: str
    domain: TemplateDomain
    role_key: str
    role_name: str
    role_description: str
    profile_name: str
    autonomy_tier: Literal["L1", "L2", "L3", "L4"] = "L2"
    permission_scope: dict[str, Any] = Field(default_factory=dict)
    tool_policy: dict[str, Any] = Field(default_factory=dict)
    model_policy: dict[str, Any] = Field(default_factory=dict)
    playbook_name: str
    objective: str
    constraints: dict[str, Any] = Field(default_factory=dict)
    sop: dict[str, Any] = Field(default_factory=dict)
    success_criteria: dict[str, Any] = Field(default_factory=dict)
    escalation_policy: dict[str, Any] = Field(default_factory=dict)
    dsl: dict[str, Any] = Field(default_factory=dict)
    trigger_specs: list[dict[str, Any]] = Field(default_factory=list)
    default_work_product_type: Literal["email", "sheet", "slides", "doc", "ticket", "api_action"] = "doc"
    eval_suite: StarterPackEvalSuiteSpec


class StarterPackTemplateModel(BaseModel):
    key: TemplateGroup
    name: str
    summary: str
    domain: TemplateDomain
    role_key: str
    autonomy_tier: str
    default_work_product_type: str
    eval_suite: StarterPackEvalSuiteSpec
    installed: bool = False
    installed_deployment_id: str | None = None
    installed_role_id: str | None = None


class StarterPackInstallResponse(BaseModel):
    template_key: TemplateGroup
    organization_id: str
    role_id: str
    profile_id: str
    playbook_id: str
    deployment_id: str
    created: dict[str, bool] = Field(default_factory=dict)


class StarterPackEvalMetricResult(BaseModel):
    metric_name: str
    metric_value: float
    threshold: float
    comparator: Comparator
    passed: bool
    description: str


class StarterPackEvalRunResponse(BaseModel):
    template_key: TemplateGroup
    organization_id: str
    deployment_id: str
    suite_name: str
    passed: bool
    metrics: list[StarterPackEvalMetricResult] = Field(default_factory=list)


class StarterPackSeedDemoResponse(BaseModel):
    organization_id: str
    seeded_templates: list[TemplateGroup] = Field(default_factory=list)
    created_runs: int = 0
    created_work_products: int = 0
    created_eval_results: int = 0
