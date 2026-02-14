import { Button } from "@memorystack/ui-core/button";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { useT } from "@/i18n";

export function ResetPasswordForm() {
  const navigate = useNavigate();
  const t = useT();

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

      <div className="rounded-lg border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
        {t("auth.passwordReset.reset.helpPrefix")}{" "}
        <span className="font-medium text-foreground">
          {t("auth.passwordReset.supportEmail")}
        </span>{" "}
        {t("auth.passwordReset.reset.helpSuffix")}
      </div>

      <Button className="w-full" onClick={() => navigate({ to: "/login" })}>
        {t("auth.passwordReset.backToSignIn")}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
