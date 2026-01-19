// =============================================================================
// OAUTH ROUTES INDEX
// =============================================================================

import { Hono } from "hono";
import { gmailOAuth } from "./gmail";
import { outlookOAuth } from "./outlook";
import { slackOAuth } from "./slack";
import { whatsappOAuth } from "./whatsapp";
import { notionOAuth } from "./notion";
import { googleDocsOAuth } from "./google-docs";

const oauthRoutes = new Hono();

// Mount provider-specific OAuth routes
oauthRoutes.route("/gmail", gmailOAuth);
oauthRoutes.route("/outlook", outlookOAuth);
oauthRoutes.route("/slack", slackOAuth);
oauthRoutes.route("/whatsapp", whatsappOAuth);
oauthRoutes.route("/notion", notionOAuth);
oauthRoutes.route("/google-docs", googleDocsOAuth);

export { oauthRoutes };
