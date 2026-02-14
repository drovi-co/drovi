import type {
  ActionReceiptRecord,
  AgentCatalogItem,
  AgentChannelBindingRecord,
  AgentDeploymentCreateRequest,
  AgentDeploymentModel,
  AgentEvalCreateRequest,
  AgentEvalResultModel,
  AgentFeedbackCreateRequest,
  AgentFeedbackModel,
  AgentHandoffModel,
  AgentIdentityRecord,
  AgentInboxThreadRecord,
  AgentMessageEventRecord,
  AgentPlaybookCreateRequest,
  AgentPlaybookModel,
  AgentPlaybookUpdateRequest,
  AgentProfileCreateRequest,
  AgentProfileModel,
  AgentProfileUpdateRequest,
  AgentRoleCreateRequest,
  AgentRoleModel,
  AgentRoleUpdateRequest,
  AgentRunControlResponse,
  AgentRunCreateRequest,
  AgentRunModel,
  AgentRunReplayResponse,
  AgentTeamCreateRequest,
  AgentTeamMembersReplaceRequest,
  AgentTeamModel,
  AgentTeamRunDispatchRequest,
  AgentTeamRunDispatchResponse,
  AgentTeamUpdateRequest,
  AgentTriggerCreateRequest,
  AgentTriggerModel,
  AgentTriggerUpdateRequest,
  ApprovalDecisionRequest,
  ApprovalRequestRecord,
  CalibrationSnapshot,
  ChannelBindingUpsertRequest,
  ConfigLintRequest,
  ConfigLintResponse,
  DeploymentActionResponse,
  DeploymentSnapshotResponse,
  DesktopActionRequest,
  DesktopActionResponse,
  DesktopBridgeControlRequest,
  DesktopBridgeControlResponse,
  DesktopBridgeHealthRequest,
  DesktopBridgeHealthResponse,
  IdentityProvisionRequest,
  OfflineEvalRunRequest,
  OfflineEvalRunResult,
  PlaybookLintRequest,
  PlaybookLintResponse,
  QualityRecommendationRecord,
  QualityTrendResponse,
  RegressionGateCreateRequest,
  RegressionGateEvaluationResponse,
  RegressionGateRecord,
  RunQualityScoreRecord,
  StarterPackEvalRunRequest,
  StarterPackEvalRunResponse,
  StarterPackInstallRequest,
  StarterPackInstallResponse,
  StarterPackSeedDemoRequest,
  StarterPackSeedDemoResponse,
  StarterPackTemplateModel,
  TeamMemberSpec,
  ThreadReplyRequest,
  TriggerRouteDecision,
  TriggerSimulationRequest,
  WorkProductDeliveryRequest,
  WorkProductDeliveryResult,
  WorkProductGenerateRequest,
  WorkProductRecord,
} from "@memorystack/api-types";

import type { ApiClient } from "../http/client";

export function createAgentsApi(client: ApiClient) {
  return {
    async listRoles(organizationId: string): Promise<AgentRoleModel[]> {
      return client.requestJson<AgentRoleModel[]>("/agents/roles", {
        query: { organization_id: organizationId },
      });
    },

    async createRole(request: AgentRoleCreateRequest): Promise<AgentRoleModel> {
      return client.requestJson<AgentRoleModel>("/agents/roles", {
        method: "POST",
        body: request,
      });
    },

    async updateRole(
      roleId: string,
      request: AgentRoleUpdateRequest
    ): Promise<AgentRoleModel> {
      return client.requestJson<AgentRoleModel>(`/agents/roles/${roleId}`, {
        method: "PATCH",
        body: request,
      });
    },

    async deleteRole(
      roleId: string
    ): Promise<{ status: string; role_id: string }> {
      return client.requestJson<{ status: string; role_id: string }>(
        `/agents/roles/${roleId}`,
        { method: "DELETE" }
      );
    },

    async listProfiles(organizationId: string): Promise<AgentProfileModel[]> {
      return client.requestJson<AgentProfileModel[]>("/agents/profiles", {
        query: { organization_id: organizationId },
      });
    },

    async createProfile(
      request: AgentProfileCreateRequest
    ): Promise<AgentProfileModel> {
      return client.requestJson<AgentProfileModel>("/agents/profiles", {
        method: "POST",
        body: request,
      });
    },

    async updateProfile(
      profileId: string,
      request: AgentProfileUpdateRequest
    ): Promise<AgentProfileModel> {
      return client.requestJson<AgentProfileModel>(
        `/agents/profiles/${profileId}`,
        {
          method: "PATCH",
          body: request,
        }
      );
    },

    async deleteProfile(
      profileId: string
    ): Promise<{ status: string; profile_id: string }> {
      return client.requestJson<{ status: string; profile_id: string }>(
        `/agents/profiles/${profileId}`,
        {
          method: "DELETE",
        }
      );
    },

    async listPlaybooks(organizationId: string): Promise<AgentPlaybookModel[]> {
      return client.requestJson<AgentPlaybookModel[]>("/agents/playbooks", {
        query: { organization_id: organizationId },
      });
    },

    async createPlaybook(
      request: AgentPlaybookCreateRequest
    ): Promise<AgentPlaybookModel> {
      return client.requestJson<AgentPlaybookModel>("/agents/playbooks", {
        method: "POST",
        body: request,
      });
    },

    async updatePlaybook(
      playbookId: string,
      request: AgentPlaybookUpdateRequest
    ): Promise<AgentPlaybookModel> {
      return client.requestJson<AgentPlaybookModel>(
        `/agents/playbooks/${playbookId}`,
        {
          method: "PATCH",
          body: request,
        }
      );
    },

    async deletePlaybook(
      playbookId: string
    ): Promise<{ status: string; playbook_id: string }> {
      return client.requestJson<{ status: string; playbook_id: string }>(
        `/agents/playbooks/${playbookId}`,
        {
          method: "DELETE",
        }
      );
    },

    async lintPlaybook(
      request: PlaybookLintRequest
    ): Promise<PlaybookLintResponse> {
      return client.requestJson<PlaybookLintResponse>(
        "/agents/playbooks/lint",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async listDeployments(
      organizationId: string
    ): Promise<AgentDeploymentModel[]> {
      return client.requestJson<AgentDeploymentModel[]>("/agents/deployments", {
        query: { organization_id: organizationId },
      });
    },

    async createDeployment(
      request: AgentDeploymentCreateRequest
    ): Promise<AgentDeploymentModel> {
      return client.requestJson<AgentDeploymentModel>("/agents/deployments", {
        method: "POST",
        body: request,
      });
    },

    async promoteDeployment(params: {
      deploymentId: string;
      organizationId: string;
      version?: number | null;
    }): Promise<DeploymentActionResponse> {
      return client.requestJson<DeploymentActionResponse>(
        `/agents/deployments/${params.deploymentId}/promote`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            version: params.version ?? null,
          },
        }
      );
    },

    async rollbackDeployment(params: {
      deploymentId: string;
      organizationId: string;
      targetVersion?: number | null;
      reason?: string | null;
    }): Promise<DeploymentActionResponse> {
      return client.requestJson<DeploymentActionResponse>(
        `/agents/deployments/${params.deploymentId}/rollback`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            target_version: params.targetVersion ?? null,
            reason: params.reason ?? null,
          },
        }
      );
    },

    async getDeploymentSnapshot(params: {
      deploymentId: string;
      organizationId: string;
    }): Promise<DeploymentSnapshotResponse> {
      return client.requestJson<DeploymentSnapshotResponse>(
        `/agents/deployments/${params.deploymentId}/snapshot`,
        {
          query: { organization_id: params.organizationId },
        }
      );
    },

    async listCatalog(organizationId: string): Promise<AgentCatalogItem[]> {
      return client.requestJson<AgentCatalogItem[]>("/agents/catalog", {
        query: { organization_id: organizationId },
      });
    },

    async listStarterPacks(
      organizationId: string
    ): Promise<StarterPackTemplateModel[]> {
      return client.requestJson<StarterPackTemplateModel[]>(
        "/agents/starter-packs",
        {
          query: { organization_id: organizationId },
        }
      );
    },

    async installStarterPack(params: {
      templateKey:
        | "sales_sdr"
        | "sales_revops"
        | "sales_renewal_risk"
        | "hr_recruiting"
        | "hr_onboarding"
        | "hr_policy_drift"
        | "legal_advice_timeline"
        | "legal_contradiction"
        | "accounting_filing_missing_docs";
      request: StarterPackInstallRequest;
    }): Promise<StarterPackInstallResponse> {
      return client.requestJson<StarterPackInstallResponse>(
        `/agents/starter-packs/${params.templateKey}/install`,
        {
          method: "POST",
          body: params.request,
        }
      );
    },

    async runStarterPackEval(params: {
      templateKey:
        | "sales_sdr"
        | "sales_revops"
        | "sales_renewal_risk"
        | "hr_recruiting"
        | "hr_onboarding"
        | "hr_policy_drift"
        | "legal_advice_timeline"
        | "legal_contradiction"
        | "accounting_filing_missing_docs";
      request: StarterPackEvalRunRequest;
    }): Promise<StarterPackEvalRunResponse> {
      return client.requestJson<StarterPackEvalRunResponse>(
        `/agents/starter-packs/${params.templateKey}/evals/run`,
        {
          method: "POST",
          body: params.request,
        }
      );
    },

    async seedStarterPackDemo(
      request: StarterPackSeedDemoRequest
    ): Promise<StarterPackSeedDemoResponse> {
      return client.requestJson<StarterPackSeedDemoResponse>(
        "/agents/starter-packs/seed-demo",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async listRuns(params: {
      organizationId: string;
      deploymentId?: string | null;
      limit?: number;
      offset?: number;
    }): Promise<AgentRunModel[]> {
      return client.requestJson<AgentRunModel[]>("/agents/runs", {
        query: {
          organization_id: params.organizationId,
          deployment_id: params.deploymentId ?? undefined,
          limit: params.limit ?? 100,
          offset: params.offset ?? 0,
        },
      });
    },

    async createRun(request: AgentRunCreateRequest): Promise<AgentRunModel> {
      return client.requestJson<AgentRunModel>("/agents/runs", {
        method: "POST",
        body: request,
      });
    },

    async getRun(runId: string): Promise<AgentRunModel> {
      return client.requestJson<AgentRunModel>(`/agents/runs/${runId}`);
    },

    async listRunHandoffs(params: {
      runId: string;
      organizationId: string;
    }): Promise<AgentHandoffModel[]> {
      return client.requestJson<AgentHandoffModel[]>(
        `/agents/runs/${params.runId}/handoffs`,
        {
          query: { organization_id: params.organizationId },
        }
      );
    },

    async replayRun(runId: string): Promise<AgentRunReplayResponse> {
      return client.requestJson<AgentRunReplayResponse>(
        `/agents/runs/${runId}/replay`
      );
    },

    async listEvals(params: {
      organizationId: string;
      deploymentId?: string | null;
    }): Promise<AgentEvalResultModel[]> {
      return client.requestJson<AgentEvalResultModel[]>("/agents/evals", {
        query: {
          organization_id: params.organizationId,
          deployment_id: params.deploymentId ?? undefined,
        },
      });
    },

    async createEval(
      request: AgentEvalCreateRequest
    ): Promise<AgentEvalResultModel> {
      return client.requestJson<AgentEvalResultModel>("/agents/evals", {
        method: "POST",
        body: request,
      });
    },

    async listFeedback(params: {
      organizationId: string;
      runId?: string | null;
    }): Promise<AgentFeedbackModel[]> {
      return client.requestJson<AgentFeedbackModel[]>("/agents/feedback", {
        query: {
          organization_id: params.organizationId,
          run_id: params.runId ?? undefined,
        },
      });
    },

    async createFeedback(
      request: AgentFeedbackCreateRequest
    ): Promise<AgentFeedbackModel> {
      return client.requestJson<AgentFeedbackModel>("/agents/feedback", {
        method: "POST",
        body: request,
      });
    },

    async runOfflineEval(
      request: OfflineEvalRunRequest
    ): Promise<OfflineEvalRunResult> {
      return client.requestJson<OfflineEvalRunResult>(
        "/agents/quality/evals/offline/run",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async scoreRunQuality(params: {
      runId: string;
      organizationId: string;
    }): Promise<RunQualityScoreRecord> {
      return client.requestJson<RunQualityScoreRecord>(
        `/agents/quality/runs/${params.runId}/score`,
        {
          method: "POST",
          body: { organization_id: params.organizationId },
        }
      );
    },

    async listRunQualityScores(params: {
      organizationId: string;
      runId?: string | null;
      roleId?: string | null;
      deploymentId?: string | null;
      limit?: number;
      offset?: number;
    }): Promise<RunQualityScoreRecord[]> {
      return client.requestJson<RunQualityScoreRecord[]>(
        "/agents/quality/runs/scores",
        {
          query: {
            organization_id: params.organizationId,
            run_id: params.runId ?? undefined,
            role_id: params.roleId ?? undefined,
            deployment_id: params.deploymentId ?? undefined,
            limit: params.limit ?? 200,
            offset: params.offset ?? 0,
          },
        }
      );
    },

    async getQualityTrends(params: {
      organizationId: string;
      roleId?: string | null;
      deploymentId?: string | null;
      lookbackDays?: number;
    }): Promise<QualityTrendResponse> {
      return client.requestJson<QualityTrendResponse>(
        "/agents/quality/trends",
        {
          query: {
            organization_id: params.organizationId,
            role_id: params.roleId ?? undefined,
            deployment_id: params.deploymentId ?? undefined,
            lookback_days: params.lookbackDays ?? 30,
          },
        }
      );
    },

    async recomputeCalibration(params: {
      organizationId: string;
      roleId?: string | null;
      minSamples?: number;
    }): Promise<CalibrationSnapshot> {
      return client.requestJson<CalibrationSnapshot>(
        "/agents/quality/calibration/recompute",
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            role_id: params.roleId ?? null,
            min_samples: params.minSamples ?? 5,
          },
        }
      );
    },

    async getCalibration(params: {
      organizationId: string;
      roleId?: string | null;
    }): Promise<CalibrationSnapshot | null> {
      return client.requestJson<CalibrationSnapshot | null>(
        "/agents/quality/calibration",
        {
          query: {
            organization_id: params.organizationId,
            role_id: params.roleId ?? undefined,
          },
        }
      );
    },

    async generateRecommendations(params: {
      organizationId: string;
      roleId?: string | null;
      deploymentId?: string | null;
      lookbackDays?: number;
    }): Promise<QualityRecommendationRecord[]> {
      return client.requestJson<QualityRecommendationRecord[]>(
        "/agents/quality/recommendations/generate",
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            role_id: params.roleId ?? null,
            deployment_id: params.deploymentId ?? null,
            lookback_days: params.lookbackDays ?? 30,
          },
        }
      );
    },

    async listRecommendations(params: {
      organizationId: string;
      roleId?: string | null;
      deploymentId?: string | null;
      status?: string | null;
      limit?: number;
      offset?: number;
    }): Promise<QualityRecommendationRecord[]> {
      return client.requestJson<QualityRecommendationRecord[]>(
        "/agents/quality/recommendations",
        {
          query: {
            organization_id: params.organizationId,
            role_id: params.roleId ?? undefined,
            deployment_id: params.deploymentId ?? undefined,
            status: params.status ?? undefined,
            limit: params.limit ?? 200,
            offset: params.offset ?? 0,
          },
        }
      );
    },

    async createRegressionGate(
      request: RegressionGateCreateRequest
    ): Promise<RegressionGateRecord> {
      return client.requestJson<RegressionGateRecord>(
        "/agents/quality/regression-gates",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async listRegressionGates(params: {
      organizationId: string;
      roleId?: string | null;
      deploymentId?: string | null;
      onlyEnabled?: boolean;
      limit?: number;
      offset?: number;
    }): Promise<RegressionGateRecord[]> {
      return client.requestJson<RegressionGateRecord[]>(
        "/agents/quality/regression-gates",
        {
          query: {
            organization_id: params.organizationId,
            role_id: params.roleId ?? undefined,
            deployment_id: params.deploymentId ?? undefined,
            only_enabled:
              typeof params.onlyEnabled === "boolean"
                ? params.onlyEnabled
                : undefined,
            limit: params.limit ?? 200,
            offset: params.offset ?? 0,
          },
        }
      );
    },

    async evaluateRegressionGates(params: {
      organizationId: string;
      roleId?: string | null;
      deploymentId?: string | null;
      onlyEnabled?: boolean;
      persistEvents?: boolean;
    }): Promise<RegressionGateEvaluationResponse> {
      return client.requestJson<RegressionGateEvaluationResponse>(
        "/agents/quality/regression-gates/evaluate",
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            role_id: params.roleId ?? null,
            deployment_id: params.deploymentId ?? null,
            only_enabled:
              typeof params.onlyEnabled === "boolean"
                ? params.onlyEnabled
                : true,
            persist_events:
              typeof params.persistEvents === "boolean"
                ? params.persistEvents
                : true,
          },
        }
      );
    },

    async listWorkProducts(params: {
      organizationId: string;
      runId?: string | null;
      limit?: number;
      offset?: number;
    }): Promise<WorkProductRecord[]> {
      return client.requestJson<WorkProductRecord[]>("/agents/work-products", {
        query: {
          organization_id: params.organizationId,
          run_id: params.runId ?? undefined,
          limit: params.limit ?? 100,
          offset: params.offset ?? 0,
        },
      });
    },

    async getWorkProduct(params: {
      workProductId: string;
      organizationId: string;
    }): Promise<WorkProductRecord> {
      return client.requestJson<WorkProductRecord>(
        `/agents/work-products/${params.workProductId}`,
        {
          query: { organization_id: params.organizationId },
        }
      );
    },

    async createWorkProduct(
      request: WorkProductGenerateRequest
    ): Promise<WorkProductRecord> {
      return client.requestJson<WorkProductRecord>("/agents/work-products", {
        method: "POST",
        body: request,
      });
    },

    async deliverWorkProduct(params: {
      workProductId: string;
      request: WorkProductDeliveryRequest;
    }): Promise<WorkProductDeliveryResult> {
      return client.requestJson<WorkProductDeliveryResult>(
        `/agents/work-products/${params.workProductId}/deliver`,
        {
          method: "POST",
          body: params.request,
        }
      );
    },

    async listTeams(organizationId: string): Promise<AgentTeamModel[]> {
      return client.requestJson<AgentTeamModel[]>("/agents/teams", {
        query: { organization_id: organizationId },
      });
    },

    async createTeam(request: AgentTeamCreateRequest): Promise<AgentTeamModel> {
      return client.requestJson<AgentTeamModel>("/agents/teams", {
        method: "POST",
        body: request,
      });
    },

    async getTeam(teamId: string): Promise<AgentTeamModel> {
      return client.requestJson<AgentTeamModel>(`/agents/teams/${teamId}`);
    },

    async updateTeam(
      teamId: string,
      request: AgentTeamUpdateRequest
    ): Promise<AgentTeamModel> {
      return client.requestJson<AgentTeamModel>(`/agents/teams/${teamId}`, {
        method: "PATCH",
        body: request,
      });
    },

    async listTeamMembers(teamId: string): Promise<TeamMemberSpec[]> {
      return client.requestJson<TeamMemberSpec[]>(
        `/agents/teams/${teamId}/members`
      );
    },

    async replaceTeamMembers(
      teamId: string,
      request: AgentTeamMembersReplaceRequest
    ): Promise<TeamMemberSpec[]> {
      return client.requestJson<TeamMemberSpec[]>(
        `/agents/teams/${teamId}/members`,
        {
          method: "PUT",
          body: request,
        }
      );
    },

    async dispatchTeamRun(
      teamId: string,
      request: AgentTeamRunDispatchRequest
    ): Promise<AgentTeamRunDispatchResponse> {
      return client.requestJson<AgentTeamRunDispatchResponse>(
        `/agents/teams/${teamId}/runs`,
        {
          method: "POST",
          body: request,
        }
      );
    },

    async pauseRun(
      runId: string,
      organizationId: string,
      reason?: string
    ): Promise<AgentRunControlResponse> {
      return client.requestJson<AgentRunControlResponse>(
        `/agents/runs/${runId}/pause`,
        {
          method: "POST",
          body: { organization_id: organizationId, reason: reason ?? null },
        }
      );
    },

    async resumeRun(
      runId: string,
      organizationId: string,
      reason?: string
    ): Promise<AgentRunControlResponse> {
      return client.requestJson<AgentRunControlResponse>(
        `/agents/runs/${runId}/resume`,
        {
          method: "POST",
          body: { organization_id: organizationId, reason: reason ?? null },
        }
      );
    },

    async cancelRun(
      runId: string,
      organizationId: string,
      reason?: string
    ): Promise<AgentRunControlResponse> {
      return client.requestJson<AgentRunControlResponse>(
        `/agents/runs/${runId}/cancel`,
        {
          method: "POST",
          body: { organization_id: organizationId, reason: reason ?? null },
        }
      );
    },

    async killRun(
      runId: string,
      organizationId: string,
      reason?: string
    ): Promise<AgentRunControlResponse> {
      return client.requestJson<AgentRunControlResponse>(
        `/agents/runs/${runId}/kill`,
        {
          method: "POST",
          body: { organization_id: organizationId, reason: reason ?? null },
        }
      );
    },

    async listTriggers(organizationId: string): Promise<AgentTriggerModel[]> {
      return client.requestJson<AgentTriggerModel[]>("/agents/triggers", {
        query: { organization_id: organizationId },
      });
    },

    async createTrigger(
      request: AgentTriggerCreateRequest
    ): Promise<AgentTriggerModel> {
      return client.requestJson<AgentTriggerModel>("/agents/triggers", {
        method: "POST",
        body: request,
      });
    },

    async updateTrigger(
      triggerId: string,
      request: AgentTriggerUpdateRequest
    ): Promise<AgentTriggerModel> {
      return client.requestJson<AgentTriggerModel>(
        `/agents/triggers/${triggerId}`,
        {
          method: "PATCH",
          body: request,
        }
      );
    },

    async deleteTrigger(
      triggerId: string
    ): Promise<{ status: string; trigger_id: string }> {
      return client.requestJson<{ status: string; trigger_id: string }>(
        `/agents/triggers/${triggerId}`,
        {
          method: "DELETE",
        }
      );
    },

    async simulateTrigger(
      request: TriggerSimulationRequest
    ): Promise<TriggerRouteDecision> {
      return client.requestJson<TriggerRouteDecision>(
        "/agents/control/trigger-simulate",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async lintConfig(request: ConfigLintRequest): Promise<ConfigLintResponse> {
      return client.requestJson<ConfigLintResponse>(
        "/agents/control/lint-config",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async listLegacyContinuums(params: {
      organizationId: string;
      continuumId?: string;
      limit?: number;
    }): Promise<Record<string, unknown>[]> {
      return client.requestJson<Record<string, unknown>[]>(
        "/agents/control/legacy/continuums",
        {
          query: {
            organization_id: params.organizationId,
            continuum_id: params.continuumId,
            limit: params.limit ?? 200,
          },
        }
      );
    },

    async migrateLegacyContinuums(request: {
      organization_id: string;
      continuum_ids?: string[];
      dry_run?: boolean;
    }): Promise<Record<string, unknown>[]> {
      return client.requestJson<Record<string, unknown>[]>(
        "/agents/control/legacy/continuums/migrate",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async listLegacyMigrations(params: {
      organizationId: string;
      continuumId?: string;
      limit?: number;
    }): Promise<Record<string, unknown>[]> {
      return client.requestJson<Record<string, unknown>[]>(
        "/agents/control/legacy/continuums/migrations",
        {
          query: {
            organization_id: params.organizationId,
            continuum_id: params.continuumId,
            limit: params.limit ?? 100,
          },
        }
      );
    },

    async runLegacyShadowValidation(request: {
      organization_id: string;
      continuum_ids?: string[];
      lookback_days?: number;
    }): Promise<Record<string, unknown>[]> {
      return client.requestJson<Record<string, unknown>[]>(
        "/agents/control/legacy/continuums/shadow-validate",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async listLegacyShadowValidations(params: {
      organizationId: string;
      continuumId?: string;
      limit?: number;
    }): Promise<Record<string, unknown>[]> {
      return client.requestJson<Record<string, unknown>[]>(
        "/agents/control/legacy/continuums/shadow-validations",
        {
          query: {
            organization_id: params.organizationId,
            continuum_id: params.continuumId,
            limit: params.limit ?? 100,
          },
        }
      );
    },

    async listApprovals(params: {
      organizationId: string;
      status?: "pending" | "approved" | "denied" | "expired" | "escalated";
      runId?: string | null;
    }): Promise<ApprovalRequestRecord[]> {
      return client.requestJson<ApprovalRequestRecord[]>("/agents/approvals", {
        query: {
          organization_id: params.organizationId,
          status: params.status,
          run_id: params.runId ?? undefined,
        },
      });
    },

    async approve(
      approvalId: string,
      request: ApprovalDecisionRequest
    ): Promise<ApprovalRequestRecord> {
      return client.requestJson<ApprovalRequestRecord>(
        `/agents/approvals/${approvalId}/approve`,
        {
          method: "POST",
          body: request,
        }
      );
    },

    async deny(
      approvalId: string,
      request: ApprovalDecisionRequest
    ): Promise<ApprovalRequestRecord> {
      return client.requestJson<ApprovalRequestRecord>(
        `/agents/approvals/${approvalId}/deny`,
        {
          method: "POST",
          body: request,
        }
      );
    },

    async listReceipts(params: {
      organizationId: string;
      runId?: string | null;
      finalStatus?: string | null;
    }): Promise<ActionReceiptRecord[]> {
      return client.requestJson<ActionReceiptRecord[]>("/agents/receipts", {
        query: {
          organization_id: params.organizationId,
          run_id: params.runId ?? undefined,
          final_status: params.finalStatus ?? undefined,
        },
      });
    },

    async provisionIdentity(
      request: IdentityProvisionRequest
    ): Promise<AgentIdentityRecord> {
      return client.requestJson<AgentIdentityRecord>(
        "/agents/identities/provision",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async listIdentities(
      organizationId: string
    ): Promise<AgentIdentityRecord[]> {
      return client.requestJson<AgentIdentityRecord[]>("/agents/identities", {
        query: { organization_id: organizationId },
      });
    },

    async listChannelBindings(params: {
      organizationId: string;
      identityId?: string | null;
      channelType?: "email" | "slack" | "teams";
      isEnabled?: boolean;
    }): Promise<AgentChannelBindingRecord[]> {
      return client.requestJson<AgentChannelBindingRecord[]>(
        "/agents/channels/bindings",
        {
          query: {
            organization_id: params.organizationId,
            identity_id: params.identityId ?? undefined,
            channel_type: params.channelType,
            is_enabled:
              typeof params.isEnabled === "boolean"
                ? params.isEnabled
                : undefined,
          },
        }
      );
    },

    async upsertChannelBinding(
      request: ChannelBindingUpsertRequest
    ): Promise<AgentChannelBindingRecord> {
      return client.requestJson<AgentChannelBindingRecord>(
        "/agents/channels/bindings",
        {
          method: "PUT",
          body: request,
        }
      );
    },

    async listInboxThreads(params: {
      organizationId: string;
      identityId?: string | null;
      channelType?: "email" | "slack" | "teams";
      status?: "open" | "resolved" | "blocked" | "archived";
      limit?: number;
      offset?: number;
    }): Promise<AgentInboxThreadRecord[]> {
      return client.requestJson<AgentInboxThreadRecord[]>(
        "/agents/inbox/threads",
        {
          query: {
            organization_id: params.organizationId,
            identity_id: params.identityId ?? undefined,
            channel_type: params.channelType,
            status: params.status,
            limit: params.limit ?? 100,
            offset: params.offset ?? 0,
          },
        }
      );
    },

    async listThreadMessages(params: {
      threadId: string;
      organizationId: string;
      limit?: number;
      offset?: number;
    }): Promise<AgentMessageEventRecord[]> {
      return client.requestJson<AgentMessageEventRecord[]>(
        `/agents/inbox/threads/${params.threadId}/messages`,
        {
          query: {
            organization_id: params.organizationId,
            limit: params.limit ?? 200,
            offset: params.offset ?? 0,
          },
        }
      );
    },

    async replyToThread(
      threadId: string,
      request: ThreadReplyRequest
    ): Promise<AgentMessageEventRecord> {
      return client.requestJson<AgentMessageEventRecord>(
        `/agents/inbox/threads/${threadId}/reply`,
        {
          method: "POST",
          body: request,
        }
      );
    },

    async desktopAction(
      request: DesktopActionRequest
    ): Promise<DesktopActionResponse> {
      return client.requestJson<DesktopActionResponse>(
        "/agents/desktop/actions",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async desktopHealth(
      request: DesktopBridgeHealthRequest
    ): Promise<DesktopBridgeHealthResponse> {
      return client.requestJson<DesktopBridgeHealthResponse>(
        "/agents/desktop/health",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async desktopDisable(
      request: DesktopBridgeControlRequest
    ): Promise<DesktopBridgeControlResponse> {
      return client.requestJson<DesktopBridgeControlResponse>(
        "/agents/desktop/control/disable",
        {
          method: "POST",
          body: request,
        }
      );
    },

    async desktopEnable(
      request: DesktopBridgeControlRequest
    ): Promise<DesktopBridgeControlResponse> {
      return client.requestJson<DesktopBridgeControlResponse>(
        "/agents/desktop/control/enable",
        {
          method: "POST",
          body: request,
        }
      );
    },
  };
}
