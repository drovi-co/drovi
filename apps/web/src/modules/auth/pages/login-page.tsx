import { useAuthView } from "@memorystack/mod-auth";
import { AuthLayout, SignInForm, SignUpForm } from "@/components/auth";
import { useT } from "@/i18n";

export function LoginPage() {
  const { view, showSignIn, showSignUp } = useAuthView({
    search: typeof window === "undefined" ? "" : window.location.search,
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
        <SignInForm onSwitchToSignUp={showSignUp} />
      )}
      {view === "sign-up" && (
        <SignUpForm onSwitchToSignIn={showSignIn} />
      )}
    </AuthLayout>
  );
}
