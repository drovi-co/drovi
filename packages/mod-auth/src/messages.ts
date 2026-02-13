import type { ModuleI18nNamespace } from "@memorystack/mod-kit";

export const MOD_AUTH_NAMESPACE = "mod_auth";

export const modAuthMessages: Record<string, string> = {
  "auth.title": "Authentication",
  "auth.signIn": "Sign in",
  "auth.signUp": "Sign up",
  "auth.forgotPassword": "Forgot password",
  "auth.resetPassword": "Reset password",
  "auth.policy.blocked": "Authentication action is blocked by policy.",
};

export const modAuthI18n: ModuleI18nNamespace = {
  namespace: MOD_AUTH_NAMESPACE,
  defaultLocale: "en",
  messages: modAuthMessages,
};
