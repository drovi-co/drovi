import type { DroviModule } from "@memorystack/mod-kit";
import { MOD_AUTH_NAMESPACE, modAuthI18n } from "./messages";
import {
  type AuthModulePolicy,
  defaultAuthModulePolicy,
  mergeAuthModulePolicy,
} from "./policy";

export interface CreateAuthModuleOptions {
  policy?: Partial<AuthModulePolicy>;
}

export function createAuthModule(
  options?: CreateAuthModuleOptions
): DroviModule {
  const policy = mergeAuthModulePolicy(
    defaultAuthModulePolicy(),
    options?.policy
  );

  return {
    id: "mod-auth",
    title: "Authentication",
    capabilities: ["auth.sign_in", "auth.sign_up", "auth.password_reset"],
    routes: [
      { id: "auth.login", path: "/login", slot: "auth" },
      { id: "auth.forgot", path: "/forgot-password", slot: "auth" },
      { id: "auth.reset", path: "/reset-password", slot: "auth" },
    ],
    commands: [
      {
        id: "auth.open_login",
        title: "Open login",
        action: "auth.open_login",
        requiresCapability: "auth.sign_in",
      },
    ],
    i18n: {
      namespaces: [modAuthI18n],
    },
    uiHints: {
      namespace: MOD_AUTH_NAMESPACE,
      policy,
      postLoginRedirect: policy.postLoginRedirect,
    },
  };
}
