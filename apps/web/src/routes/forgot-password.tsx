import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AuthLayout, ForgotPasswordForm } from "@/components/auth";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();

  return (
    <AuthLayout
      description="Password resets are handled by your workspace admin"
      title="Reset access"
    >
      <ForgotPasswordForm onBack={() => navigate({ to: "/login" })} />
    </AuthLayout>
  );
}
