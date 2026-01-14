import { db } from "@memorystack/db";
import { emailThread } from "@memorystack/db/schema";
import { eq } from "drizzle-orm";
import { analyzeThread, type ThreadInput } from "@memorystack/ai/agents";

async function main() {
  // Get thread with messages
  const thread = await db.query.emailThread.findFirst({
    where: eq(emailThread.id, "fb13fd9a-897d-4f0a-8b51-ee1aa8322afa"),
    with: {
      messages: {
        orderBy: (m, { asc }) => [asc(m.sentAt)],
      },
      account: true,
    },
  });

  if (!thread) {
    console.log("Thread not found");
    process.exit(1);
  }

  console.log("Thread:", thread.subject);
  console.log("Messages:", thread.messages.length);
  console.log("User email:", thread.account.email);
  console.log("");

  // Print message content
  for (const m of thread.messages) {
    console.log(`From: ${m.fromEmail}`);
    console.log(`Body: ${m.bodyText?.substring(0, 300) || m.snippet || "(empty)"}`);
    console.log("---");
  }
  console.log("");

  // Build thread input
  const threadInput: ThreadInput = {
    id: thread.id,
    accountId: thread.accountId,
    organizationId: thread.account.organizationId,
    subject: thread.subject || "",
    userEmail: thread.account.email,
    messages: thread.messages.map((m) => ({
      id: m.id,
      fromEmail: m.fromEmail,
      fromName: m.fromName || undefined,
      toEmails: (m.toRecipients as Array<{ email: string }>)?.map((r) => r.email) || [],
      ccEmails: (m.ccRecipients as Array<{ email: string }>)?.map((r) => r.email) || [],
      subject: m.subject || undefined,
      body: m.bodyText || m.snippet || "",
      timestamp: m.sentAt || new Date(),
      isFromUser: m.fromEmail === thread.account.email,
    })),
  };

  console.log("Running analyzeThread...");

  try {
    const analysis = await analyzeThread(threadInput);

    console.log("\n=== Analysis Results ===");
    console.log("Brief:", analysis.brief.summary);
    console.log("Key Points:", analysis.brief.keyPoints);
    console.log("Intent:", analysis.classification.intent.intent);
    console.log("Urgency:", analysis.classification.urgency.level);
    console.log("");
    console.log("Claims:");
    console.log("  Facts:", analysis.claims.facts.length);
    console.log("  Promises:", analysis.claims.promises.length);
    console.log("  Requests:", analysis.claims.requests.length);
    console.log("  Questions:", analysis.claims.questions.length);
    console.log("  Decisions:", analysis.claims.decisions.length);
    console.log("");
    console.log("Open Loops:", analysis.openLoops.length);

    if (analysis.claims.promises.length > 0) {
      console.log("\nPromises found:");
      for (const p of analysis.claims.promises) {
        console.log(`  - ${p.text} (confidence: ${p.confidence})`);
      }
    }

    if (analysis.claims.decisions.length > 0) {
      console.log("\nDecisions found:");
      for (const d of analysis.claims.decisions) {
        console.log(`  - ${d.text} (confidence: ${d.confidence})`);
      }
    }
  } catch (error) {
    console.error("ERROR:", error instanceof Error ? error.message : error);
    console.error("Stack:", error instanceof Error ? error.stack : "");
  }
}

main();
