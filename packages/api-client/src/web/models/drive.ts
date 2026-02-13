export interface DriveDocument {
  id: string;
  title: string | null;
  fileName: string;
  mimeType: string | null;
  byteSize: number | null;
  sha256: string;
  status: string;
  folderPath: string;
  tags: string[];
  pageCount: number | null;
  evidenceArtifactId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DriveDocumentListResponse {
  success: boolean;
  items: DriveDocument[];
  cursor: string | null;
  hasMore: boolean;
  total: number | null;
}

export interface DriveDocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  pageIndex: number | null;
  snippet: string;
  imageArtifactId: string | null;
}

export interface DriveDocumentChunkDetail {
  id: string;
  documentId: string;
  chunkIndex: number;
  pageIndex: number | null;
  text: string;
  layoutBlocks: Array<Record<string, unknown>>;
  imageArtifactId: string | null;
}

export interface DriveUploadCreateResponse {
  document_id: string;
  upload_session_id: string | null;
  multipart_upload_id: string | null;
  s3_key: string | null;
  part_size_bytes: number | null;
  presign_expires_in: number;
  already_exists: boolean;
}

export interface DriveUploadPartsResponse {
  upload_session_id: string;
  urls: Record<string, string>;
}

export interface DriveUploadCompleteResponse {
  document_id: string;
  queued_job_id: string | null;
  status: string;
}

export interface DriveSearchHit {
  chunk_id: string;
  document_id: string;
  file_name: string;
  title: string | null;
  folder_path: string;
  page_index: number | null;
  snippet: string;
  score: number | null;
}

export interface DriveSearchResponse {
  success: boolean;
  results: DriveSearchHit[];
}

export interface DriveAskResponse {
  success: boolean;
  answer: string;
  sources: DriveSearchHit[];
}

export interface EvidenceArtifact {
  id: string;
  artifact_type: string;
  mime_type: string | null;
  storage_backend: string;
  storage_path: string;
  storage_uri: string | null;
  byte_size: number | null;
  sha256: string | null;
  created_at: string;
  retention_until: string | null;
  immutable: boolean | null;
  legal_hold: boolean | null;
  metadata: Record<string, unknown>;
  presigned_url: string | null;
}

export interface EvidenceArtifactPresign {
  artifact_id: string;
  presigned_url: string;
  expires_in_seconds: number;
}

export function transformDriveDocument(
  raw: Record<string, unknown>
): DriveDocument {
  return {
    id: String(raw.id ?? ""),
    title: (raw.title as string | null) ?? null,
    fileName: String(raw.file_name ?? raw.fileName ?? ""),
    mimeType: (raw.mime_type as string | null) ?? null,
    byteSize: raw.byte_size == null ? null : Number(raw.byte_size),
    sha256: String(raw.sha256 ?? ""),
    status: String(raw.status ?? ""),
    folderPath: String(raw.folder_path ?? "/"),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    pageCount: raw.page_count == null ? null : Number(raw.page_count),
    evidenceArtifactId: (raw.evidence_artifact_id as string | null) ?? null,
    createdAt: (raw.created_at as string | null) ?? null,
    updatedAt: (raw.updated_at as string | null) ?? null,
  };
}

export function transformDriveChunk(
  raw: Record<string, unknown>
): DriveDocumentChunk {
  return {
    id: String(raw.id ?? ""),
    documentId: String(raw.document_id ?? ""),
    chunkIndex: Number(raw.chunk_index ?? 0),
    pageIndex: raw.page_index == null ? null : Number(raw.page_index),
    snippet: String(raw.snippet ?? ""),
    imageArtifactId: (raw.image_artifact_id as string | null) ?? null,
  };
}

export function transformDriveChunkDetail(
  raw: Record<string, unknown>
): DriveDocumentChunkDetail {
  return {
    id: String(raw.id ?? ""),
    documentId: String(raw.document_id ?? ""),
    chunkIndex: Number(raw.chunk_index ?? 0),
    pageIndex: raw.page_index == null ? null : Number(raw.page_index),
    text: String(raw.text ?? ""),
    layoutBlocks: Array.isArray(raw.layout_blocks)
      ? (raw.layout_blocks as Array<Record<string, unknown>>)
      : [],
    imageArtifactId: (raw.image_artifact_id as string | null) ?? null,
  };
}
