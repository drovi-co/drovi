import type { ApiClient } from "../http/client";

import type {
  ContinuityScore,
  EvidenceBundleExport,
  MonthlyIntegrityReport,
  RecordCertificate,
  TrustIndicator,
  TrustRetentionProfile,
} from "./models";

export function createTrustApi(client: ApiClient) {
  return {
    async getIndicators(params: {
      organizationId: string;
      uioIds: string[];
      evidenceLimit?: number;
    }): Promise<TrustIndicator[]> {
      return client.requestJson<TrustIndicator[]>("/trust/uios", {
        method: "POST",
        body: {
          organization_id: params.organizationId,
          uio_ids: params.uioIds,
          evidence_limit: params.evidenceLimit ?? 3,
        },
      });
    },

    async getContinuityScore(params: {
      organizationId: string;
      lookbackDays?: number;
    }): Promise<ContinuityScore> {
      return client.requestJson<ContinuityScore>("/trust/continuity-score", {
        query: {
          organization_id: params.organizationId,
          lookback_days: params.lookbackDays ?? 30,
        },
      });
    },

    async getRecordCertificate(params: {
      organizationId: string;
      uioId: string;
      evidenceLimit?: number;
    }): Promise<RecordCertificate> {
      return client.requestJson<RecordCertificate>(
        `/trust/record-certificate/${encodeURIComponent(params.uioId)}`,
        {
          query: {
            organization_id: params.organizationId,
            evidence_limit: params.evidenceLimit ?? 10,
          },
        }
      );
    },

    async getMonthlyIntegrityReport(params: {
      organizationId: string;
      month?: string;
    }): Promise<MonthlyIntegrityReport> {
      return client.requestJson<MonthlyIntegrityReport>(
        "/trust/integrity-report/monthly",
        {
          query: {
            organization_id: params.organizationId,
            month: params.month,
          },
        }
      );
    },

    async exportEvidenceBundle(params: {
      organizationId: string;
      uioIds?: string[];
      evidenceIds?: string[];
      includePresignedUrls?: boolean;
    }): Promise<EvidenceBundleExport> {
      return client.requestJson<EvidenceBundleExport>(
        "/trust/evidence-bundles/export",
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            uio_ids: params.uioIds ?? [],
            evidence_ids: params.evidenceIds ?? [],
            include_presigned_urls: params.includePresignedUrls ?? false,
          },
        }
      );
    },

    async getRetentionProfile(organizationId: string): Promise<TrustRetentionProfile> {
      return client.requestJson<TrustRetentionProfile>(
        "/trust/retention-profile",
        {
          query: { organization_id: organizationId },
        }
      );
    },

    async updateRetentionProfile(params: {
      organizationId: string;
      dataRetentionDays: number;
      evidenceRetentionDays: number;
      defaultLegalHold: boolean;
      requireLegalHoldReason: boolean;
    }): Promise<TrustRetentionProfile> {
      return client.requestJson<TrustRetentionProfile>(
        "/trust/retention-profile",
        {
          method: "PUT",
          body: {
            organization_id: params.organizationId,
            data_retention_days: params.dataRetentionDays,
            evidence_retention_days: params.evidenceRetentionDays,
            default_legal_hold: params.defaultLegalHold,
            require_legal_hold_reason: params.requireLegalHoldReason,
          },
        }
      );
    },

    async updateEvidenceLegalHold(params: {
      organizationId: string;
      evidenceArtifactIds: string[];
      legalHold: boolean;
      reason?: string;
      retentionUntil?: string;
    }): Promise<Record<string, unknown>> {
      return client.requestJson<Record<string, unknown>>(
        "/trust/evidence/legal-hold",
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            evidence_artifact_ids: params.evidenceArtifactIds,
            legal_hold: params.legalHold,
            reason: params.reason,
            retention_until: params.retentionUntil,
          },
        }
      );
    },
  };
}
