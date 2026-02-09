import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AuthLayout, ForgotPasswordForm } from "@/components/auth";
import { useT } from "@/i18n";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const t = useT();

  return (
    <AuthLayout
      description={t("auth.passwordReset.layoutDescription")}
      title={t("auth.passwordReset.layoutTitle")}
    >
      <ForgotPasswordForm onBack={() => navigate({ to: "/login" })} />
    </AuthLayout>
  );
}
