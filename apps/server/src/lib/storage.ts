import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@memorystack/env/server";
import { log } from "./logger";

// S3 client singleton
let s3Client: S3Client | null = null;

/**
 * Get S3 client instance
 */
function getS3Client(): S3Client {
  if (!(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET)) {
    throw new Error(
      "S3 storage not configured. Set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET."
    );
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true, // Required for R2 and MinIO
    });
  }

  return s3Client;
}

/**
 * Check if storage is configured
 */
export function isStorageConfigured(): boolean {
  return !!(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET);
}

/**
 * Generate a unique file key with optional prefix
 */
export function generateFileKey(
  filename: string,
  options: {
    prefix?: string;
    userId?: string;
  } = {}
): string {
  const { prefix = "uploads", userId } = options;
  const uuid = randomUUID();
  const sanitizedName = filename
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .substring(0, 50);

  const parts = [prefix];
  if (userId) {
    parts.push(userId);
  }
  parts.push(`${uuid}-${sanitizedName}`);

  return parts.join("/");
}

/**
 * Upload a file to S3/R2
 */
export async function uploadFile(
  key: string,
  body: Buffer | ReadableStream | Blob,
  options: {
    contentType?: string;
    metadata?: Record<string, string>;
  } = {}
): Promise<{ key: string; url: string }> {
  const client = getS3Client();

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: options.contentType || "application/octet-stream",
    Metadata: options.metadata,
  });

  await client.send(command);

  log.info("File uploaded", { key, contentType: options.contentType });

  const url = env.S3_PUBLIC_URL
    ? `${env.S3_PUBLIC_URL}/${key}`
    : `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${key}`;

  return { key, url };
}

/**
 * Get a signed URL for downloading a file
 */
export function getSignedDownloadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Get a signed URL for uploading a file
 */
export async function getSignedUploadUrl(
  key: string,
  options: {
    contentType?: string;
    expiresIn?: number;
    maxSize?: number;
  } = {}
): Promise<{ url: string; key: string }> {
  const client = getS3Client();
  const { contentType = "application/octet-stream", expiresIn = 3600 } =
    options;

  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const url = await getSignedUrl(client, command, { expiresIn });

  return { url, key };
}

/**
 * Delete a file from S3/R2
 */
export async function deleteFile(key: string): Promise<void> {
  const client = getS3Client();

  const command = new DeleteObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  });

  await client.send(command);
  log.info("File deleted", { key });
}

/**
 * Check if a file exists
 */
export async function fileExists(key: string): Promise<boolean> {
  const client = getS3Client();

  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file metadata
 */
export async function getFileMetadata(key: string): Promise<{
  size: number;
  contentType: string;
  lastModified: Date;
  metadata: Record<string, string>;
} | null> {
  const client = getS3Client();

  try {
    const command = new HeadObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
    });
    const response = await client.send(command);

    return {
      size: response.ContentLength || 0,
      contentType: response.ContentType || "application/octet-stream",
      lastModified: response.LastModified || new Date(),
      metadata: response.Metadata || {},
    };
  } catch {
    return null;
  }
}

/**
 * Allowed file types and their MIME types
 */
export const ALLOWED_FILE_TYPES = {
  image: [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
  ],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: ["audio/mpeg", "audio/wav", "audio/ogg"],
};

/**
 * Validate file type
 */
export function validateFileType(
  contentType: string,
  allowedTypes: keyof typeof ALLOWED_FILE_TYPES | string[]
): boolean {
  const allowed = Array.isArray(allowedTypes)
    ? allowedTypes
    : ALLOWED_FILE_TYPES[allowedTypes];

  return allowed.includes(contentType);
}

/**
 * Max file sizes by type (in bytes)
 */
export const MAX_FILE_SIZES = {
  image: 10 * 1024 * 1024, // 10MB
  document: 50 * 1024 * 1024, // 50MB
  video: 500 * 1024 * 1024, // 500MB
  audio: 50 * 1024 * 1024, // 50MB
  default: 10 * 1024 * 1024, // 10MB
};

/**
 * Validate file size
 */
export function validateFileSize(
  size: number,
  type: keyof typeof MAX_FILE_SIZES = "default"
): boolean {
  return size <= MAX_FILE_SIZES[type];
}
