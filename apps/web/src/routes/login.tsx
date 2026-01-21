import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useSearch } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  AuthLayout,
  MagicLinkForm,
  SignInForm,
  SignUpForm,
} from "@/components/auth";
import Loader from "@/components/loader";
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

// Storage key for invite code
const INVITE_CODE_KEY = "drovi_invite_code";

export function storeInviteCode(code: string) {
  sessionStorage.setItem(INVITE_CODE_KEY, code);
}

export function getStoredInviteCode(): string | null {
  return sessionStorage.getItem(INVITE_CODE_KEY);
}

export function clearStoredInviteCode() {
  sessionStorage.removeItem(INVITE_CODE_KEY);
}

function LoginPage() {
  const { code } = useSearch({ from: "/login" });
  const [view, setView] = useState<AuthView>("sign-in");
  const { isPending } = authClient.useSession();
  const trpc = useTRPC();

  // Validate invite code if present
  const {
    data: codeValidation,
    isPending: isValidating,
    isError,
  } = useQuery({
    ...trpc.waitlist.validateCode.queryOptions({ code: code ?? "" }),
    enabled: !!code,
  });

  // Store valid invite code for use after OAuth
  useEffect(() => {
    if (code && codeValidation?.valid) {
      storeInviteCode(code);
      // Auto-switch to sign-up view for invited users
      setView("sign-up");
    }
  }, [code, codeValidation?.valid]);

  if (isPending || (code && isValidating)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader />
      </div>
    );
  }

  // Show invalid code error
  const showInvalidCode =
    code && !isValidating && (!codeValidation?.valid || isError);

  const getTitle = () => {
    // Special title for invited users
    if (code && codeValidation?.valid) {
      return "You're invited!";
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
    if (code && codeValidation?.valid && "name" in codeValidation) {
      return `Welcome ${codeValidation.name}! Create your account to get started with Drovi.`;
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
      {view === "sign-up" && (
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
