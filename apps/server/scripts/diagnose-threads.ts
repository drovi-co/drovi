import { db } from "@memorystack/db";
import { emailMessage, emailThread } from "@memorystack/db/schema";
import { eq, inArray } from "drizzle-orm";

async function main() {
  const accountId = "9ce21a5f-93ec-4b57-a903-d004ce8bdbd2";

  // Get thread stats by messageCount
  const threads = await db.query.emailThread.findMany({
    where: eq(emailThread.accountId, accountId),
    columns: { id: true, messageCount: true, providerThreadId: true },
  });

  // Count by messageCount value
  const byMessageCount: Record<number, number> = {};
  for (const t of threads) {
    byMessageCount[t.messageCount] = (byMessageCount[t.messageCount] || 0) + 1;
  }

  console.log("Threads by messageCount metadata:");
  for (const [count, num] of Object.entries(byMessageCount).sort(
    (a, b) => Number(a[0]) - Number(b[0])
  )) {
    console.log(`  messageCount=${count}: ${num} threads`);
  }

  // Find threads that have actual messages in DB
  const threadIdsWithMessages = await db
    .selectDistinct({ threadId: emailMessage.threadId })
    .from(emailMessage)
    .where(
      inArray(
        emailMessage.threadId,
        threads.map((t) => t.id)
      )
    );

  const withMessagesSet = new Set(threadIdsWithMessages.map((t) => t.threadId));

  // Count threads with messageCount > 0 but no actual messages
  const orphanedWithExpectedMessages = threads.filter(
    (t) => t.messageCount > 0 && !withMessagesSet.has(t.id)
  );

  // Count threads with messageCount = 0
  const threadsWithZeroCount = threads.filter((t) => t.messageCount === 0);

  console.log("\nSummary:");
  console.log(`  Total threads: ${threads.length}`);
  console.log(`  Threads with actual messages in DB: ${withMessagesSet.size}`);
  console.log(
    `  Threads with messageCount > 0 but no messages: ${orphanedWithExpectedMessages.length}`
  );
  console.log(
    `  Threads with messageCount = 0: ${threadsWithZeroCount.length}`
  );

  // Sample some orphaned threads to check
  console.log("\nSample orphaned threads (first 5):");
  for (const t of orphanedWithExpectedMessages.slice(0, 5)) {
    console.log(`  - ${t.providerThreadId} (messageCount=${t.messageCount})`);
  }

  // Sample threads with messageCount = 0
  console.log("\nSample threads with messageCount=0 (first 5):");
  for (const t of threadsWithZeroCount.slice(0, 5)) {
    console.log(`  - ${t.providerThreadId}`);
  }

  process.exit(0);
}

main().catch(console.error);
