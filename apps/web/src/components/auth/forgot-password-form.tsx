import { Button } from "@memorystack/ui-core/button";
import { Input } from "@memorystack/ui-core/input";
import { Label } from "@memorystack/ui-core/label";
import { useForm } from "@tanstack/react-form";
import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useT } from "@/i18n";
import { authClient } from "@/lib/auth-client";

interface ForgotPasswordFormProps {
  onBack: () => void;
}

export function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
  const t = useT();
  const [submitted, setSubmitted] = useState(false);
  const [debugResetLink, setDebugResetLink] = useState<string | null>(null);
  const [debugResetToken, setDebugResetToken] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: "",
    },
    validators: {
      onSubmit: z.object({
        email: z.string().email("Enter a valid email address"),
      }),
    },
    onSubmit: async ({ value }) => {
      const result = await authClient.resetPassword(value.email);
      if (result.error) {
        toast.error(result.error.message);
        return;
      }

      setSubmitted(true);
      setDebugResetLink(result.data?.resetLink ?? null);
      setDebugResetToken(result.data?.resetToken ?? null);
      toast.success("If your account exists, reset instructions were sent.");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center space-y-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <h2 className="font-semibold text-foreground text-xl">
          {t("auth.passwordReset.forgot.title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("auth.passwordReset.forgot.description")}
        </p>
      </div>

      {submitted ? (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <p className="text-muted-foreground">
            Check your inbox for a reset link. If you do not receive it, verify
            the email and try again.
          </p>
          {debugResetLink ? (
            <a
              className="break-all font-medium text-primary underline"
              href={debugResetLink}
            >
              Open reset link (development)
            </a>
          ) : null}
          {debugResetToken ? (
            <p className="break-all text-muted-foreground text-xs">
              Token (development): {debugResetToken}
            </p>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <form.Field name="email">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Email</Label>
                <Input
                  autoComplete="email"
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
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
                    Sending...
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            )}
          </form.Subscribe>
        </form>
      )}

      <Button className="w-full" onClick={onBack} variant="outline">
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("auth.passwordReset.backToSignIn")}
      </Button>
    </div>
  );
}
