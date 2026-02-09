import { create } from "zustand";

import { documentsAPI } from "./api";

export type DriveUploadStatus =
  | "queued"
  | "hashing"
  | "starting"
  | "uploading"
  | "finalizing"
  | "processing"
  | "done"
  | "failed";

export type DriveUploadEntry = {
  id: string;
  file: File;
  fileName: string;
  byteSize: number;
  sha256?: string;
  documentId?: string;
  uploadSessionId?: string;
  partSizeBytes?: number;
  partsTotal?: number;
  partsDone?: number;
  progressPct: number;
  status: DriveUploadStatus;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

function bytesToHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let out = "";
  for (const b of view) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

async function sha256File(file: File): Promise<string> {
  // Note: WebCrypto digest is one-shot; this loads the file in memory.
  // For very large files, we should replace this with an incremental hash
  // implementation (e.g. WASM) to keep memory bounded.
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return bytesToHex(digest);
}

async function uploadPart(url: string, blob: Blob): Promise<string> {
  const res = await fetch(url, { method: "PUT", body: blob });
  if (!res.ok) {
    throw new Error(`Part upload failed (${res.status})`);
  }
  // S3 compatible providers usually return an ETag header. Normalize.
  const etag = res.headers.get("etag") ?? res.headers.get("ETag");
  if (!etag) {
    throw new Error("Missing ETag header for uploaded part");
  }
  return etag;
}

async function presignAllParts(uploadSessionId: string, totalParts: number): Promise<Map<number, string>> {
  const urls = new Map<number, string>();
  const batchSize = 100;
  for (let start = 1; start <= totalParts; start += batchSize) {
    const partNumbers: number[] = [];
    for (let p = start; p < start + batchSize && p <= totalParts; p += 1) {
      partNumbers.push(p);
    }
    const batch = await documentsAPI.presignParts({ uploadSessionId, partNumbers });
    for (const [key, url] of Object.entries(batch.urls ?? {})) {
      const n = Number(key);
      if (!Number.isFinite(n) || n < 1) continue;
      urls.set(n, String(url));
    }
  }
  return urls;
}

type DriveUploadsState = {
  uploads: DriveUploadEntry[];
  enqueueFiles: (
    files: File[],
    organizationId: string,
    options?: { folderPath?: string; tags?: string[] }
  ) => void;
  retry: (id: string, organizationId: string) => void;
  dismiss: (id: string) => void;
};

export const useDriveUploadsStore = create<DriveUploadsState>((set, get) => ({
  uploads: [],

  enqueueFiles: (files, organizationId, options) => {
    const now = Date.now();
    const folderPath = (options?.folderPath || "/").trim() || "/";
    const tags = options?.tags ?? [];
    const entries: DriveUploadEntry[] = files.map((file) => ({
      id: `upl_local_${crypto.randomUUID()}`,
      file,
      fileName: file.name,
      byteSize: file.size,
      progressPct: 0,
      status: "queued",
      startedAt: now,
      updatedAt: now,
    }));

    set((state) => ({ uploads: [...entries, ...state.uploads] }));

    for (const entry of entries) {
      void (async () => {
        try {
          set((state) => ({
            uploads: state.uploads.map((u) =>
              u.id === entry.id
                ? { ...u, status: "hashing", updatedAt: Date.now() }
                : u
            ),
          }));

          const sha256 = await sha256File(entry.file);

          set((state) => ({
            uploads: state.uploads.map((u) =>
              u.id === entry.id
                ? { ...u, sha256, status: "starting", updatedAt: Date.now() }
                : u
            ),
          }));

          const created = await documentsAPI.createUpload({
            organizationId,
            fileName: entry.fileName,
            mimeType: entry.file.type || null,
            byteSize: entry.byteSize,
            sha256,
            title: null,
            folderPath,
            tags,
          });

          if (created.already_exists) {
            set((state) => ({
              uploads: state.uploads.map((u) =>
                u.id === entry.id
                  ? {
                      ...u,
                      documentId: created.document_id,
                      status: "done",
                      progressPct: 100,
                      updatedAt: Date.now(),
                    }
                  : u
              ),
            }));
            return;
          }

          if (!created.upload_session_id || !created.part_size_bytes) {
            throw new Error("Upload session was not created");
          }

          const uploadSessionId = created.upload_session_id;
          const partSize = created.part_size_bytes;
          const totalParts = Math.max(1, Math.ceil(entry.file.size / partSize));

          set((state) => ({
            uploads: state.uploads.map((u) =>
              u.id === entry.id
                ? {
                    ...u,
                    documentId: created.document_id,
                    uploadSessionId,
                    partSizeBytes: partSize,
                    partsTotal: totalParts,
                    partsDone: 0,
                    status: "uploading",
                    updatedAt: Date.now(),
                  }
                : u
            ),
          }));

          const presigned = await presignAllParts(uploadSessionId, totalParts);
          const completedParts: Array<{ partNumber: number; etag: string }> = [];

          for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
            const url = presigned.get(partNumber);
            if (!url) {
              throw new Error(`Missing presigned URL for part ${partNumber}`);
            }
            const startByte = (partNumber - 1) * partSize;
            const endByte = Math.min(entry.file.size, startByte + partSize);
            const blob = entry.file.slice(startByte, endByte);

            let etag: string | null = null;
            for (let attempt = 1; attempt <= 3; attempt += 1) {
              try {
                etag = await uploadPart(url, blob);
                break;
              } catch (err) {
                if (attempt === 3) throw err;
                await new Promise((r) => setTimeout(r, 500 * attempt));
              }
            }
            if (!etag) {
              throw new Error(`Part ${partNumber} upload failed`);
            }
            completedParts.push({ partNumber, etag });

            const partsDone = completedParts.length;
            const progress = Math.round((partsDone / totalParts) * 100);
            set((state) => ({
              uploads: state.uploads.map((u) =>
                u.id === entry.id
                  ? {
                      ...u,
                      partsDone,
                      progressPct: progress,
                      updatedAt: Date.now(),
                    }
                  : u
              ),
            }));
          }

          set((state) => ({
            uploads: state.uploads.map((u) =>
              u.id === entry.id
                ? { ...u, status: "finalizing", updatedAt: Date.now() }
                : u
            ),
          }));

          await documentsAPI.completeUpload({
            uploadSessionId,
            parts: completedParts,
          });

          set((state) => ({
            uploads: state.uploads.map((u) =>
              u.id === entry.id
                ? {
                    ...u,
                    status: "processing",
                    progressPct: 100,
                    updatedAt: Date.now(),
                  }
                : u
            ),
          }));

          // Mark as done locally. The document status itself is tracked via Drive list polling.
          setTimeout(() => {
            set((state) => ({
              uploads: state.uploads.map((u) =>
                u.id === entry.id ? { ...u, status: "done", updatedAt: Date.now() } : u
              ),
            }));
          }, 1500);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload failed";
          set((state) => ({
            uploads: state.uploads.map((u) =>
              u.id === entry.id
                ? {
                    ...u,
                    status: "failed",
                    error: message,
                    updatedAt: Date.now(),
                  }
                : u
            ),
          }));
        }
      })();
    }
  },

  retry: (id, organizationId) => {
    const entry = get().uploads.find((u) => u.id === id);
    if (!entry) return;
    set((state) => ({
      uploads: state.uploads.map((u) =>
        u.id === id
          ? { ...u, status: "queued", error: undefined, progressPct: 0, updatedAt: Date.now() }
          : u
      ),
    }));
    get().enqueueFiles([entry.file], organizationId);
    set((state) => ({
      uploads: state.uploads.filter((u) => u.id !== id),
    }));
  },

  dismiss: (id) => {
    set((state) => ({ uploads: state.uploads.filter((u) => u.id !== id) }));
  },
}));
