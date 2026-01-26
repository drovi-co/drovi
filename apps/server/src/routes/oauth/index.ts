// =============================================================================
// OAUTH ROUTES INDEX
// =============================================================================

import { Hono } from "hono";
import { gmailOAuth } from "./gmail";
import { googleDocsOAuth } from "./google-docs";
import { hubspotOAuth } from "./hubspot";
import { notionOAuth } from "./notion";
import { outlookOAuth } from "./outlook";
import { salesforceOAuth } from "./salesforce";
import { slackOAuth } from "./slack";
import { whatsappOAuth } from "./whatsapp";

const oauthRoutes = new Hono();

// Mount provider-specific OAuth routes
oauthRoutes.route("/gmail", gmailOAuth);
oauthRoutes.route("/outlook", outlookOAuth);
oauthRoutes.route("/slack", slackOAuth);
oauthRoutes.route("/whatsapp", whatsappOAuth);
oauthRoutes.route("/notion", notionOAuth);
oauthRoutes.route("/google-docs", googleDocsOAuth);

// CRM OAuth routes
oauthRoutes.route("/salesforce", salesforceOAuth);
oauthRoutes.route("/hubspot", hubspotOAuth);

export { oauthRoutes };
