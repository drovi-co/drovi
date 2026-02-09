import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  AuthLayout,
  SignInForm,
  SignUpForm,
} from "@/components/auth";
import { useAuthStore } from "@/lib/auth";
import { useT } from "@/i18n";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  beforeLoad: async () => {
    const store = useAuthStore.getState();
    if (!store.user) {
      await store.checkAuth();
    }
    const user = useAuthStore.getState().user;
    if (user) {
      throw redirect({ to: "/dashboard" });
    }
  },
});

type AuthView = "sign-in" | "sign-up";

function LoginPage() {
  const [view, setView] = useState<AuthView>(() => {
    if (typeof window === "undefined") return "sign-in";
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const invite = params.get("invite");
    if (mode === "sign-up" || invite) return "sign-up";
    return "sign-in";
  });
  const t = useT();

  const getTitle = () => {
    switch (view) {
      case "sign-in":
        return t("auth.signInTitle");
      case "sign-up":
        return t("auth.signUpTitle");
    }
  };

  const getDescription = () => {
    switch (view) {
      case "sign-in":
        return t("auth.signInDescription");
      case "sign-up":
        return t("auth.signUpDescription");
    }
  };

  return (
    <AuthLayout description={getDescription()} title={getTitle()}>
      {view === "sign-in" && (
        <SignInForm
          onSwitchToSignUp={() => setView("sign-up")}
        />
      )}
      {view === "sign-up" && (
        <SignUpForm
          onSwitchToSignIn={() => setView("sign-in")}
        />
      )}
    </AuthLayout>
  );
}
