// import { polarClient } from "@polar-sh/better-auth";
import { env } from "@memorystack/env/web";
import {
  adminClient,
  magicLinkClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ac, roles } from "./permissions";

export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  plugins: [
    // Polar client disabled - enable when POLAR_ACCESS_TOKEN is configured on server
    // ...(env.VITE_POLAR_ENABLED ? [polarClient()] : []),
    organizationClient({
      ac,
      roles: {
        owner: roles.owner,
        admin: roles.admin,
        member: roles.member,
        viewer: roles.viewer,
      },
      teams: {
        enabled: true,
      },
    }),
    adminClient(),
    magicLinkClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/verify-2fa";
      },
    }),
  ],
});

// Export useful hooks and utilities
export const {
  useSession,
  signIn,
  signUp,
  signOut,
  useActiveOrganization,
  useListOrganizations,
} = authClient;
