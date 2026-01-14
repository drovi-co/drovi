import { checkout, polar, portal } from "@polar-sh/better-auth";
import { db } from "@memorystack/db";
import * as schema from "@memorystack/db/schema";
import { InvitationEmail, sendEmail } from "@memorystack/email";
import { env } from "@memorystack/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { organization } from "better-auth/plugins/organization";
import { AuditActions, createAuditLog } from "./lib/audit";
import { onboardNewUser } from "./lib/onboarding";
import { isPolarConfigured, polarClient } from "./lib/payments";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  trustedOrigins: [env.CORS_ORIGIN],
  appName: "MemoryStack",
  // MEMORYSTACK: Disable email/password - OAuth only
  emailAndPassword: {
    enabled: false,
  },
  // Audit logging hooks
  databaseHooks: {
    user: {
      create: {
        after: async (user: {
          id: string;
          email: string;
          name: string | null;
        }) => {
          // MEMORYSTACK: Create first org and connect email account on signup
          await onboardNewUser(user);

          await createAuditLog({
            userId: user.id,
            action: AuditActions.USER_CREATED,
            resource: "user",
            resourceId: user.id,
            level: "info",
            metadata: {
              email: user.email,
              name: user.name,
            },
          });
        },
      },
    },
    session: {
      create: {
        after: async (session: {
          id: string;
          userId: string;
          userAgent?: string | null;
          ipAddress?: string | null;
        }) => {
          await createAuditLog({
            userId: session.userId,
            action: AuditActions.USER_LOGIN,
            resource: "session",
            resourceId: session.id,
            level: "info",
            metadata: {
              userAgent: session.userAgent,
              ipAddress: session.ipAddress,
            },
            ipAddress: session.ipAddress ?? undefined,
            userAgent: session.userAgent ?? undefined,
          });
        },
      },
    },
    organization: {
      create: {
        after: async (org: { id: string; name: string; slug: string }) => {
          // Credits are initialized lazily when first accessed via getOrCreateOrgCredits

          await createAuditLog({
            organizationId: org.id,
            action: AuditActions.ORGANIZATION_CREATED,
            resource: "organization",
            resourceId: org.id,
            level: "info",
            metadata: {
              name: org.name,
              slug: org.slug,
            },
          });
        },
      },
    },
    member: {
      create: {
        after: async (member: {
          id: string;
          organizationId: string;
          userId: string;
          role: string;
        }) => {
          await createAuditLog({
            organizationId: member.organizationId,
            userId: member.userId,
            action: AuditActions.MEMBER_JOINED,
            resource: "member",
            resourceId: member.id,
            level: "info",
            metadata: {
              role: member.role,
            },
          });
        },
      },
    },
    invitation: {
      create: {
        after: async (invitation: {
          id: string;
          organizationId: string;
          inviterId: string;
          email: string;
          role: string;
        }) => {
          await createAuditLog({
            organizationId: invitation.organizationId,
            userId: invitation.inviterId,
            action: AuditActions.INVITATION_SENT,
            resource: "invitation",
            resourceId: invitation.id,
            level: "info",
            metadata: {
              email: invitation.email,
              role: invitation.role,
            },
          });
        },
      },
    },
  },
  // Disable rate limiting in development, use permissive limits in production
  rateLimit: env.NODE_ENV === "development"
    ? { enabled: false }
    : {
        window: 60, // 60 seconds
        max: 100, // 100 requests per window
        customRules: {
          "/sign-in/*": {
            window: 60,
            max: 10,
          },
          "/sign-up/*": {
            window: 60,
            max: 10,
          },
          "/magic-link/*": {
            window: 60,
            max: 10,
          },
          "/forgot-password/*": {
            window: 60,
            max: 5,
          },
        },
      },
  // MEMORYSTACK: OAuth-only authentication with Google and Microsoft
  // These same credentials are used for email access (Gmail/Outlook)
  socialProviders: {
    // Google (for Gmail users)
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Request full Gmail access during auth for email intelligence + drafting
            scope: [
              "openid",
              "email",
              "profile",
              "https://www.googleapis.com/auth/gmail.modify",
              "https://www.googleapis.com/auth/gmail.send",
              "https://www.googleapis.com/auth/gmail.compose",
            ],
            // Get refresh token for background email sync
            accessType: "offline",
            prompt: "consent",
          },
        }
      : {}),
    // Microsoft (for Outlook users)
    ...((env.MICROSOFT_CLIENT_ID || env.OUTLOOK_CLIENT_ID) &&
    (env.MICROSOFT_CLIENT_SECRET || env.OUTLOOK_CLIENT_SECRET)
      ? {
          microsoft: {
            clientId: env.MICROSOFT_CLIENT_ID || env.OUTLOOK_CLIENT_ID || "",
            clientSecret:
              env.MICROSOFT_CLIENT_SECRET || env.OUTLOOK_CLIENT_SECRET || "",
            tenantId: env.MICROSOFT_TENANT_ID || env.OUTLOOK_TENANT_ID,
            // Request full Outlook access during auth for email intelligence + drafting
            scope: [
              "openid",
              "email",
              "profile",
              "offline_access",
              "Mail.ReadWrite",
              "Mail.Send",
              "MailboxSettings.Read",
              "User.Read",
            ],
          },
        }
      : {}),
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  plugins: [
    // Organization & multi-tenancy
    organization({
      ac,
      roles: {
        owner: roles.owner,
        admin: roles.admin,
        member: roles.member,
        viewer: roles.viewer,
      },
      teams: {
        enabled: true,
        maximumTeams: 10,
        allowRemovingAllTeams: false,
      },
      async sendInvitationEmail(data) {
        const inviteLink = `${env.CORS_ORIGIN}/invite/${data.id}`;
        await sendEmail({
          to: data.email,
          subject: `You've been invited to join ${data.organization.name}`,
          template: InvitationEmail({
            inviterName: data.inviter.user.name ?? "A team member",
            organizationName: data.organization.name,
            role: data.role,
            inviteLink,
          }),
        });
      },
    }),
    // Admin capabilities
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    // MEMORYSTACK: Removed magicLink and twoFactor - OAuth only authentication
    // Polar payments (only if configured)
    ...(isPolarConfigured && polarClient
      ? [
          polar({
            client: polarClient,
            createCustomerOnSignUp: true,
            enableCustomerPortal: true,
            use: [
              checkout({
                products: env.POLAR_PRODUCT_ID
                  ? [
                      {
                        productId: env.POLAR_PRODUCT_ID,
                        slug: "pro",
                      },
                    ]
                  : [],
                successUrl:
                  env.POLAR_SUCCESS_URL || `${env.CORS_ORIGIN}/billing/success`,
                authenticatedUsersOnly: true,
              }),
              portal(),
            ],
          }),
        ]
      : []),
  ],
});

// Export types for use in other packages
export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
