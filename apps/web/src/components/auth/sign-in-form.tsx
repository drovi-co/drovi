import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n";
import { authClient } from "@/lib/auth-client";

interface SignInFormProps {
  onSwitchToSignUp: () => void;
}

export function SignInForm({ onSwitchToSignUp }: SignInFormProps) {
  const navigate = useNavigate();
  const t = useT();
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const inviteToken =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("invite") ?? undefined)
      : undefined;

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
          rememberMe,
          inviteToken,
        },
        {
          onSuccess: () => {
            toast.success(t("auth.signIn.toastSuccess"));
            navigate({ to: "/dashboard" });
          },
          onError: (error) => {
            toast.error(
              error.error.message || t("auth.signIn.invalidCredentials")
            );
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.string().email(t("auth.validation.emailInvalid")),
        password: z.string().min(1, t("auth.validation.passwordRequired")),
      }),
    },
  });

  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <form.Field name="email">
          {(field) => (
            <div className="space-y-2">
              <Label className="text-foreground" htmlFor={field.name}>
                {t("auth.email")}
              </Label>
              <Input
                autoComplete="email"
                className={
                  field.state.meta.errors.length > 0 ? "border-destructive" : ""
                }
                id={field.name}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t("auth.placeholders.email")}
                type="email"
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

        <form.Field name="password">
          {(field) => (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-foreground" htmlFor={field.name}>
                  {t("auth.password")}
                </Label>
                <span className="text-muted-foreground text-xs">
                  {t("auth.signIn.passwordResetHint")}
                </span>
              </div>
              <div className="relative">
                <Input
                  autoComplete="current-password"
                  className={`pr-10 ${field.state.meta.errors.length > 0 ? "border-destructive" : ""}`}
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t("auth.placeholders.password")}
                  type={showPassword ? "text" : "password"}
                  value={field.state.value}
                />
                <Button
                  className="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
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

        <div className="flex items-center space-x-2">
          <Checkbox
            checked={rememberMe}
            id="remember"
            onCheckedChange={(checked) => setRememberMe(checked === true)}
          />
          <Label
            className="cursor-pointer font-normal text-muted-foreground text-sm"
            htmlFor="remember"
          >
            {t("auth.signIn.rememberMe")}
          </Label>
        </div>

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
                  {t("auth.signIn.submitting")}
                </>
              ) : (
                t("common.actions.signIn")
              )}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <p className="text-center text-muted-foreground text-sm">
        {t("auth.signIn.noAccount")}{" "}
        <button
          className="font-medium text-primary transition-colors hover:text-primary/80"
          onClick={onSwitchToSignUp}
          type="button"
        >
          {t("common.actions.signUp")}
        </button>
      </p>
    </div>
  );
}
