import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { AuthLayout, ResetPasswordForm } from "@/components/auth";
import { useT } from "@/i18n";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  validateSearch: searchSchema,
});

function ResetPasswordPage() {
  const t = useT();
  return (
    <AuthLayout
      description={t("auth.passwordReset.layoutDescription")}
      title={t("auth.passwordReset.layoutTitle")}
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}
