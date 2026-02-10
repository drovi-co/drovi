import { describe, expect, it } from "vitest";

import {
  extractQuotedText,
  extractSourceMessage,
  extractThreadId,
} from "./evidence-utils";

describe("evidence-utils", () => {
  it("extracts quoted text from plain strings", () => {
    expect(extractQuotedText("  We will ship Friday.  ")).toBe(
      "We will ship Friday."
    );
  });

  it("extracts quoted text from JSON contexts", () => {
    const context = JSON.stringify({
      quotedText: "We will ship Friday.",
      reasoning: "Promise detected",
    });
    expect(extractQuotedText(context)).toBe("We will ship Friday.");
  });

  it("falls back when no quote is found", () => {
    expect(extractQuotedText({} as Record<string, unknown>, "Fallback")).toBe(
      "Fallback"
    );
  });

  it("extracts thread IDs from contexts", () => {
    expect(extractThreadId({ thread_id: "thread-123" })).toBe("thread-123");
    expect(extractThreadId({ conversationId: "conv-456" })).toBe("conv-456");
  });

  it("extracts source message metadata when present", () => {
    const message = extractSourceMessage({
      sourceMessage: {
        sender_email: "alice@example.com",
        sender_name: "Alice",
        sent_at: "2024-01-01T10:00:00Z",
        thread_subject: "Weekly sync",
      },
    });

    expect(message?.senderEmail).toBe("alice@example.com");
    expect(message?.senderName).toBe("Alice");
    expect(message?.threadSubject).toBe("Weekly sync");
    expect(message?.sentAt.toISOString()).toBe("2024-01-01T10:00:00.000Z");
  });
});
