import { db } from "@memorystack/db";
import { emailMessage, emailThread } from "@memorystack/db/schema";
import { eq, sql } from "drizzle-orm";

async function main() {
  const accounts = await db.query.emailAccount.findMany({
    columns: {
      id: true,
      email: true,
      provider: true,
      status: true,
    },
  });

  console.log("Email Accounts:");
  for (const acc of accounts) {
    const [threadResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(emailThread)
      .where(eq(emailThread.accountId, acc.id));

    const [messageResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(emailMessage)
      .innerJoin(emailThread, eq(emailMessage.threadId, emailThread.id))
      .where(eq(emailThread.accountId, acc.id));

    const threadCount = threadResult?.count ?? 0;
    const messageCount = messageResult?.count ?? 0;

    console.log(`- ${acc.email} (${acc.provider})`);
    console.log(`  ID: ${acc.id}`);
    console.log(`  Status: ${acc.status}`);
    console.log(`  Threads: ${threadCount}`);
    console.log(`  Messages: ${messageCount}`);
    console.log("");
  }

  process.exit(0);
}

main().catch(console.error);
