export interface AuthModulePolicy {
  allowSignIn: boolean;
  allowSignUp: boolean;
  allowPasswordReset: boolean;
  allowedEmailDomain: string | null;
  postLoginRedirect: string;
}

export interface AuthActionContext {
  action: "sign_in" | "sign_up" | "forgot_password" | "reset_password";
  email?: string | null;
}

export function defaultAuthModulePolicy(): AuthModulePolicy {
  return {
    allowSignIn: true,
    allowSignUp: true,
    allowPasswordReset: true,
    allowedEmailDomain: null,
    postLoginRedirect: "/dashboard",
  };
}

export function mergeAuthModulePolicy(
  base: AuthModulePolicy,
  override?: Partial<AuthModulePolicy>
): AuthModulePolicy {
  return {
    ...base,
    ...(override ?? {}),
  };
}

function emailDomain(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) {
    return null;
  }
  return parts[1] || null;
}

export function isAuthActionAllowed(
  policy: AuthModulePolicy,
  context: AuthActionContext
): boolean {
  if (context.action === "sign_in" && !policy.allowSignIn) {
    return false;
  }
  if (context.action === "sign_up" && !policy.allowSignUp) {
    return false;
  }
  if (
    (context.action === "forgot_password" ||
      context.action === "reset_password") &&
    !policy.allowPasswordReset
  ) {
    return false;
  }

  if (!policy.allowedEmailDomain) {
    return true;
  }

  const domain = emailDomain(context.email);
  return domain === policy.allowedEmailDomain.toLowerCase();
}

export function resolvePostLoginRedirect(
  policy: AuthModulePolicy,
  fallback = "/dashboard"
): string {
  const value = policy.postLoginRedirect.trim();
  if (!value) {
    return fallback;
  }
  if (!value.startsWith("/")) {
    return fallback;
  }
  return value;
}
