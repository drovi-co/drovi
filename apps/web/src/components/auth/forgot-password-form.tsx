import { ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";

interface ForgotPasswordFormProps {
  onBack: () => void;
}

export function ForgotPasswordForm({ onBack }: ForgotPasswordFormProps) {
  const t = useT();
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

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
        {t("auth.passwordReset.forgot.helpPrefix")}{" "}
        <span className="font-medium text-foreground">{t("auth.passwordReset.supportEmail")}</span>{" "}
        {t("auth.passwordReset.forgot.helpSuffix")}
      </div>

      <Button className="w-full" onClick={onBack} variant="outline">
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("auth.passwordReset.backToSignIn")}
      </Button>
    </div>
  );
}
