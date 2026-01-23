import { protectedProcedure, publicProcedure, router } from "../index";
import { adminRouter } from "./admin";
import { apiKeysRouter } from "./api-keys";
import { auditRouter } from "./audit";
import { calendarRouter } from "./calendar";
import { commitmentsRouter } from "./commitments";
import { composeRouter } from "./compose";
import { contactsRouter } from "./contacts";
import { creditsRouter } from "./credits";
import { decisionsRouter } from "./decisions";
import { draftsRouter } from "./drafts";
import { emailAccountsRouter } from "./email-accounts";
import { emailSyncRouter } from "./email-sync";
import { featureFlagsRouter } from "./feature-flags";
import { feedbackRouter } from "./feedback";
import { graphRouter } from "./graph";
import { notificationsRouter } from "./notifications";
import { organizationsRouter } from "./organizations";
import { riskRouter } from "./risk";
import { searchRouter } from "./search";
import { sourcesRouter } from "./sources";
import { tasksRouter } from "./tasks";
import { threadsRouter } from "./threads";
import { triageRouter } from "./triage";
import { uioRouter } from "./uio";
import { unifiedInboxRouter } from "./unified-inbox";
import { unifiedObjectsRouter } from "./unified-objects";
import { uploadsRouter } from "./uploads";
import { userRouter } from "./user";
import { waitlistRouter } from "./waitlist";
import { webhooksRouter } from "./webhooks";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  // Audit logs
  audit: auditRouter,
  // Calendar API (Google Calendar & Outlook)
  calendar: calendarRouter,
  // Email accounts management (MEMORYSTACK)
  emailAccounts: emailAccountsRouter,
  // Email sync control (MEMORYSTACK)
  emailSync: emailSyncRouter,
  // Thread intelligence API (MEMORYSTACK PRD-03)
  threads: threadsRouter,
  // Commitments API (MEMORYSTACK PRD-04)
  commitments: commitmentsRouter,
  // Decisions API (MEMORYSTACK PRD-04)
  decisions: decisionsRouter,
  // Contacts API (MEMORYSTACK PRD-05)
  contacts: contactsRouter,
  // Search & Knowledge API (MEMORYSTACK PRD-06)
  search: searchRouter,
  // Multi-Source Intelligence API (MEMORYSTACK PRD-12)
  sources: sourcesRouter,
  // Task Management API (Linear-style tasks)
  tasks: tasksRouter,
  // Triage & Routing API (MEMORYSTACK PRD-07)
  triage: triageRouter,
  // Drafts API (MEMORYSTACK PRD-08)
  drafts: draftsRouter,
  // Email Compose/Send API
  compose: composeRouter,
  // Risk & Policy API (MEMORYSTACK PRD-09)
  risk: riskRouter,
  // Unified Inbox API (Multi-Source Smart Inbox)
  unifiedInbox: unifiedInboxRouter,
  // Unified Intelligence Objects API (Cross-Source UIOs)
  unifiedObjects: unifiedObjectsRouter,
  // UIO Router - Single API for all intelligence types (commitments, decisions, etc.)
  uio: uioRouter,
  // User Feedback API (accuracy tracking)
  feedback: feedbackRouter,
  // Knowledge Graph API (visualization & queries)
  graph: graphRouter,
  // Credits management
  credits: creditsRouter,
  // User operations (profile, data export)
  user: userRouter,
  // API keys management
  apiKeys: apiKeysRouter,
  // Webhooks management
  webhooks: webhooksRouter,
  // Feature flags
  featureFlags: featureFlagsRouter,
  // File uploads
  uploads: uploadsRouter,
  // In-app notifications
  notifications: notificationsRouter,
  // Organizations management
  organizations: organizationsRouter,
  // Admin operations
  admin: adminRouter,
  // Waitlist management (public + admin)
  waitlist: waitlistRouter,
});

export type AppRouter = typeof appRouter;
