// =============================================================================
// SSO ROUTES (SAML 2.0 & OIDC)
// =============================================================================
//
// Server-side handlers for enterprise Single Sign-On:
// - SAML 2.0 metadata endpoint
// - SAML 2.0 ACS (Assertion Consumer Service) callback
// - OIDC callback handler
// - SSO-initiated login
//

import { Hono } from "hono";
import { db } from "@memorystack/db";
import { organizationSettings, ssoIdentity, member } from "@memorystack/db/schema";
import { eq, and } from "drizzle-orm";
import { log } from "../lib/logger";

const ssoRoutes = new Hono();

// =============================================================================
// SAML 2.0 METADATA
// =============================================================================

/**
 * SAML metadata endpoint - provides SP (Service Provider) metadata
 * IdP (Identity Provider) uses this to configure the integration
 */
ssoRoutes.get("/saml/metadata/:organizationId", async (c) => {
  const organizationId = c.req.param("organizationId");

  const settings = await db.query.organizationSettings.findFirst({
    where: eq(organizationSettings.organizationId, organizationId),
  });

  if (!settings?.ssoEnabled) {
    return c.json({ error: "SSO not enabled for this organization" }, 400);
  }

  const baseUrl = new URL(c.req.url).origin;
  const acsUrl = `${baseUrl}/api/v1/sso/saml/acs/${organizationId}`;
  const entityId = `${baseUrl}/api/v1/sso/saml/metadata/${organizationId}`;

  // Generate SAML SP metadata XML
  const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     entityID="${entityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="false"
                      WantAssertionsSigned="true"
                      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                                 Location="${acsUrl}"
                                 index="0"
                                 isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;

  return c.text(metadata, 200, {
    "Content-Type": "application/xml",
  });
});

// =============================================================================
// SAML 2.0 ACS (Assertion Consumer Service)
// =============================================================================

/**
 * SAML ACS callback - receives SAML assertions from IdP
 * Validates the assertion and creates/updates the user
 */
ssoRoutes.post("/saml/acs/:organizationId", async (c) => {
  const organizationId = c.req.param("organizationId");

  try {
    const formData = await c.req.formData();
    const samlResponse = formData.get("SAMLResponse") as string;
    const relayState = formData.get("RelayState") as string | null;

    if (!samlResponse) {
      return c.json({ error: "Missing SAML response" }, 400);
    }

    // Get organization settings
    const settings = await db.query.organizationSettings.findFirst({
      where: eq(organizationSettings.organizationId, organizationId),
    });

    if (!settings?.ssoEnabled) {
      return c.json({ error: "SSO not enabled for this organization" }, 400);
    }

    // Decode and parse SAML response
    const decodedResponse = Buffer.from(samlResponse, "base64").toString("utf-8");

    // In a production implementation, you would:
    // 1. Validate the signature using the IdP's public certificate
    // 2. Check the assertion conditions (timestamps, audience)
    // 3. Extract user attributes (email, name, etc.)

    // For now, we'll extract basic info from the assertion
    // This should be replaced with a proper SAML library like saml2-js or passport-saml

    const emailMatch = decodedResponse.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
    const nameMatch = decodedResponse.match(/<saml:Attribute Name="[^"]*name[^"]*"[^>]*>[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/i);

    if (!emailMatch) {
      log.error("SAML: Could not extract email from assertion");
      return c.json({ error: "Invalid SAML response - missing email" }, 400);
    }

    const email = emailMatch[1].toLowerCase();
    const name = nameMatch ? nameMatch[1] : email.split("@")[0];

    // Find or create SSO identity
    let ssoId = await db.query.ssoIdentity.findFirst({
      where: and(
        eq(ssoIdentity.organizationId, organizationId),
        eq(ssoIdentity.email, email)
      ),
      with: { user: true },
    });

    if (!ssoId) {
      // Check if user exists and create SSO identity
      // In production, this would integrate with your auth system
      log.info(`SAML: New SSO user - ${email} for org ${organizationId}`);

      // TODO: Create user through Better Auth and link SSO identity
      // For now, return an error suggesting manual setup
      return c.redirect(`/login?error=sso_user_not_found&email=${encodeURIComponent(email)}`);
    }

    // Update last login
    await db
      .update(ssoIdentity)
      .set({ lastLoginAt: new Date() })
      .where(eq(ssoIdentity.id, ssoId.id));

    log.info(`SAML: Successful login for ${email}`);

    // Redirect to the app with a session token
    // In production, you'd create a session through Better Auth
    const redirectUrl = relayState || "/dashboard";
    return c.redirect(redirectUrl);

  } catch (error) {
    log.error("SAML ACS error:", error);
    return c.redirect("/login?error=sso_error");
  }
});

// =============================================================================
// SSO-INITIATED LOGIN
// =============================================================================

/**
 * SSO login initiation - redirects to IdP for authentication
 */
ssoRoutes.get("/login/:organizationId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const returnTo = c.req.query("returnTo") || "/dashboard";

  const settings = await db.query.organizationSettings.findFirst({
    where: eq(organizationSettings.organizationId, organizationId),
  });

  if (!settings?.ssoEnabled) {
    return c.json({ error: "SSO not enabled for this organization" }, 400);
  }

  if (!settings.ssoEntityId || !settings.ssoSignOnUrl) {
    return c.json({ error: "SSO not configured" }, 400);
  }

  // For SAML, construct an AuthnRequest
  const baseUrl = new URL(c.req.url).origin;
  const acsUrl = `${baseUrl}/api/v1/sso/saml/acs/${organizationId}`;
  const entityId = `${baseUrl}/api/v1/sso/saml/metadata/${organizationId}`;
  const requestId = `_${crypto.randomUUID()}`;

  // Build SAML AuthnRequest
  const authnRequest = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                    ID="${requestId}"
                    Version="2.0"
                    IssueInstant="${new Date().toISOString()}"
                    Destination="${settings.ssoSignOnUrl}"
                    AssertionConsumerServiceURL="${acsUrl}">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${entityId}</saml:Issuer>
</samlp:AuthnRequest>`;

  // Encode the request
  const encodedRequest = Buffer.from(authnRequest).toString("base64");

  // Build redirect URL
  const ssoUrl = new URL(settings.ssoSignOnUrl);
  ssoUrl.searchParams.set("SAMLRequest", encodedRequest);
  ssoUrl.searchParams.set("RelayState", returnTo);

  return c.redirect(ssoUrl.toString());
});

// =============================================================================
// OIDC CALLBACK
// =============================================================================

/**
 * OIDC callback handler - receives authorization code from IdP
 */
ssoRoutes.get("/oidc/callback/:organizationId", async (c) => {
  const organizationId = c.req.param("organizationId");
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    log.error(`OIDC error: ${error} - ${c.req.query("error_description")}`);
    return c.redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return c.json({ error: "Missing authorization code" }, 400);
  }

  try {
    const settings = await db.query.organizationSettings.findFirst({
      where: eq(organizationSettings.organizationId, organizationId),
    });

    if (!settings?.ssoEnabled || settings.ssoProvider === null) {
      return c.json({ error: "OIDC not enabled for this organization" }, 400);
    }

    // Exchange code for tokens
    // This would need the OIDC configuration (token endpoint, client_id, client_secret)
    // For production, use a library like openid-client

    const baseUrl = new URL(c.req.url).origin;
    const redirectUri = `${baseUrl}/api/v1/sso/oidc/callback/${organizationId}`;

    // TODO: Implement token exchange with IdP
    // const tokenResponse = await fetch(settings.oidcTokenEndpoint, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //   body: new URLSearchParams({
    //     grant_type: 'authorization_code',
    //     code,
    //     redirect_uri: redirectUri,
    //     client_id: settings.oidcClientId,
    //     client_secret: settings.oidcClientSecret,
    //   }),
    // });

    // For now, redirect with error
    log.info(`OIDC callback received for org ${organizationId}`);
    return c.redirect("/login?error=oidc_not_implemented");

  } catch (error) {
    log.error("OIDC callback error:", error);
    return c.redirect("/login?error=sso_error");
  }
});

// =============================================================================
// SSO STATUS CHECK
// =============================================================================

/**
 * Check SSO configuration status for an organization
 */
ssoRoutes.get("/status/:organizationId", async (c) => {
  const organizationId = c.req.param("organizationId");

  const settings = await db.query.organizationSettings.findFirst({
    where: eq(organizationSettings.organizationId, organizationId),
    columns: {
      ssoEnabled: true,
      ssoProvider: true,
      ssoEntityId: true,
    },
  });

  if (!settings) {
    return c.json({ enabled: false });
  }

  return c.json({
    enabled: settings.ssoEnabled ?? false,
    provider: settings.ssoProvider,
    configured: Boolean(settings.ssoEntityId),
  });
});

export { ssoRoutes };
