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
import { OrDivider, SocialButtons } from "./social-buttons";

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
  requirements: { label: string; met: boolean }[];
} {
  const requirements = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "Contains uppercase letter", met: UPPERCASE_REGEX.test(password) },
    { label: "Contains lowercase letter", met: LOWERCASE_REGEX.test(password) },
    { label: "Contains number", met: NUMBER_REGEX.test(password) },
    {
      label: "Contains special character",
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
    return "Very weak";
  }
  if (score <= 40) {
    return "Weak";
  }
  if (score <= 60) {
    return "Fair";
  }
  if (score <= 80) {
    return "Good";
  }
  return "Strong";
}

export function SignUpForm({
  onSwitchToSignIn,
  defaultEmail,
  defaultName,
}: SignUpFormProps) {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [password, setPassword] = useState("");

  const passwordStrength = useMemo(
    () => calculatePasswordStrength(password),
    [password]
  );

  const form = useForm({
    defaultValues: {
      name: defaultName ?? "",
      email: defaultEmail ?? "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      if (!acceptTerms) {
        toast.error("Please accept the terms and conditions");
        return;
      }

      await authClient.signUp.email(
        {
          email: value.email,
          password: value.password,
          name: value.name,
        },
        {
          onSuccess: () => {
            toast.success("Account created successfully!");
            navigate({ to: "/onboarding" });
          },
          onError: (error) => {
            toast.error(error.error.message || "Failed to create account");
          },
        }
      );
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
        email: z.string().email("Please enter a valid email address"),
        password: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .regex(UPPERCASE_REGEX, "Password must contain an uppercase letter")
          .regex(LOWERCASE_REGEX, "Password must contain a lowercase letter")
          .regex(NUMBER_REGEX, "Password must contain a number"),
      }),
    },
  });

  return (
    <div className="space-y-6">
      <SocialButtons />
      <OrDivider />

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
                Full name
              </Label>
              <Input
                autoComplete="name"
                className={
                  field.state.meta.errors.length > 0 ? "border-destructive" : ""
                }
                id={field.name}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="John Doe"
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

        <form.Field name="email">
          {(field) => (
            <div className="space-y-2">
              <Label className="text-foreground" htmlFor={field.name}>
                Email
              </Label>
              <Input
                autoComplete="email"
                className={
                  field.state.meta.errors.length > 0 ? "border-destructive" : ""
                }
                id={field.name}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="name@example.com"
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
              <Label className="text-foreground" htmlFor={field.name}>
                Password
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
                  placeholder="Create a strong password"
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
                      {getStrengthLabel(passwordStrength.score)}
                    </span>
                  </div>
                  <ul className="grid grid-cols-2 gap-1 text-xs">
                    {passwordStrength.requirements.map((req) => (
                      <li
                        className={`flex items-center gap-1 ${
                          req.met ? "text-green-500" : "text-muted-foreground"
                        }`}
                        key={req.label}
                      >
                        {req.met ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                        {req.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {field.state.meta.errors.map((error) => (
                <p className="text-destructive text-sm" key={error?.message}>
                  {error?.message}
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
            I agree to the{" "}
            <Link
              className="text-primary transition-colors hover:text-primary/80"
              to="/"
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              className="text-primary transition-colors hover:text-primary/80"
              to="/"
            >
              Privacy Policy
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
                  Creating account...
                </>
              ) : (
                "Create account"
              )}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <p className="text-center text-muted-foreground text-sm">
        Already have an account?{" "}
        <button
          className="font-medium text-primary transition-colors hover:text-primary/80"
          onClick={onSwitchToSignIn}
          type="button"
        >
          Sign in
        </button>
      </p>
    </div>
  );
}
