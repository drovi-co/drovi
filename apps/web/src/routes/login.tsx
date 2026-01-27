import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useSearch } from "@tanstack/react-router";
import { ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  AuthLayout,
  MagicLinkForm,
  SignInForm,
  SignUpForm,
} from "@/components/auth";
import Loader from "@/components/loader";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

const searchSchema = z.object({
  code: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  component: LoginPage,
  validateSearch: searchSchema,
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session.data?.user) {
      throw redirect({ to: "/dashboard" });
    }
  },
});

type AuthView = "sign-in" | "sign-up" | "magic-link";

// Cookie name for invite code (survives OAuth redirect)
const INVITE_CODE_COOKIE = "drovi_invite_code";

/**
 * Store invite code in a cookie (survives OAuth redirect)
 */
export function storeInviteCode(code: string) {
  // Set cookie with 1 hour expiry (enough time for OAuth flow)
  document.cookie = `${INVITE_CODE_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=3600; SameSite=Lax`;
}

/**
 * Get stored invite code from cookie
 */
export function getStoredInviteCode(): string | null {
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === INVITE_CODE_COOKIE && value) {
      return decodeURIComponent(value);
    }
  }
  return null;
}

/**
 * Clear stored invite code
 */
export function clearStoredInviteCode() {
  document.cookie = `${INVITE_CODE_COOKIE}=; path=/; max-age=0`;
}

function LoginPage() {
  const { code } = useSearch({ from: "/login" });
  const [view, setView] = useState<AuthView>("sign-in");
  const { isPending } = authClient.useSession();
  const trpc = useTRPC();

  // Check for stored invite code (from previous visit)
  const storedCode =
    typeof window !== "undefined" ? getStoredInviteCode() : null;
  const effectiveCode = code ?? storedCode;

  // Validate invite code if present
  const {
    data: codeValidation,
    isPending: isValidating,
    isError,
  } = useQuery({
    ...trpc.waitlist.validateCode.queryOptions({ code: effectiveCode ?? "" }),
    enabled: !!effectiveCode,
  });

  // Store valid invite code for use after OAuth
  useEffect(() => {
    if (code && codeValidation?.valid) {
      storeInviteCode(code);
      // Auto-switch to sign-up view for invited users
      setView("sign-up");
    }
  }, [code, codeValidation?.valid]);

  if (isPending || (effectiveCode && isValidating)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  // Show invalid code error
  const showInvalidCode =
    code && !isValidating && (!codeValidation?.valid || isError);

  // Check if user needs an invite code (no valid code stored)
  const hasValidInviteCode = effectiveCode && codeValidation?.valid;
  const needsInviteCode = !hasValidInviteCode;

  const getTitle = () => {
    // Special title for invited users
    if (hasValidInviteCode) {
      return "You're invited!";
    }
    // Invite-only message for new users
    if (view === "sign-up" && needsInviteCode) {
      return "Invite Only";
    }
    switch (view) {
      case "sign-in":
        return "Welcome back";
      case "sign-up":
        return "Create an account";
      case "magic-link":
        return "Sign in with magic link";
    }
  };

  const getDescription = () => {
    // Special description for invited users
    if (hasValidInviteCode && codeValidation && "name" in codeValidation) {
      return `Welcome ${codeValidation.name}! Create your account to get started with Drovi.`;
    }
    // Invite-only message for new users
    if (view === "sign-up" && needsInviteCode) {
      return "Drovi is currently invite-only. Join our waitlist to request access.";
    }
    switch (view) {
      case "sign-in":
        return "Enter your credentials to access your account";
      case "sign-up":
        return "Get started with your free account today";
      case "magic-link":
        return "We'll send you a link to sign in instantly";
    }
  };

  return (
    <AuthLayout description={getDescription()} title={getTitle()}>
      {/* Invalid code banner */}
      {showInvalidCode && (
        <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="font-medium text-destructive text-sm">
            {codeValidation && "reason" in codeValidation
              ? codeValidation.reason
              : "Invalid or expired invite code"}
          </p>
          <p className="mt-1 text-muted-foreground text-sm">
            Please check your invite code or request a new one.
          </p>
        </div>
      )}

      {/* Valid code banner */}
      {code && codeValidation?.valid && (
        <div className="mb-6 rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20">
              <Sparkles className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="font-medium text-emerald-400 text-sm">
                Invite code accepted
              </p>
              <p className="text-muted-foreground text-xs">
                Sign up with any method below to activate your account
              </p>
            </div>
          </div>
        </div>
      )}

      {view === "sign-in" && (
        <SignInForm
          onSwitchToMagicLink={() => setView("magic-link")}
          onSwitchToSignUp={() => setView("sign-up")}
        />
      )}
      {view === "sign-up" && needsInviteCode && (
        <div className="space-y-6">
          {/* Invite-only notice */}
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-500" />
              <div>
                <p className="font-medium text-amber-400 text-sm">
                  Private Beta
                </p>
                <p className="mt-1 text-muted-foreground text-sm">
                  Drovi is currently available by invitation only. Join our
                  waitlist to request early access.
                </p>
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => window.open("https://drovi.co", "_blank")}
          >
            Join the Waitlist
          </Button>

          <p className="text-center text-muted-foreground text-sm">
            Already have an invite code?{" "}
            <a
              className="font-medium text-primary transition-colors hover:text-primary/80"
              href="/login?code="
            >
              Enter it here
            </a>
          </p>

          <p className="text-center text-muted-foreground text-sm">
            Already have an account?{" "}
            <button
              className="font-medium text-primary transition-colors hover:text-primary/80"
              onClick={() => setView("sign-in")}
              type="button"
            >
              Sign in
            </button>
          </p>
        </div>
      )}
      {view === "sign-up" && hasValidInviteCode && (
        <SignUpForm
          defaultEmail={
            codeValidation?.valid && "email" in codeValidation
              ? codeValidation.email
              : undefined
          }
          defaultName={
            codeValidation?.valid && "name" in codeValidation
              ? codeValidation.name
              : undefined
          }
          onSwitchToSignIn={() => setView("sign-in")}
        />
      )}
      {view === "magic-link" && (
        <MagicLinkForm onBack={() => setView("sign-in")} />
      )}
    </AuthLayout>
  );
}
