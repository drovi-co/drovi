import { Button } from "@memorystack/ui-core/button";
import { Input } from "@memorystack/ui-core/input";
import { Label } from "@memorystack/ui-core/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useT } from "@/i18n";
import { authClient } from "@/lib/auth-client";

interface ResetPasswordFormProps {
  initialToken?: string;
}

export function ResetPasswordForm({ initialToken }: ResetPasswordFormProps) {
  const navigate = useNavigate();
  const t = useT();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const form = useForm({
    defaultValues: {
      token: initialToken ?? "",
      newPassword: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: z
        .object({
          token: z.string().min(1, "Reset token is required"),
          newPassword: z
            .string()
            .min(8, "Password must be at least 8 characters"),
          confirmPassword: z.string().min(1, "Please confirm your password"),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: "Passwords do not match",
          path: ["confirmPassword"],
        }),
    },
    onSubmit: async ({ value }) => {
      const result = await authClient.confirmPasswordReset({
        token: value.token,
        newPassword: value.newPassword,
      });
      if (result.error) {
        toast.error(result.error.message);
        return;
      }

      toast.success("Password reset complete. Sign in with your new password.");
      navigate({ to: "/login" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center space-y-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <ShieldAlert className="h-6 w-6 text-amber-500" />
        </div>
        <h2 className="font-semibold text-foreground text-xl">
          {t("auth.passwordReset.reset.title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("auth.passwordReset.reset.description")}
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
      >
        <form.Field name="token">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Reset token</Label>
              <Input
                autoComplete="off"
                id={field.name}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="Paste your reset token"
                type="text"
                value={field.state.value}
              />
              {field.state.meta.errors.map((error) => (
                <p className="text-destructive text-sm" key={error?.message}>
                  {error?.message}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <form.Field name="newPassword">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>New password</Label>
              <div className="relative">
                <Input
                  autoComplete="new-password"
                  className="pr-10"
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Enter a new password"
                  type={showPassword ? "text" : "password"}
                  value={field.state.value}
                />
                <Button
                  className="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword((prev) => !prev)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              {field.state.meta.errors.map((error) => (
                <p className="text-destructive text-sm" key={error?.message}>
                  {error?.message}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <form.Field name="confirmPassword">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Confirm password</Label>
              <div className="relative">
                <Input
                  autoComplete="new-password"
                  className="pr-10"
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Re-enter your new password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={field.state.value}
                />
                <Button
                  className="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              {field.state.meta.errors.map((error) => (
                <p className="text-destructive text-sm" key={error?.message}>
                  {error?.message}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <form.Subscribe>
          {(state) => (
            <Button
              className="w-full"
              disabled={state.isSubmitting}
              type="submit"
            >
              {state.isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                "Reset password"
              )}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <Button onClick={() => navigate({ to: "/login" })} variant="outline">
        {t("auth.passwordReset.backToSignIn")}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
