import { useForm } from "@tanstack/react-form";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/i18n";

// Password validation regex patterns
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const NUMBER_REGEX = /[0-9]/;
const SPECIAL_CHAR_REGEX = /[^A-Za-z0-9]/;

interface SignUpFormProps {
  onSwitchToSignIn: () => void;
  defaultEmail?: string;
  defaultName?: string;
}

// Password strength calculation
function calculatePasswordStrength(password: string): {
  score: number;
  requirements: { key: string; met: boolean }[];
} {
  const requirements = [
    { key: "auth.passwordRequirements.minChars", met: password.length >= 8 },
    { key: "auth.passwordRequirements.uppercase", met: UPPERCASE_REGEX.test(password) },
    { key: "auth.passwordRequirements.lowercase", met: LOWERCASE_REGEX.test(password) },
    { key: "auth.passwordRequirements.number", met: NUMBER_REGEX.test(password) },
    {
      key: "auth.passwordRequirements.special",
      met: SPECIAL_CHAR_REGEX.test(password),
    },
  ];

  const score = requirements.filter((r) => r.met).length * 20;
  return { score, requirements };
}

function getStrengthColor(score: number): string {
  if (score <= 20) {
    return "bg-destructive";
  }
  if (score <= 40) {
    return "bg-orange-500";
  }
  if (score <= 60) {
    return "bg-yellow-500";
  }
  if (score <= 80) {
    return "bg-lime-500";
  }
  return "bg-green-500";
}

function getStrengthLabel(score: number): string {
  if (score <= 20) {
    return "auth.passwordStrength.veryWeak";
  }
  if (score <= 40) {
    return "auth.passwordStrength.weak";
  }
  if (score <= 60) {
    return "auth.passwordStrength.fair";
  }
  if (score <= 80) {
    return "auth.passwordStrength.good";
  }
  return "auth.passwordStrength.strong";
}

function formatFieldError(
  error: unknown,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string
): string {
  if (typeof error === "string") {
    return error;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return t("common.validation.invalidValue");
}

export function SignUpForm({
  onSwitchToSignIn,
  defaultEmail,
  defaultName,
}: SignUpFormProps) {
  const navigate = useNavigate();
  const t = useT();
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [password, setPassword] = useState("");
  const inviteToken =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("invite") ?? undefined
      : undefined;
  const hasInvite = Boolean(inviteToken);

  const passwordStrength = useMemo(
    () => calculatePasswordStrength(password),
    [password]
  );

  const form = useForm({
    defaultValues: {
      name: defaultName ?? "",
      organizationName: hasInvite ? undefined : "",
      email: defaultEmail ?? "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      if (!acceptTerms) {
        toast.error(t("auth.signUp.acceptTermsError"));
        return;
      }

      await authClient.signUp.email(
        {
          email: value.email,
          password: value.password,
          name: value.name,
          organizationName: hasInvite ? undefined : value.organizationName,
          inviteToken,
        },
        {
          onSuccess: () => {
            toast.success(t("auth.signUp.toastSuccess"));
            if (typeof window !== "undefined") {
              window.localStorage.setItem(
                "drovi:onboarding",
                hasInvite ? "complete" : "pending"
              );
            }
            navigate({ to: hasInvite ? "/dashboard" : "/onboarding" });
          },
          onError: (error) => {
            toast.error(error.error.message || t("auth.signUp.toastError"));
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, t("auth.validation.nameTooShort")),
        organizationName: hasInvite
          ? z.string().optional()
          : z.string().min(2, t("auth.validation.organizationRequired")),
        email: z.string().email(t("auth.validation.emailInvalid")),
        password: z
          .string()
          .min(8, t("auth.validation.passwordMinChars"))
          .regex(UPPERCASE_REGEX, t("auth.validation.passwordUppercase"))
          .regex(LOWERCASE_REGEX, t("auth.validation.passwordLowercase"))
          .regex(NUMBER_REGEX, t("auth.validation.passwordNumber")),
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
        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label className="text-foreground" htmlFor={field.name}>
                {t("auth.signUp.fullName")}
              </Label>
              <Input
                autoComplete="name"
                className={
                  field.state.meta.errors.length > 0 ? "border-destructive" : ""
                }
                id={field.name}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={t("auth.placeholders.name")}
                type="text"
                value={field.state.value}
              />
                {field.state.meta.errors.map((error, index) => (
                  <p
                    className="text-destructive text-sm"
                    key={`${field.name}-${index}`}
                  >
                  {formatFieldError(error, t)}
                  </p>
                ))}
            </div>
          )}
        </form.Field>

        {!hasInvite && (
          <form.Field name="organizationName">
            {(field) => (
              <div className="space-y-2">
                <Label className="text-foreground" htmlFor={field.name}>
                  {t("auth.signUp.organization")}
                </Label>
                <Input
                  autoComplete="organization"
                  className={
                    field.state.meta.errors.length > 0
                      ? "border-destructive"
                      : ""
                  }
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={t("auth.placeholders.organization")}
                  type="text"
                  value={field.state.value}
                />
                {field.state.meta.errors.map((error, index) => (
                  <p
                    className="text-destructive text-sm"
                    key={`${field.name}-${index}`}
                  >
                  {formatFieldError(error, t)}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
        )}

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
              {field.state.meta.errors.map((error, index) => (
                <p
                  className="text-destructive text-sm"
                  key={`${field.name}-${index}`}
                >
                  {formatFieldError(error, t)}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <div className="space-y-2">
              <Label className="text-foreground" htmlFor={field.name}>
                {t("auth.password")}
              </Label>
              <div className="relative">
                <Input
                  autoComplete="new-password"
                  className={`pr-10 ${field.state.meta.errors.length > 0 ? "border-destructive" : ""}`}
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    setPassword(e.target.value);
                  }}
                  placeholder={t("auth.placeholders.passwordCreate")}
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

              {/* Password strength indicator */}
              {password.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Progress
                      className={`h-1.5 flex-1 [&>div]:${getStrengthColor(passwordStrength.score)}`}
                      value={passwordStrength.score}
                    />
                    <span className="text-muted-foreground text-xs">
                      {t(getStrengthLabel(passwordStrength.score))}
                    </span>
                  </div>
                  <ul className="grid grid-cols-2 gap-1 text-xs">
                    {passwordStrength.requirements.map((req) => (
                      <li
                        className={`flex items-center gap-1 ${
                          req.met ? "text-green-500" : "text-muted-foreground"
                        }`}
                        key={req.key}
                      >
                        {req.met ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                        {t(req.key)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {field.state.meta.errors.map((error, index) => (
                <p
                  className="text-destructive text-sm"
                  key={`${field.name}-${index}`}
                >
                  {formatFieldError(error, t)}
                </p>
              ))}
            </div>
          )}
        </form.Field>

        <div className="flex items-start space-x-2">
          <Checkbox
            checked={acceptTerms}
            className="mt-0.5"
            id="terms"
            onCheckedChange={(checked) => setAcceptTerms(checked === true)}
          />
          <Label
            className="cursor-pointer font-normal text-muted-foreground text-sm leading-snug"
            htmlFor="terms"
          >
            {t("auth.signUp.termsPrefix")}{" "}
            <Link
              className="text-primary transition-colors hover:text-primary/80"
              to="/"
            >
              {t("auth.links.terms")}
            </Link>{" "}
            {t("auth.signUp.termsAnd")}{" "}
            <Link
              className="text-primary transition-colors hover:text-primary/80"
              to="/"
            >
              {t("auth.links.privacy")}
            </Link>
          </Label>
        </div>

        <form.Subscribe>
          {(state) => (
            <Button
              className="w-full"
              disabled={state.isSubmitting || !acceptTerms}
              type="submit"
            >
              {state.isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("auth.signUp.submitting")}
                </>
              ) : (
                t("common.actions.signUp")
              )}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <p className="text-center text-muted-foreground text-sm">
        {t("auth.haveAccount")}{" "}
        <button
          className="font-medium text-primary transition-colors hover:text-primary/80"
          onClick={onSwitchToSignIn}
          type="button"
        >
          {t("common.actions.signIn")}
        </button>
      </p>
    </div>
  );
}
