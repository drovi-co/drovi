// =============================================================================
// EVIDENCE UTILITIES
// =============================================================================
//
// Shared helpers for extracting evidence quotes and metadata from
// heterogeneous extraction contexts. These contexts can arrive as:
// - Plain strings (already a quote)
// - JSON strings (serialized extraction context)
// - Plain objects (direct extraction context)
//
// The goal is to reliably surface quoted evidence in UI components.
//

import type { EvidencePopoverData } from "@/components/evidence";

type EvidenceContext = Record<string, unknown>;

function isRecord(value: unknown): value is EvidenceContext {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function parseContext(raw: unknown): EvidenceContext | null {
  if (!raw) {
    return null;
  }

  if (isRecord(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function extractQuotedText(
  raw: unknown,
  fallback?: string | null
): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed && !trimmed.startsWith("{") && trimmed.length <= 400) {
      return trimmed;
    }
  }

  const context = parseContext(raw);
  if (!context) {
    return fallback ?? null;
  }

  const quoted =
    getString(context.quotedText) ??
    getString(context.quoted_text) ??
    getString(context.quote) ??
    getString(context.snippet) ??
    getString(context.text);

  return quoted ?? fallback ?? null;
}

export function extractThreadId(raw: unknown): string | null {
  const context = parseContext(raw);
  if (!context) {
    return null;
  }

  return (
    getString(context.threadId) ??
    getString(context.thread_id) ??
    getString(context.conversationId) ??
    getString(context.conversation_id) ??
    null
  );
}

export function extractSourceMessage(
  raw: unknown
): EvidencePopoverData["sourceMessage"] | null {
  const context = parseContext(raw);
  if (!context) {
    return null;
  }

  const source =
    (isRecord(context.sourceMessage) && context.sourceMessage) ||
    (isRecord(context.source_message) && context.source_message) ||
    (isRecord(context.source) && context.source) ||
    null;

  if (!source || !isRecord(source)) {
    return null;
  }

  const senderEmail =
    getString(source.senderEmail) ??
    getString(source.sender_email) ??
    getString(source.from_email) ??
    getString(source.email);
  const senderName =
    getString(source.senderName) ??
    getString(source.sender_name) ??
    getString(source.from_name);
  const threadSubject =
    getString(source.threadSubject) ??
    getString(source.subject) ??
    getString(source.thread_subject);
  const sentAtRaw =
    getString(source.sentAt) ??
    getString(source.sent_at) ??
    getString(source.timestamp);

  if (!senderEmail || !sentAtRaw) {
    return null;
  }

  const sentAt = new Date(sentAtRaw);
  if (Number.isNaN(sentAt.getTime())) {
    return null;
  }

  return {
    senderEmail,
    senderName,
    sentAt,
    threadSubject,
  };
}

