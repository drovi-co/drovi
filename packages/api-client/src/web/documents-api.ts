import type { ApiClient } from "../http/client";

import type {
  DriveAskResponse,
  DriveDocumentChunk,
  DriveDocumentChunkDetail,
  DriveDocumentListResponse,
  DriveSearchResponse,
  DriveUploadCompleteResponse,
  DriveUploadCreateResponse,
  DriveUploadPartsResponse,
  EvidenceArtifact,
  EvidenceArtifactPresign,
} from "./models";
import {
  transformDriveChunk,
  transformDriveChunkDetail,
  transformDriveDocument,
} from "./models";

export function createDocumentsApi(client: ApiClient) {
  return {
    async createUpload(params: {
      organizationId?: string;
      fileName: string;
      mimeType?: string | null;
      byteSize: number;
      sha256: string;
      title?: string | null;
      folderPath?: string | null;
      tags?: string[] | null;
    }): Promise<DriveUploadCreateResponse> {
      return client.requestJson<DriveUploadCreateResponse>(
        "/documents/uploads",
        {
          method: "POST",
          body: {
            organization_id: params.organizationId ?? null,
            file_name: params.fileName,
            mime_type: params.mimeType ?? null,
            byte_size: params.byteSize,
            sha256: params.sha256,
            title: params.title ?? null,
            folder_path: params.folderPath ?? "/",
            tags: params.tags ?? [],
          },
          allowRetry: false,
        }
      );
    },

    async presignParts(params: {
      uploadSessionId: string;
      partNumbers: number[];
    }): Promise<DriveUploadPartsResponse> {
      return client.requestJson<DriveUploadPartsResponse>(
        `/documents/uploads/${params.uploadSessionId}/parts`,
        {
          method: "POST",
          body: { part_numbers: params.partNumbers },
          allowRetry: false,
        }
      );
    },

    async completeUpload(params: {
      uploadSessionId: string;
      parts: Array<{ partNumber: number; etag: string }>;
    }): Promise<DriveUploadCompleteResponse> {
      return client.requestJson<DriveUploadCompleteResponse>(
        `/documents/uploads/${params.uploadSessionId}/complete`,
        {
          method: "POST",
          body: {
            parts: params.parts.map((p) => ({
              part_number: p.partNumber,
              etag: p.etag,
            })),
          },
          allowRetry: false,
        }
      );
    },

    async list(params: {
      organizationId?: string;
      limit?: number;
      cursor?: string;
      includeTotal?: boolean;
    }): Promise<DriveDocumentListResponse> {
      const raw = await client.requestJson<{
        success: boolean;
        items: Array<Record<string, unknown>>;
        cursor?: string | null;
        has_more?: boolean;
        total?: number | null;
      }>("/documents", {
        query: {
          organization_id: params.organizationId,
          limit: params.limit,
          cursor: params.cursor,
          include_total: params.includeTotal,
        },
      });

      return {
        success: raw.success,
        items: (raw.items ?? []).map(transformDriveDocument),
        cursor: raw.cursor ?? null,
        hasMore: raw.has_more ?? false,
        total: raw.total ?? null,
      };
    },

    async listChunks(params: {
      documentId: string;
      organizationId?: string;
      limit?: number;
    }): Promise<{ success: boolean; items: DriveDocumentChunk[] }> {
      const raw = await client.requestJson<{
        success: boolean;
        items: Array<Record<string, unknown>>;
      }>(`/documents/${params.documentId}/chunks`, {
        query: {
          organization_id: params.organizationId,
          limit: params.limit,
        },
      });

      return {
        success: raw.success,
        items: (raw.items ?? []).map(transformDriveChunk),
      };
    },

    async getChunk(params: {
      chunkId: string;
      organizationId?: string;
    }): Promise<DriveDocumentChunkDetail> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/documents/chunks/${params.chunkId}`,
        { query: { organization_id: params.organizationId } }
      );
      return transformDriveChunkDetail(raw);
    },

    async search(params: {
      query: string;
      organizationId?: string;
      folderPrefix?: string | null;
      limit?: number;
    }): Promise<DriveSearchResponse> {
      return client.requestJson<DriveSearchResponse>("/documents/search", {
        method: "POST",
        body: {
          query: params.query,
          organization_id: params.organizationId ?? null,
          folder_prefix: params.folderPrefix ?? null,
          limit: params.limit ?? 20,
        },
      });
    },

    async ask(params: {
      question: string;
      organizationId?: string;
      folderPrefix?: string | null;
      limit?: number;
    }): Promise<DriveAskResponse> {
      return client.requestJson<DriveAskResponse>("/documents/ask", {
        method: "POST",
        body: {
          question: params.question,
          organization_id: params.organizationId ?? null,
          folder_prefix: params.folderPrefix ?? null,
          limit: params.limit ?? 8,
        },
      });
    },

    async getEvidenceArtifact(params: {
      organizationId: string;
      artifactId: string;
      includeUrl?: boolean;
    }): Promise<EvidenceArtifact> {
      return client.requestJson<EvidenceArtifact>(
        `/evidence/artifacts/${params.artifactId}`,
        {
          query: {
            organization_id: params.organizationId,
            include_url: params.includeUrl === true ? "true" : undefined,
          },
        }
      );
    },

    async requestEvidenceArtifactUrl(params: {
      organizationId: string;
      artifactId: string;
    }): Promise<EvidenceArtifactPresign> {
      return client.requestJson<EvidenceArtifactPresign>(
        `/evidence/artifacts/${params.artifactId}/presign`,
        {
          method: "POST",
          query: {
            organization_id: params.organizationId,
          },
        }
      );
    },
  };
}
