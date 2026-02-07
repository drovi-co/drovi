import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import {
  AuthLayout,
  SignInForm,
  SignUpForm,
} from "@/components/auth";
import { useAuthStore } from "@/lib/auth";

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
  const [view, setView] = useState<AuthView>("sign-in");

  const getTitle = () => {
    switch (view) {
      case "sign-in":
        return "Welcome back";
      case "sign-up":
        return "Create an account";
    }
  };

  const getDescription = () => {
    switch (view) {
      case "sign-in":
        return "Enter your credentials to access your account";
      case "sign-up":
        return "Get started with your free account today";
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
